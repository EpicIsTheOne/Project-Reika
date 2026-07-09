import type { AgentHubAgent, AgentHubDevice } from "../shared/agenthub";
import { relayApiUrl, relayAppWebSocketUrl, relayDeviceWebSocketUrl, sameOriginRelayAppWebSocketUrl } from "../config/relay";
import {
  createEnvelope,
  isAgentHubEnvelope,
  type AgentChatRequestPayload,
  type AgentChatResponsePayload,
  type AgentHubEnvelope,
  type AgentHubEnvelopeType,
  type DeviceStateSnapshotPayload
} from "../shared/protocol";
import type { ReikaChatMessage, ReikaSessionSummary } from "../lib/reikaApi";

export interface RelayPairing {
  code: string;
  accountId: string;
  status: "created" | "claimed" | "approved";
  expiresAt: string;
  claimedAt?: string;
  approvedAt?: string;
  deviceId?: string;
}

export interface RelayDeviceRecord {
  device: AgentHubDevice;
  activeProviderId?: string;
  agents: AgentHubAgent[];
  lastEnvelopeAt: string;
  lastCommand?: string;
}

export interface RelayChatSessionInput {
  id?: string;
  deviceId: string;
  providerId: string;
  agent: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface RelayChatMessageInput {
  id?: string;
  role: ReikaChatMessage["role"];
  text: string;
  timestamp?: string;
  meta?: Record<string, unknown>;
}

interface PairingResponse {
  ok: boolean;
  pairing: RelayPairing;
  device?: AgentHubDevice;
  error?: string;
}

export async function createRelayPairingCode(relayUrl?: string) {
  const response = await fetch(relayApiUrl("/pairing/create", relayUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const payload = (await response.json()) as PairingResponse;
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Relay pairing create failed.");
  return payload.pairing;
}

export async function getRelayPairingCode(code: string, relayUrl?: string) {
  const response = await fetch(relayApiUrl(`/pairing/${encodeURIComponent(code)}`, relayUrl));
  const payload = (await response.json()) as PairingResponse;
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Relay pairing status failed.");
  return payload;
}

export async function claimRelayPairingCode(code: string, device: Partial<AgentHubDevice>, relayUrl?: string) {
  const response = await fetch(relayApiUrl("/pairing/claim", relayUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, device })
  });
  const payload = (await response.json()) as PairingResponse;
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Relay pairing claim failed.");
  return payload;
}

export async function listRelayDevices(relayUrl?: string) {
  const response = await fetch(relayApiUrl("/devices", relayUrl));
  const payload = (await response.json()) as {
    ok: boolean;
    devices?: Array<{
      device: AgentHubDevice;
      activeProviderId?: string;
      lastHeartbeatAt?: string;
      socketConnected?: boolean;
    }>;
    error?: string;
  };
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Relay device list failed.");
  return (payload.devices ?? []).map((record): RelayDeviceRecord => ({
    device: {
      ...record.device,
      status: record.socketConnected ? "online" : "offline",
      providers: record.socketConnected
        ? record.device.providers
        : record.device.providers?.map((provider) => ({
            ...provider,
            status: "offline",
            agents: provider.agents.map((agent) => ({ ...agent, status: "offline" }))
          }))
    },
    activeProviderId: record.activeProviderId,
    agents: record.device.providers?.flatMap((provider) => provider.agents) ?? [],
    lastEnvelopeAt: record.lastHeartbeatAt ?? record.device.lastSeenAt ?? new Date().toISOString()
  }));
}

export async function listRelayChatSessions(
  input: { deviceId?: string; providerId?: string; agent?: string; q?: string; limit?: number },
  relayUrl?: string
) {
  const params = compactRelayParams({
    deviceId: input.deviceId,
    providerId: input.providerId,
    agent: input.agent,
    q: input.q,
    limit: input.limit
  });
  const response = await fetch(relayApiUrl(`/chat/sessions${params}`, relayUrl));
  const payload = (await response.json()) as { ok: boolean; sessions?: ReikaSessionSummary[]; error?: string };
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Relay chat session list failed.");
  return payload.sessions ?? [];
}

export async function createRelayChatSession(input: RelayChatSessionInput, relayUrl?: string) {
  const response = await fetch(relayApiUrl("/chat/sessions", relayUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const payload = (await response.json()) as { ok: boolean; session?: ReikaSessionSummary; error?: string };
  if (!response.ok || !payload.ok || !payload.session) throw new Error(payload.error ?? "Relay chat session create failed.");
  return payload.session;
}

export async function getRelayChatMessages(sessionId: string, relayUrl?: string, limit?: number) {
  const params = compactRelayParams({ limit });
  const response = await fetch(relayApiUrl(`/chat/sessions/${encodeURIComponent(sessionId)}/messages${params}`, relayUrl));
  const payload = (await response.json()) as { ok: boolean; sessionId?: string; messages?: ReikaChatMessage[]; error?: string };
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Relay chat messages failed.");
  return payload.messages ?? [];
}

export async function appendRelayChatMessages(sessionId: string, messages: RelayChatMessageInput[], relayUrl?: string) {
  const response = await fetch(relayApiUrl(`/chat/sessions/${encodeURIComponent(sessionId)}/messages`, relayUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages })
  });
  const payload = (await response.json()) as { ok: boolean; session?: ReikaSessionSummary; messages?: ReikaChatMessage[]; error?: string };
  if (!response.ok || !payload.ok || !payload.session) throw new Error(payload.error ?? "Relay chat message persist failed.");
  return payload;
}

export async function approveRelayPairingCode(code: string, relayUrl?: string) {
  const response = await fetch(relayApiUrl("/pairing/approve", relayUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });
  const payload = (await response.json()) as PairingResponse;
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Relay pairing approval failed.");
  return payload;
}

export async function requestRelayDevice(
  type: Extract<AgentHubEnvelopeType, "device.state.request" | "provider.refresh.request" | "agent.roster.request">,
  deviceId: string,
  payload: Record<string, unknown> = {},
  relayUrl?: string
) {
  const response = await fetch(relayApiUrl(`/devices/${encodeURIComponent(deviceId)}/request`, relayUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, payload })
  });
  const result = (await response.json()) as { ok: boolean; envelope?: AgentHubEnvelope; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.error ?? "Relay request failed.");
  return result.envelope;
}

export async function sendRelayChat(
  deviceId: string,
  payload: AgentChatRequestPayload,
  relayUrl?: string,
  timeoutMs = 120000
): Promise<AgentChatResponsePayload> {
  const request = createEnvelope("agent.chat.request", payload, {
    deviceId,
    source: { kind: "app", id: "agenthub-client" },
    target: { kind: "device", id: deviceId }
  });
  const directUrl = getRelayAppWebSocketUrl(relayUrl);
  const sameOriginUrl = sameOriginRelayAppWebSocketUrl();
  const urls = [...new Set([sameOriginUrl, directUrl].filter((url): url is string => Boolean(url)))];
  let lastError: Error | undefined;
  for (const url of urls) {
    try {
      return await sendRelayChatOverSocket(url, request, timeoutMs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("Relay app socket could not connect for chat.");
}

function sendRelayChatOverSocket(
  socketUrl: string,
  request: AgentHubEnvelope<AgentChatRequestPayload>,
  timeoutMs: number
): Promise<AgentChatResponsePayload> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl);
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      socket.close();
      callback();
    };
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error("Relay chat timed out waiting for the device response.")));
    }, timeoutMs);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify(request));
    });

    socket.addEventListener("message", (event) => {
      void (async () => {
      try {
        const envelope = JSON.parse(await readWebSocketMessage(event.data)) as unknown;
        if (!isAgentHubEnvelope(envelope)) return;
        const matchesRequest = envelope.replyTo === request.id || envelope.correlationId === request.id;
        if (!matchesRequest) return;
        if (envelope.type === "command.accepted") return;
        if (envelope.type === "agent.chat.response") {
          finish(() => resolve(envelope.payload as AgentChatResponsePayload));
          return;
        }
        if (envelope.type === "command.rejected" || envelope.type === "command.failed") {
          const message = (envelope.payload as { message?: string; reason?: string }).message ?? (envelope.payload as { reason?: string }).reason ?? "Relay chat request failed.";
          finish(() => reject(new Error(message)));
        }
      } catch {
        // Ignore malformed relay messages while waiting for the correlated response.
      }
      })();
    });

    socket.addEventListener("error", () => {
      finish(() => reject(new Error("Relay app socket could not connect for chat.")));
    });

    socket.addEventListener("close", () => {
      if (!settled) finish(() => reject(new Error("Relay app socket closed before chat completed.")));
    });
  });
}

async function readWebSocketMessage(data: MessageEvent["data"]) {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data);
}

export function connectRelayApp(onEnvelope: (envelope: AgentHubEnvelope) => void, onStatus: (status: "connecting" | "online" | "offline") => void, relayUrl?: string) {
  let closed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let currentStatus: "connecting" | "online" | "offline" = "connecting";
  const socketUrls = [...new Set([sameOriginRelayAppWebSocketUrl(), getRelayAppWebSocketUrl(relayUrl)].filter((url): url is string => Boolean(url)))];
  let socketUrlIndex = 0;
  const openWaiters = new Set<{
    resolve: () => void;
    reject: (error: Error) => void;
    timer: number;
  }>();

  const setStatus = (status: "connecting" | "online" | "offline") => {
    currentStatus = status;
    onStatus(status);
  };

  const rejectOpenWaiters = (message: string) => {
    for (const waiter of openWaiters) {
      window.clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
    }
    openWaiters.clear();
  };

  const resolveOpenWaiters = () => {
    for (const waiter of openWaiters) {
      window.clearTimeout(waiter.timer);
      waiter.resolve();
    }
    openWaiters.clear();
  };

  const connect = () => {
    setStatus("connecting");
    const socketUrl = socketUrls[socketUrlIndex] ?? getRelayAppWebSocketUrl(relayUrl);
    let opened = false;
    socket = new WebSocket(socketUrl);

    socket.addEventListener("open", () => {
      opened = true;
      setStatus("online");
      resolveOpenWaiters();
    });

    socket.addEventListener("message", (event) => {
      void (async () => {
      try {
        const parsed = JSON.parse(await readWebSocketMessage(event.data)) as unknown;
        if (isAgentHubEnvelope(parsed)) onEnvelope(parsed);
      } catch {
        // Ignore malformed dev relay messages; the relay should not send them.
      }
      })();
    });

    socket.addEventListener("close", () => {
      if (closed) return;
      setStatus("offline");
      if (!opened && socketUrlIndex < socketUrls.length - 1) {
        socketUrlIndex += 1;
        reconnectTimer = window.setTimeout(connect, 250);
        return;
      }
      socketUrlIndex = 0;
      reconnectTimer = window.setTimeout(connect, 3000);
    });

    socket.addEventListener("error", () => {
      if (closed) return;
      setStatus("offline");
    });
  };

  connect();

  return {
    send(
      type: Extract<AgentHubEnvelopeType, "device.state.request" | "provider.refresh.request" | "agent.roster.request" | "agent.chat.request">,
      deviceId: string,
      payload: Record<string, unknown> = {}
    ) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(createEnvelope(type, payload, { deviceId })));
      return true;
    },
    sendEnvelope(envelope: AgentHubEnvelope) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(envelope));
      return true;
    },
    async sendEnvelopeWhenOpen(envelope: AgentHubEnvelope, timeoutMs = 12000) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => {
            openWaiters.delete(waiter);
            reject(new Error(currentStatus === "offline" ? "Relay app socket is offline. Check the relay URL and try again." : "Relay app socket did not connect in time. Try again in a moment."));
          }, timeoutMs);
          const waiter = { resolve, reject, timer };
          openWaiters.add(waiter);
        });
      }
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error("Relay app socket is not open.");
      }
      socket.send(JSON.stringify(envelope));
    },
    status() {
      return currentStatus;
    },
    close() {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      rejectOpenWaiters("Relay app socket was closed.");
      socket?.close();
    }
  };
}

export function applyRelayEnvelope(current: RelayDeviceRecord[], envelope: AgentHubEnvelope): RelayDeviceRecord[] {
  if (envelope.type === "device.state.snapshot") {
    const payload = unwrapStateSnapshot(envelope.payload);
    const deviceId = payload.device?.id ?? getEnvelopeDeviceId(envelope);
    const existing = current.find((record) => record.device.id === deviceId);
    const device = payload.device ?? existing?.device;
    if (!device) return current;
    const providers = device.providers?.length > 0 ? device.providers : existing?.device.providers ?? [];
    const agents = providers.flatMap((provider) => provider.agents);
    return upsertRelayRecord(current, {
      device: {
        ...device,
        providers
      },
      activeProviderId: payload.activeProviderId,
      agents: agents.length > 0 ? agents : existing?.agents ?? [],
      lastEnvelopeAt: envelope.timestamp
    });
  }

  if (envelope.type === "device.provider.snapshot") {
    const deviceId = getEnvelopeDeviceId(envelope);
    if (!deviceId) return current;
    return current.map((record) =>
      record.device.id === deviceId
        ? {
            ...record,
            lastEnvelopeAt: envelope.timestamp
          }
        : record
    );
  }

  if (envelope.type === "agent.roster.snapshot") {
    const payload = envelope.payload as { deviceId?: string; providerId?: string; agents?: Array<Partial<AgentHubAgent> & { label?: string; source?: string }> };
    const deviceId = payload.deviceId ?? getEnvelopeDeviceId(envelope);
    if (!deviceId) return current;
    return current.map((record) =>
      record.device.id === deviceId ? mergeRosterSnapshot(record, payload, envelope.timestamp) : record
    );
  }

  const commandDeviceId = getEnvelopeDeviceId(envelope);
  if (envelope.type.startsWith("command.") && commandDeviceId) {
    const payload = envelope.payload as { message?: string };
    return current.map((record) =>
      record.device.id === commandDeviceId
        ? {
            ...record,
            lastCommand: payload.message ?? envelope.type,
            lastEnvelopeAt: envelope.timestamp
          }
        : record
    );
  }

  return current;
}

function upsertRelayRecord(records: RelayDeviceRecord[], next: RelayDeviceRecord) {
  const existing = records.some((record) => record.device.id === next.device.id);
  if (!existing) return [next, ...records];
  return records.map((record) =>
    record.device.id === next.device.id
      ? {
          ...record,
          ...next,
          lastCommand: next.lastCommand ?? record.lastCommand
        }
      : record
  );
}

export function getRelayAppWebSocketUrl(relayUrl?: string) {
  return relayAppWebSocketUrl(relayUrl);
}

export function getRelayDeviceWebSocketUrl(relayUrl?: string) {
  return relayDeviceWebSocketUrl(relayUrl);
}

function getEnvelopeDeviceId(envelope: AgentHubEnvelope) {
  return envelope.deviceId ?? (envelope.payload as { deviceId?: string } | undefined)?.deviceId ?? envelope.source?.id;
}

function unwrapStateSnapshot(payload: unknown): Partial<DeviceStateSnapshotPayload> {
  const direct = payload as Partial<DeviceStateSnapshotPayload> & {
    snapshot?: {
      device?: Partial<AgentHubDevice> & { platform?: string; startedAt?: string; hostname?: string };
      activeProviderId?: string;
    };
  };
  if (direct.device) return direct;
  if (!direct.snapshot?.device) return {};
  const device = direct.snapshot.device;
  return {
    device: {
      id: device.id ?? "unknown-device",
      accountId: device.accountId ?? "epic-local",
      name: device.name ?? device.hostname ?? "Device",
      type: device.type ?? (String(device.platform ?? "").includes("linux") ? "server" : "pc"),
      status: String(device.status ?? "") === "ready" ? "online" : device.status ?? "unknown",
      location: device.location ?? "remote",
      agentVersion: device.agentVersion ?? "unknown",
      fingerprint: device.fingerprint ?? device.id ?? "unknown-device",
      trusted: device.trusted ?? false,
      lastSeenAt: new Date().toISOString(),
      providers: device.providers ?? []
    },
    activeProviderId: direct.snapshot.activeProviderId
  };
}

function mergeRosterSnapshot(
  record: RelayDeviceRecord,
  payload: { providerId?: string; agents?: Array<Partial<AgentHubAgent> & { label?: string; source?: string }> },
  timestamp: string
): RelayDeviceRecord {
  const agents = payload.agents ?? [];
  const providerId = payload.providerId;
  const hasProviderScopedAgents = agents.some((agent) => typeof agent.providerId === "string" && agent.providerId);
  if (!providerId && !hasProviderScopedAgents) {
    return {
      ...record,
      lastEnvelopeAt: timestamp
    };
  }

  return {
    ...record,
    agents: normalizeRosterAgents(agents, record.device.id, providerId ?? "unknown"),
    lastEnvelopeAt: timestamp
  };
}

function normalizeRosterAgents(agents: Array<Partial<AgentHubAgent> & { label?: string; source?: string }>, deviceId: string, providerId: string): AgentHubAgent[] {
  return agents.map((agent, index) => ({
    id: agent.id ?? `${providerId}-agent-${index + 1}`,
    providerId: agent.providerId ?? providerId,
    deviceId: agent.deviceId ?? deviceId,
    name: agent.name ?? agent.label ?? "Agent",
    role: agent.role ?? agent.source ?? "Agent",
    status: agent.status ?? "online",
    characterId: agent.characterId,
    avatar: agent.avatar,
    capabilities: agent.capabilities ?? [],
    lastActivity: agent.lastActivity ?? "Updated through relay",
    updatedAt: agent.updatedAt ?? new Date().toISOString()
  }));
}

function compactRelayParams(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
