import { createHash, randomBytes, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import type {
  AgentHubAgent,
  AgentHubDevice,
  AgentHubProvider,
  ProviderCapability,
  DeviceRegistrationRequest,
  ProviderSnapshot
} from "../shared/agenthub.js";
import {
  agentHubEnvelopeTypes,
  createEnvelope,
  isAgentHubEnvelope,
  isRelayRequestType,
  type AgentHubEnvelope,
  type AgentHubEnvelopeType,
  type DeviceHelloPayload
} from "../shared/protocol/index.js";

const relayConfig = {
  host: process.env.REIKA_RELAY_HOST ?? "127.0.0.1",
  port: Number(process.env.REIKA_RELAY_PORT ?? 8790),
  accountId: process.env.REIKA_RELAY_ACCOUNT_ID ?? "epic-local",
  accountName: process.env.REIKA_RELAY_ACCOUNT_NAME ?? "Epic",
  pairingTtlMs: Number(process.env.REIKA_PAIRING_TTL_MS ?? 10 * 60 * 1000),
  offlineQueueTtlMs: Number(process.env.REIKA_RELAY_OFFLINE_QUEUE_TTL_MS ?? 15 * 60 * 1000),
  offlineQueueLimit: Number(process.env.REIKA_RELAY_OFFLINE_QUEUE_LIMIT ?? 50),
  storePath: process.env.REIKA_RELAY_STORE_PATH ?? join(homedir(), ".local", "share", "project-reika", "relay-store.json")
};

type PairingSessionStatus = "created" | "claimed" | "approved";

interface PairingSession {
  code: string;
  accountId: string;
  status: PairingSessionStatus;
  expiresAt: string;
  createdAt: string;
  claimedAt?: string;
  approvedAt?: string;
  deviceId?: string;
  device?: RelayDevice;
  publicKey?: string;
}

interface RelayDeviceRecord {
  device: RelayDevice;
  socket?: WebSocket;
  lastHeartbeatAt?: string;
  activeProviderId?: string;
  latestProviders: ProviderSnapshot["providers"];
  latestRoster: AgentHubAgent[];
  queuedEnvelopes: QueuedEnvelope[];
}

interface RelayDevice extends AgentHubDevice {
  publicKey?: string;
  keyVersion?: number;
  revokedAt?: string;
}

interface QueuedEnvelope {
  envelope: AgentHubEnvelope;
  queuedAt: string;
  expiresAt: string;
}

interface RelayChatMessageRecord {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  timestamp: string;
  meta?: Record<string, unknown>;
}

interface RelayChatSessionRecord {
  id: string;
  deviceId: string;
  providerId: string;
  agent: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: RelayChatMessageRecord[];
  metadata?: Record<string, unknown>;
}

interface DeviceChallenge {
  deviceId: string;
  challenge: string;
  expiresAt: string;
}

interface PersistedRelayStore {
  version: 1;
  updatedAt: string;
  pairingSessions: PairingSession[];
  devices: Array<Omit<RelayDeviceRecord, "socket">>;
  chatSessions?: RelayChatSessionRecord[];
}

const pairingSessions = new Map<string, PairingSession>();
const devices = new Map<string, RelayDeviceRecord>();
const chatSessions = new Map<string, RelayChatSessionRecord>();
const appSockets = new Set<WebSocket>();
const deviceChallenges = new Map<string, DeviceChallenge>();

loadRelayStore();

const server = createServer(async (request, response) => {
  setCorsHeaders(response);
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  try {
    const url = getRequestUrl(request);

    if (request.method === "GET" && url.pathname === "/v1/health") {
      sendJson(response, 200, {
        ok: true,
        service: "agenthub-relay",
        accountId: relayConfig.accountId,
        deviceCount: devices.size,
        appSocketCount: appSockets.size,
        durable: true,
        storePath: relayConfig.storePath,
        offlineQueue: {
          ttlMs: relayConfig.offlineQueueTtlMs,
          limit: relayConfig.offlineQueueLimit,
          queuedCount: Array.from(devices.values()).reduce((total, record) => total + record.queuedEnvelopes.length, 0)
        },
        security: {
          perDeviceKeypairs: true,
          signedChallenges: true,
          revocation: true,
          keyRotation: true,
          optionalEncryptedEnvelopes: true
        }
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/policy") {
      sendJson(response, 200, {
        ok: true,
        accountId: relayConfig.accountId,
        allowedEnvelopeTypes: agentHubEnvelopeTypes,
        offlineDelivery: {
          enabled: true,
          ttlMs: relayConfig.offlineQueueTtlMs,
          perDeviceLimit: relayConfig.offlineQueueLimit,
          storedTypes: ["device.state.request", "provider.refresh.request", "agent.roster.request", "agent.chat.request"]
        },
        encryption: {
          optional: true,
          routingOnly: true,
          supportedMarkers: ["x25519-xsalsa20-poly1305", "age-v1", "custom"]
        }
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/devices") {
      sendJson(response, 200, {
        ok: true,
        devices: Array.from(devices.values()).map((record) => ({
          device: record.device,
          activeProviderId: record.activeProviderId,
          providerCount: record.latestProviders.length,
          agentCount: record.latestRoster.length,
          socketConnected: record.socket?.readyState === WebSocket.OPEN,
          lastHeartbeatAt: record.lastHeartbeatAt
        }))
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/chat/sessions") {
      const sessions = listChatSessions({
        deviceId: url.searchParams.get("deviceId") ?? undefined,
        providerId: url.searchParams.get("providerId") ?? undefined,
        agent: url.searchParams.get("agent") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 30)
      });
      sendJson(response, 200, { ok: true, sessions: sessions.map(publicChatSession) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/chat/sessions") {
      const body = await readJsonBody<{
        id?: string;
        deviceId?: string;
        providerId?: string;
        agent?: string;
        title?: string;
        metadata?: Record<string, unknown>;
      }>(request);
      const session = createChatSession(body);
      sendJson(response, 201, { ok: true, session: publicChatSession(session) });
      return;
    }

    const chatMessagesMatch = url.pathname.match(/^\/v1\/chat\/sessions\/([^/]+)\/messages$/);
    if (request.method === "GET" && chatMessagesMatch) {
      const session = chatSessions.get(decodeURIComponent(chatMessagesMatch[1] || ""));
      if (!session) {
        sendJson(response, 404, { ok: false, error: "Relay chat session not found." });
        return;
      }
      const limit = Number(url.searchParams.get("limit") ?? 0);
      sendJson(response, 200, { ok: true, sessionId: session.id, messages: limit > 0 ? session.messages.slice(-limit) : session.messages });
      return;
    }

    if (request.method === "POST" && chatMessagesMatch) {
      const sessionId = decodeURIComponent(chatMessagesMatch[1] || "");
      const body = await readJsonBody<{ messages?: RelayChatMessageRecord[]; message?: RelayChatMessageRecord }>(request);
      const session = chatSessions.get(sessionId);
      if (!session) {
        sendJson(response, 404, { ok: false, error: "Relay chat session not found." });
        return;
      }
      const messages = Array.isArray(body.messages) ? body.messages : body.message ? [body.message] : [];
      for (const message of messages) appendChatMessage(session, message);
      sendJson(response, 200, { ok: true, session: publicChatSession(session), messages: session.messages });
      return;
    }

    const deviceRequestMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)\/request$/);
    if (request.method === "POST" && deviceRequestMatch) {
      const deviceId = decodeURIComponent(deviceRequestMatch[1] || "");
      const body = await readJsonBody<{ type?: AgentHubEnvelopeType; payload?: Record<string, unknown> }>(request);
      if (!body.type || !isRelayRequestType(body.type)) {
        sendJson(response, 400, { ok: false, error: "Unsupported relay request type." });
        return;
      }
      const envelope = createEnvelope(body.type, body.payload ?? {}, { accountId: relayConfig.accountId, deviceId });
      const status = routeAppRequest(envelope);
      sendJson(response, status.type === "command.rejected" ? 409 : 202, { ok: status.type !== "command.rejected", envelope: status, error: (status.payload as { message?: string }).message });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/pairing/create") {
      const body = await readJsonBody<{ accountId?: string; ttlMs?: number }>(request);
      const session = createPairingSession(body.accountId, body.ttlMs);
      sendJson(response, 201, { ok: true, pairing: publicPairing(session) });
      return;
    }

    const pairingStatusMatch = url.pathname.match(/^\/v1\/pairing\/([^/]+)$/);
    if (request.method === "GET" && pairingStatusMatch) {
      const code = decodeURIComponent(pairingStatusMatch[1] || "");
      const session = findValidPairingSession(code);
      if (!session) {
        sendJson(response, 404, { ok: false, error: "Pairing code is invalid or expired." });
        return;
      }
      sendJson(response, 200, { ok: true, pairing: publicPairing(session), device: session.device });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/pairing/claim") {
      const body = await readJsonBody<{ code: string; device: DeviceRegistrationRequest & { publicKey?: string } }>(request);
      const session = claimPairingSession(body.code, body.device);
      if (!session) {
        sendJson(response, 404, { ok: false, error: "Pairing code is invalid, expired, or already approved." });
        return;
      }
      sendJson(response, 200, { ok: true, pairing: publicPairing(session), device: session.device });
      broadcastRelayState();
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/pairing/approve") {
      const body = await readJsonBody<{ code: string }>(request);
      const session = approvePairingSession(body.code);
      if (!session?.device) {
        sendJson(response, 404, { ok: false, error: "Pairing code has no claimed device to approve." });
        return;
      }
      const record = upsertDevice({ ...session.device, trusted: true });
      session.device = record.device;
      session.publicKey = record.device.publicKey;
      saveRelayStore();
      sendJson(response, 200, { ok: true, pairing: publicPairing(session), device: record.device });
      broadcastRelayState();
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/device/challenge") {
      const body = await readJsonBody<{ deviceId: string }>(request);
      const record = devices.get(String(body.deviceId || ""));
      if (!record || record.device.revokedAt) {
        sendJson(response, 404, { ok: false, error: "Device is not approved or was revoked." });
        return;
      }
      const challenge = createDeviceChallenge(record.device.id);
      sendJson(response, 200, { ok: true, challenge });
      return;
    }

    const revokeMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)\/revoke$/);
    if (request.method === "POST" && revokeMatch) {
      const deviceId = decodeURIComponent(revokeMatch[1] || "");
      const record = devices.get(deviceId);
      if (!record) {
        sendJson(response, 404, { ok: false, error: "Device not found." });
        return;
      }
      record.device.trusted = false;
      record.device.status = "offline";
      record.device.revokedAt = new Date().toISOString();
      record.socket?.close(4003, "Device revoked");
      record.socket = undefined;
      saveRelayStore();
      broadcastRelayState();
      sendJson(response, 200, { ok: true, device: record.device });
      return;
    }

    const rotateKeyMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)\/rotate-key$/);
    if (request.method === "POST" && rotateKeyMatch) {
      const body = await readJsonBody<{ publicKey: string }>(request);
      const deviceId = decodeURIComponent(rotateKeyMatch[1] || "");
      const record = devices.get(deviceId);
      if (!record) {
        sendJson(response, 404, { ok: false, error: "Device not found." });
        return;
      }
      if (!looksLikePublicKey(body.publicKey)) {
        sendJson(response, 400, { ok: false, error: "publicKey must be a PEM public key." });
        return;
      }
      record.device.publicKey = body.publicKey.trim();
      record.device.keyVersion = (record.device.keyVersion ?? 1) + 1;
      record.device.revokedAt = undefined;
      record.device.trusted = true;
      saveRelayStore();
      sendJson(response, 200, { ok: true, device: record.device });
      return;
    }

    sendJson(response, 404, { ok: false, error: "Route not found" });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: String(error) });
  }
});

const deviceSocketServer = new WebSocketServer({ noServer: true });
const appSocketServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = getRequestUrl(request);
  if (url.pathname === "/v1/device") {
    deviceSocketServer.handleUpgrade(request, socket, head, (ws) => {
      deviceSocketServer.emit("connection", ws, request);
    });
    return;
  }

  if (url.pathname === "/v1/app") {
    appSocketServer.handleUpgrade(request, socket, head, (ws) => {
      appSocketServer.emit("connection", ws, request);
    });
    return;
  }

  socket.destroy();
});

deviceSocketServer.on("connection", (socket, request) => {
  let deviceId: string | null = null;
  const socketUrl = getRequestUrl(request);
  const pairingToken = socketUrl.searchParams.get("pairingToken") ?? socketUrl.searchParams.get("pairingCode");
  const queryDeviceId = socketUrl.searchParams.get("deviceId");

  socket.on("message", (raw) => {
    const parsed = parseEnvelope(raw.toString());
    if (!parsed) {
      sendEnvelope(socket, createCommandStatus("command.rejected", "Invalid AgentHub envelope."));
      return;
    }

    if (parsed.type === "device.hello") {
      const device = resolveHelloDevice(parsed, pairingToken, queryDeviceId);
      if (!device) {
        sendEnvelope(socket, createCommandStatus("command.rejected", "Device is not paired or approved.", parsed.id));
        return;
      }
      if (!authorizeDeviceSocket(device, parsed, pairingToken)) {
        sendEnvelope(socket, createCommandStatus("command.rejected", "Device challenge signature is missing or invalid.", parsed.id, device.id));
        socket.close(4003, "Unauthorized device");
        return;
      }

      deviceId = device.id;
      const record = upsertDevice(device);
      record.socket = socket;
      record.device.status = "online";
      record.device.lastSeenAt = new Date().toISOString();
      sendEnvelope(socket, createCommandStatus("command.accepted", "Device connected to relay.", parsed.id, device.id));
      saveRelayStore();
      flushQueuedEnvelopes(record);
      broadcastRelayState();
      return;
    }

    if (!deviceId) {
      sendEnvelope(socket, createCommandStatus("command.rejected", "Device must send device.hello first.", parsed.id));
      return;
    }

    const envelopeDeviceId = getEnvelopeDeviceId(parsed);
    if (envelopeDeviceId && envelopeDeviceId !== deviceId) {
      sendEnvelope(socket, createCommandStatus("command.rejected", "Envelope deviceId does not match socket device.", parsed.id, deviceId));
      return;
    }

    if (parsed.type === "device.heartbeat") {
      const record = devices.get(deviceId);
      if (record) {
        record.lastHeartbeatAt = parsed.timestamp;
        record.device.status = "online";
        record.device.lastSeenAt = parsed.timestamp;
      }
      saveRelayStore();
      broadcastRelayState(parsed);
      return;
    }

    if (parsed.type === "device.provider.snapshot") {
      const snapshot = parsed.payload as ProviderSnapshot & { activeProviderId?: string };
      updateProviderSnapshot(deviceId, snapshot.providers ?? [], snapshot.activeProviderId);
      saveRelayStore();
      broadcastRelayState(parsed);
      return;
    }

    if (parsed.type === "device.state.snapshot") {
      broadcastToApps(parsed);
      return;
    }

    if (parsed.type === "agent.roster.snapshot") {
      const record = devices.get(deviceId);
      if (record) record.latestRoster = (parsed.payload as { agents?: AgentHubAgent[] }).agents ?? [];
      saveRelayStore();
      broadcastToApps(parsed);
      return;
    }

    if (parsed.type === "agent.chat.response" || parsed.type === "agent.activity" || parsed.type.startsWith("command.")) {
      broadcastToApps(parsed);
      return;
    }

    sendEnvelope(socket, createCommandStatus("command.rejected", `Unsupported device envelope: ${parsed.type}.`, parsed.id, deviceId));
  });

  socket.on("close", () => {
    if (!deviceId) return;
    const record = devices.get(deviceId);
    if (record?.socket === socket) {
      record.socket = undefined;
      record.device.status = "offline";
      record.device.lastSeenAt = new Date().toISOString();
      saveRelayStore();
      broadcastRelayState();
    }
  });
});

appSocketServer.on("connection", (socket) => {
  appSockets.add(socket);
  sendRelayState(socket);

  socket.on("message", (raw) => {
    const envelope = parseEnvelope(raw.toString());
    if (!envelope) {
      sendEnvelope(socket, createCommandStatus("command.rejected", "Invalid AgentHub envelope."));
      return;
    }

    if (!isRelayRequestType(envelope.type)) {
      sendEnvelope(socket, createCommandStatus("command.rejected", `Unsupported app request: ${envelope.type}.`, envelope.id, envelope.deviceId));
      return;
    }

    if (!envelope.deviceId) {
      sendEnvelope(socket, createCommandStatus("command.rejected", "Safe request requires deviceId.", envelope.id));
      return;
    }

    sendEnvelope(socket, routeAppRequest(envelope));
  });

  socket.on("close", () => {
    appSockets.delete(socket);
  });
});

function routeAppRequest(envelope: AgentHubEnvelope) {
  if (!envelope.deviceId) return createCommandStatus("command.rejected", "Safe request requires deviceId.", envelope.id);
  const record = devices.get(envelope.deviceId);
  if (!record?.socket || record.socket.readyState !== WebSocket.OPEN) {
    if (record) {
      queueOfflineEnvelope(record, envelope);
      saveRelayStore();
      return createCommandStatus("command.accepted", "Device is offline; request queued according to relay offline policy.", envelope.id, envelope.deviceId);
    }
    return createCommandStatus("command.rejected", "Device is offline.", envelope.id, envelope.deviceId);
  }

  record.socket.send(JSON.stringify(toDeviceEnvelope(envelope, record.device.id)));
  return createCommandStatus("command.accepted", "Request routed to device.", envelope.id, envelope.deviceId);
}

server.listen(relayConfig.port, relayConfig.host, () => {
  console.log(`[agenthub-relay] Relay listening at http://${relayConfig.host}:${relayConfig.port}`);
});

function createPairingSession(accountId = relayConfig.accountId, ttlMs = relayConfig.pairingTtlMs) {
  const now = new Date();
  const code = `${randomBytes(2).toString("hex")}-${randomBytes(2).toString("hex")}`.toUpperCase();
  const session: PairingSession = {
    code,
    accountId,
    status: "created",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString()
  };
  pairingSessions.set(code, session);
  saveRelayStore();
  return session;
}

function createChatSession(input: { id?: string; deviceId?: string; providerId?: string; agent?: string; title?: string; metadata?: Record<string, unknown> }) {
  const now = new Date().toISOString();
  const deviceId = cleanText(input.deviceId) || "unknown-device";
  const providerId = cleanText(input.providerId) || "unknown-provider";
  const agent = cleanText(input.agent) || "agent";
  const id = cleanText(input.id) || `relay_${slug(deviceId)}_${slug(providerId)}_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  const existing = chatSessions.get(id);
  if (existing) return existing;
  const session: RelayChatSessionRecord = {
    id,
    deviceId,
    providerId,
    agent,
    title: cleanText(input.title) || `${agent} session`,
    createdAt: now,
    updatedAt: now,
    messages: [],
    metadata: isRecord(input.metadata) ? input.metadata : undefined
  };
  chatSessions.set(session.id, session);
  saveRelayStore();
  return session;
}

function listChatSessions(filters: { deviceId?: string; providerId?: string; agent?: string; q?: string; limit?: number }) {
  const deviceId = cleanText(filters.deviceId).toLowerCase();
  const providerId = cleanText(filters.providerId).toLowerCase();
  const agent = cleanText(filters.agent).toLowerCase();
  const q = cleanText(filters.q).toLowerCase();
  const limit = Number.isFinite(filters.limit) && filters.limit && filters.limit > 0 ? filters.limit : 30;
  return Array.from(chatSessions.values())
    .filter((session) => !deviceId || session.deviceId.toLowerCase() === deviceId)
    .filter((session) => !providerId || session.providerId.toLowerCase() === providerId)
    .filter((session) => !agent || session.agent.toLowerCase() === agent)
    .filter((session) => {
      if (!q) return true;
      const haystack = [session.title, session.agent, session.providerId, session.deviceId, ...session.messages.map((message) => message.text)].join("\n").toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

function appendChatMessage(session: RelayChatSessionRecord, input: RelayChatMessageRecord) {
  const role = input.role === "assistant" || input.role === "system" ? input.role : "user";
  const text = cleanText(input.text);
  if (!text) return;
  const timestamp = cleanText(input.timestamp) || new Date().toISOString();
  const message: RelayChatMessageRecord = {
    id: cleanText(input.id) || `relay_msg_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`,
    role,
    text,
    timestamp,
    meta: isRecord(input.meta) ? input.meta : undefined
  };
  session.messages.push(message);
  session.updatedAt = timestamp;
  if (!session.title || / session$/i.test(session.title)) session.title = text.slice(0, 80);
  chatSessions.set(session.id, session);
  saveRelayStore();
}

function publicChatSession(session: RelayChatSessionRecord) {
  return {
    id: session.id,
    providerId: session.providerId,
    agent: session.agent,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    lastMessagePreview: session.messages.at(-1)?.text.slice(0, 160) || "",
    metadata: {
      ...session.metadata,
      relay: true,
      relayDeviceId: session.deviceId
    }
  };
}

function claimPairingSession(code: string, request: DeviceRegistrationRequest & { publicKey?: string }) {
  const session = findValidPairingSession(code);
  if (!session || session.status === "approved") return null;
  const device = makeDevice(request, session.accountId);
  if (looksLikePublicKey(request.publicKey)) device.publicKey = request.publicKey.trim();
  session.status = "claimed";
  session.claimedAt = new Date().toISOString();
  session.deviceId = device.id;
  session.device = device;
  session.publicKey = device.publicKey;
  saveRelayStore();
  return session;
}

function approvePairingSession(code: string) {
  const session = findValidPairingSession(code);
  if (!session?.device) return null;
  session.status = "approved";
  session.approvedAt = new Date().toISOString();
  if (session.device?.publicKey) session.publicKey = session.device.publicKey;
  saveRelayStore();
  return session;
}

function resolveHelloDevice(envelope: AgentHubEnvelope, pairingToken?: string | null, queryDeviceId?: string | null) {
  const payload = envelope.payload as Partial<DeviceHelloPayload> & {
    deviceId?: string;
    deviceName?: string;
    platform?: string;
    service?: string;
    capabilities?: string[];
    pairingCode?: string;
    accountId?: string;
  };
  const candidateDeviceId = payload.deviceId ?? queryDeviceId ?? envelope.source?.id;
  const token = payload.pairingCode ?? pairingToken;
  if (token) {
    const normalized = normalizeCode(token);
    const session = pairingSessions.get(normalized);
    if (session && session.status !== "approved") {
      const existingDevice = candidateDeviceId ? devices.get(candidateDeviceId)?.device : null;
      const device = {
        ...makeDevice(payload, session.accountId, candidateDeviceId),
        publicKey: session.device?.publicKey ?? existingDevice?.publicKey,
        keyVersion: session.device?.keyVersion ?? existingDevice?.keyVersion,
        revokedAt: undefined
      };
      session.status = "claimed";
      session.claimedAt = new Date().toISOString();
      session.deviceId = device.id;
      session.device = device;
      session.publicKey = device.publicKey;
      saveRelayStore();
      broadcastRelayState();
      return device;
    }
    if (session?.status === "approved" && session.device) {
      if (candidateDeviceId && session.device.id !== candidateDeviceId) {
        devices.delete(session.device.id);
        const device = { ...session.device, id: candidateDeviceId, fingerprint: session.device.fingerprint || candidateDeviceId };
        session.device = device;
        session.deviceId = device.id;
        return device;
      }
      return session.device;
    }
    return null;
  }

  const explicitDevice = candidateDeviceId ? devices.get(candidateDeviceId)?.device : null;
  if (explicitDevice) return { ...explicitDevice, ...makeDevice(payload, explicitDevice.accountId), id: explicitDevice.id };

  const requestDevice = makeDevice(payload, payload.accountId ?? relayConfig.accountId, candidateDeviceId);
  const existing = devices.get(requestDevice.id);
  return existing?.device ?? null;
}

function findValidPairingSession(code: string) {
  const session = pairingSessions.get(normalizeCode(code));
  if (!session || Date.parse(session.expiresAt) < Date.now()) return null;
  return session;
}

function upsertDevice(device: AgentHubDevice) {
  const existing = devices.get(device.id);
  const record: RelayDeviceRecord = existing ?? {
    device,
    latestProviders: [],
    latestRoster: [],
    queuedEnvelopes: []
  };
  const socketOnline = existing?.socket?.readyState === WebSocket.OPEN;
  record.device = {
    ...device,
    status: socketOnline ? "online" : device.status,
    lastSeenAt: socketOnline ? new Date().toISOString() : device.lastSeenAt,
    providers: existing?.device.providers ?? device.providers
  };
  devices.set(device.id, record);
  saveRelayStore();
  return record;
}

function updateProviderSnapshot(deviceId: string, providers: ProviderSnapshot["providers"], activeProviderId?: string) {
  const record = devices.get(deviceId);
  if (!record) return;
  const now = new Date().toISOString();
  record.latestProviders = providers;
  record.activeProviderId = activeProviderId ?? providers.find((provider) => provider.status === "online")?.id ?? providers[0]?.id;
  record.device.status = "online";
  record.device.lastSeenAt = now;
  record.device.providers = providers.map((provider) => normalizeProvider(deviceId, provider, now));
  record.latestRoster = record.device.providers.flatMap((provider) => provider.agents);
}

function normalizeProvider(deviceId: string, provider: ProviderSnapshot["providers"][number], now: string): AgentHubProvider {
  const providerId = provider.id ?? `${deviceId}-${slug(provider.kind)}`;
  const rawStatus = String(provider.status);
  const providerStatus = rawStatus === "preferred" || rawStatus === "available" ? "online" : provider.status;
  const capabilities = normalizeCapabilities(provider.capabilities);
  return {
    id: providerId,
    deviceId,
    kind: provider.kind,
    name: provider.name,
    status: providerStatus,
    endpoint: provider.endpoint,
    version: provider.version,
    capabilities,
    lastSeenAt: now,
    agents: (provider.agents ?? []).map((agent) => {
      const sourceAgent = agent as typeof agent & { label?: string; source?: string };
      return {
      id: sourceAgent.id ?? `${providerId}-${slug(sourceAgent.name)}`,
      providerId,
      deviceId,
      name: sourceAgent.name,
      role: sourceAgent.role ?? sourceAgent.label ?? sourceAgent.source ?? "Agent",
      status: sourceAgent.status ?? providerStatus,
      characterId: sourceAgent.characterId,
      avatar: sourceAgent.avatar,
      capabilities: normalizeCapabilities(sourceAgent.capabilities ?? provider.capabilities),
      lastActivity: sourceAgent.lastActivity ?? "Discovered through relay",
      updatedAt: now
      };
    }),
    error: provider.error,
    remote: true
  };
}

function makeDevice(request: Partial<DeviceRegistrationRequest> & Partial<DeviceHelloPayload> & { publicKey?: string; keyVersion?: number; revokedAt?: string }, accountId: string, explicitId?: string | null): RelayDevice {
  const name = request.name ?? request.deviceName ?? explicitId ?? "Device";
  const fingerprint = request.fingerprint ?? explicitId ?? `${name}-${request.platform ?? "unknown"}`;
  const device: RelayDevice = {
    id: explicitId ?? makeDeviceId(name, fingerprint),
    accountId,
    name,
    type: request.type ?? inferDeviceType(request.platform),
    status: "offline",
    location: request.location ?? "remote",
    agentVersion: request.agentVersion ?? request.service ?? "unknown",
    fingerprint,
    trusted: false,
    lastSeenAt: new Date().toISOString(),
    providers: []
  };
  if (looksLikePublicKey(request.publicKey)) device.publicKey = request.publicKey.trim();
  if (typeof request.keyVersion === "number") device.keyVersion = request.keyVersion;
  if (typeof request.revokedAt === "string") device.revokedAt = request.revokedAt;
  return device;
}

function makeDeviceId(name: string, fingerprint: string) {
  const suffix = createHash("sha256").update(fingerprint).digest("hex").slice(0, 8);
  return `${slug(name) || "device"}-${suffix}`;
}

function sendRelayState(socket: WebSocket) {
  for (const record of devices.values()) {
    sendEnvelope(
      socket,
      createEnvelope(
        "device.state.snapshot",
        {
          device: record.device,
          activeProviderId: record.activeProviderId,
          providers: record.latestProviders
        },
        { accountId: record.device.accountId, deviceId: record.device.id }
      )
    );

    if (record.latestRoster.length > 0) {
      sendEnvelope(
        socket,
        createEnvelope(
          "agent.roster.snapshot",
          {
            deviceId: record.device.id,
            agents: record.latestRoster
          },
          { accountId: record.device.accountId, deviceId: record.device.id }
        )
      );
    }
  }
}

function broadcastRelayState(envelope?: AgentHubEnvelope) {
  if (envelope) broadcastToApps(envelope);
  for (const socket of appSockets) sendRelayState(socket);
}

function broadcastToApps(envelope: AgentHubEnvelope) {
  for (const socket of appSockets) sendEnvelope(socket, envelope);
}

function createCommandStatus(type: "command.accepted" | "command.rejected" | "command.completed" | "command.failed", message: string, replyTo?: string, deviceId?: string) {
  return createEnvelope(type, { ok: type === "command.accepted" || type === "command.completed", message }, {
    source: { kind: "relay", id: "agenthub-relay" },
    replyTo,
    deviceId,
    target: deviceId ? { kind: "device", id: deviceId } : undefined
  });
}

function sendEnvelope(socket: WebSocket, envelope: AgentHubEnvelope) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(envelope));
}

function parseEnvelope(raw: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isAgentHubEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

function publicPairing(session: PairingSession) {
  return {
    code: session.code,
    accountId: session.accountId,
    status: session.status,
    expiresAt: session.expiresAt,
    claimedAt: session.claimedAt,
    approvedAt: session.approvedAt,
    deviceId: session.deviceId
  };
}

function toDeviceEnvelope(envelope: AgentHubEnvelope, deviceId: string): AgentHubEnvelope {
  if (envelope.source) return envelope;
  return {
    ...envelope,
    source: { kind: "app", id: "agenthub-client" },
    target: { kind: "device", id: deviceId },
    correlationId: envelope.correlationId ?? envelope.commandId ?? envelope.id,
    payload: envelope.payload ?? {}
  };
}

function createDeviceChallenge(deviceId: string) {
  const challenge: DeviceChallenge = {
    deviceId,
    challenge: randomBytes(32).toString("base64url"),
    expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString()
  };
  deviceChallenges.set(challenge.challenge, challenge);
  return challenge;
}

function authorizeDeviceSocket(device: RelayDevice, envelope: AgentHubEnvelope, pairingToken?: string | null) {
  if (device.revokedAt) return false;
  if (pairingToken) return true;
  if (!device.publicKey) return true;
  const payload = envelope.payload as { challenge?: string; challengeId?: string; signature?: string };
  const challengeId = payload.challengeId || payload.challenge;
  const signature = payload.signature;
  if (!challengeId || !signature) return false;
  const challenge = deviceChallenges.get(challengeId);
  if (!challenge || challenge.deviceId !== device.id || Date.parse(challenge.expiresAt) < Date.now()) return false;
  try {
    const ok = verify(null, Buffer.from(challenge.challenge), device.publicKey, Buffer.from(signature, "base64"));
    if (ok) deviceChallenges.delete(challengeId);
    return ok;
  } catch {
    return false;
  }
}

function looksLikePublicKey(value: unknown): value is string {
  return typeof value === "string" && /-----BEGIN [A-Z ]*PUBLIC KEY-----/.test(value) && /-----END [A-Z ]*PUBLIC KEY-----/.test(value);
}

function queueOfflineEnvelope(record: RelayDeviceRecord, envelope: AgentHubEnvelope) {
  const now = Date.now();
  record.queuedEnvelopes = record.queuedEnvelopes
    .filter((item) => Date.parse(item.expiresAt) > now)
    .slice(-Math.max(0, relayConfig.offlineQueueLimit - 1));
  record.queuedEnvelopes.push({
    envelope,
    queuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + relayConfig.offlineQueueTtlMs).toISOString()
  });
}

function flushQueuedEnvelopes(record: RelayDeviceRecord) {
  if (!record.socket || record.socket.readyState !== WebSocket.OPEN) return;
  const now = Date.now();
  const ready = record.queuedEnvelopes.filter((item) => Date.parse(item.expiresAt) > now);
  record.queuedEnvelopes = [];
  for (const queued of ready) record.socket.send(JSON.stringify(toDeviceEnvelope(queued.envelope, record.device.id)));
  if (ready.length > 0) saveRelayStore();
}

function loadRelayStore() {
  if (!existsSync(relayConfig.storePath)) return;
  try {
    const parsed = JSON.parse(readFileSync(relayConfig.storePath, "utf8").replace(/^\uFEFF/, "")) as Partial<PersistedRelayStore>;
    pairingSessions.clear();
    devices.clear();
    for (const session of parsed.pairingSessions ?? []) {
      if (session?.code) pairingSessions.set(normalizeCode(session.code), session);
    }
    for (const record of parsed.devices ?? []) {
      if (!record?.device?.id) continue;
      devices.set(record.device.id, {
        device: { ...record.device, status: "offline" },
        activeProviderId: record.activeProviderId,
        latestProviders: record.latestProviders ?? [],
        latestRoster: record.latestRoster ?? [],
        queuedEnvelopes: record.queuedEnvelopes ?? [],
        lastHeartbeatAt: record.lastHeartbeatAt
      });
    }
    chatSessions.clear();
    for (const session of parsed.chatSessions ?? []) {
      if (isChatSessionRecord(session)) chatSessions.set(session.id, session);
    }
  } catch (error) {
    console.warn(`[agenthub-relay] Could not load relay store: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function saveRelayStore() {
  const payload: PersistedRelayStore = {
    version: 1,
    updatedAt: new Date().toISOString(),
    pairingSessions: Array.from(pairingSessions.values()),
    devices: Array.from(devices.values()).map((record) => ({
      device: { ...record.device, status: record.socket?.readyState === WebSocket.OPEN ? record.device.status : "offline" },
      activeProviderId: record.activeProviderId,
      latestProviders: record.latestProviders,
      latestRoster: record.latestRoster,
      queuedEnvelopes: record.queuedEnvelopes,
      lastHeartbeatAt: record.lastHeartbeatAt
    })),
    chatSessions: Array.from(chatSessions.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  };
  mkdirSync(dirname(relayConfig.storePath), { recursive: true });
  writeFileSync(relayConfig.storePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function isChatSessionRecord(value: unknown): value is RelayChatSessionRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.deviceId === "string" &&
    typeof value.providerId === "string" &&
    typeof value.agent === "string" &&
    typeof value.title === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.messages)
  );
}

function normalizeCapabilities(value: unknown): ProviderCapability[] {
  if (!Array.isArray(value)) return [];
  return value.map((capability) => {
    if (typeof capability === "string") return capability;
    if (capability && typeof capability === "object" && "id" in capability) return String((capability as { id: unknown }).id);
    return String(capability);
  }) as ProviderCapability[];
}

function getEnvelopeDeviceId(envelope: AgentHubEnvelope) {
  return envelope.deviceId ?? (envelope.payload as { deviceId?: string } | undefined)?.deviceId ?? envelope.source?.id;
}

function inferDeviceType(platform?: string) {
  const normalized = String(platform ?? "").toLowerCase();
  if (normalized.includes("linux") || normalized.includes("server")) return "server";
  if (normalized.includes("darwin") || normalized.includes("win")) return "pc";
  return "pc";
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function slug(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getRequestUrl(request: IncomingMessage) {
  return new URL(request.url || "/", `http://${request.headers.host || `${relayConfig.host}:${relayConfig.port}`}`);
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function setCorsHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body, null, 2));
}
