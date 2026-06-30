import type { AgentHubAgent, AgentHubDevice } from "../shared/agenthub";
import { relayApiUrl, relayAppWebSocketUrl, relayDeviceWebSocketUrl } from "../config/relay";
import {
  createEnvelope,
  isAgentHubEnvelope,
  type AgentHubEnvelope,
  type AgentHubEnvelopeType,
  type DeviceStateSnapshotPayload
} from "../shared/protocol";

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

export function connectRelayApp(onEnvelope: (envelope: AgentHubEnvelope) => void, onStatus: (status: "connecting" | "online" | "offline") => void, relayUrl?: string) {
  let closed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;

  const connect = () => {
    onStatus("connecting");
    socket = new WebSocket(getRelayAppWebSocketUrl(relayUrl));

    socket.addEventListener("open", () => {
      onStatus("online");
    });

    socket.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as unknown;
        if (isAgentHubEnvelope(parsed)) onEnvelope(parsed);
      } catch {
        // Ignore malformed dev relay messages; the relay should not send them.
      }
    });

    socket.addEventListener("close", () => {
      onStatus("offline");
      if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
    });

    socket.addEventListener("error", () => {
      onStatus("offline");
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
    close() {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
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
      record.device.id === deviceId
        ? {
            ...record,
            agents: normalizeRosterAgents(payload.agents ?? [], deviceId, payload.providerId ?? record.activeProviderId ?? "unknown"),
            lastEnvelopeAt: envelope.timestamp
          }
        : record
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
