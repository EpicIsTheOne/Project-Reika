import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
  pairingTtlMs: Number(process.env.REIKA_PAIRING_TTL_MS ?? 10 * 60 * 1000)
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
  device?: AgentHubDevice;
}

interface RelayDeviceRecord {
  device: AgentHubDevice;
  socket?: WebSocket;
  lastHeartbeatAt?: string;
  activeProviderId?: string;
  latestProviders: ProviderSnapshot["providers"];
  latestRoster: AgentHubAgent[];
}

const pairingSessions = new Map<string, PairingSession>();
const devices = new Map<string, RelayDeviceRecord>();
const appSockets = new Set<WebSocket>();

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
        appSocketCount: appSockets.size
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

    if (request.method === "POST" && url.pathname === "/v1/pairing/create") {
      const body = await readJsonBody<{ accountId?: string; ttlMs?: number }>(request);
      const session = createPairingSession(body.accountId, body.ttlMs);
      sendJson(response, 201, { ok: true, pairing: publicPairing(session) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/pairing/claim") {
      const body = await readJsonBody<{ code: string; device: DeviceRegistrationRequest }>(request);
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
      sendJson(response, 200, { ok: true, pairing: publicPairing(session), device: record.device });
      broadcastRelayState();
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

      deviceId = device.id;
      const record = upsertDevice(device);
      record.socket = socket;
      record.device.status = "online";
      record.device.lastSeenAt = new Date().toISOString();
      sendEnvelope(socket, createCommandStatus("command.accepted", "Device connected to relay.", parsed.id, device.id));
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
      broadcastRelayState(parsed);
      return;
    }

    if (parsed.type === "device.provider.snapshot") {
      const snapshot = parsed.payload as ProviderSnapshot & { activeProviderId?: string };
      updateProviderSnapshot(deviceId, snapshot.providers ?? [], snapshot.activeProviderId);
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
      broadcastToApps(parsed);
      return;
    }

    if (parsed.type === "agent.chat.response") {
      broadcastToApps(parsed);
      return;
    }

    if (parsed.type.startsWith("command.")) {
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

    const record = devices.get(envelope.deviceId);
    if (!record?.socket || record.socket.readyState !== WebSocket.OPEN) {
      sendEnvelope(socket, createCommandStatus("command.rejected", "Device is offline.", envelope.id, envelope.deviceId));
      return;
    }

    sendEnvelope(socket, createCommandStatus("command.accepted", "Request routed to device.", envelope.id, envelope.deviceId));
    record.socket.send(JSON.stringify(toDeviceEnvelope(envelope, record.device.id)));
  });

  socket.on("close", () => {
    appSockets.delete(socket);
  });
});

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
  return session;
}

function claimPairingSession(code: string, request: DeviceRegistrationRequest) {
  const session = findValidPairingSession(code);
  if (!session || session.status === "approved") return null;
  const device = makeDevice(request, session.accountId);
  session.status = "claimed";
  session.claimedAt = new Date().toISOString();
  session.deviceId = device.id;
  session.device = device;
  return session;
}

function approvePairingSession(code: string) {
  const session = findValidPairingSession(code);
  if (!session?.device) return null;
  session.status = "approved";
  session.approvedAt = new Date().toISOString();
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
  const explicitDevice = candidateDeviceId ? devices.get(candidateDeviceId)?.device : null;
  if (explicitDevice) return { ...explicitDevice, ...makeDevice(payload, explicitDevice.accountId), id: explicitDevice.id };

  const token = payload.pairingCode ?? pairingToken;
  if (token) {
    const normalized = normalizeCode(token);
    const session = pairingSessions.get(normalized);
    if (session && session.status !== "approved" && !session.device) {
      const device = makeDevice(payload, session.accountId, candidateDeviceId);
      session.status = "claimed";
      session.claimedAt = new Date().toISOString();
      session.deviceId = device.id;
      session.device = device;
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
    latestRoster: []
  };
  const socketOnline = existing?.socket?.readyState === WebSocket.OPEN;
  record.device = {
    ...device,
    status: socketOnline ? "online" : device.status,
    lastSeenAt: socketOnline ? new Date().toISOString() : device.lastSeenAt,
    providers: existing?.device.providers ?? device.providers
  };
  devices.set(device.id, record);
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

function makeDevice(request: Partial<DeviceRegistrationRequest> & Partial<DeviceHelloPayload>, accountId: string, explicitId?: string | null): AgentHubDevice {
  const name = request.name ?? request.deviceName ?? explicitId ?? "Device";
  const fingerprint = request.fingerprint ?? explicitId ?? `${name}-${request.platform ?? "unknown"}`;
  return {
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
