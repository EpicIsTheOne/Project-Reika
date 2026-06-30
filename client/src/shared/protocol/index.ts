import type { AgentHubAgent, AgentHubDevice, DeviceRegistrationRequest, ProviderSnapshot } from "../agenthub";

export const AGENTHUB_PROTOCOL_VERSION = 1;

export const agentHubEnvelopeTypes = [
  "device.hello",
  "device.heartbeat",
  "device.state.request",
  "device.state.snapshot",
  "device.provider.snapshot",
  "provider.refresh.request",
  "agent.roster.request",
  "agent.roster.snapshot",
  "command.accepted",
  "command.rejected",
  "command.completed",
  "command.failed"
] as const;

export type AgentHubEnvelopeType = (typeof agentHubEnvelopeTypes)[number];

export interface DeviceHelloPayload extends DeviceRegistrationRequest {
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  service?: string;
  capabilities?: string[];
}

export interface DeviceStateSnapshotPayload {
  device: AgentHubDevice;
  activeProviderId?: string;
  providers: ProviderSnapshot["providers"];
}

export interface AgentRosterSnapshotPayload {
  deviceId: string;
  agents: AgentHubAgent[];
}

export interface AgentChatRequestPayload {
  providerId?: string;
  agent?: string;
  sessionId?: string;
  message: string;
  model?: string;
  fileIds?: string[];
}

export interface AgentChatResponsePayload {
  providerId: string;
  agent: string;
  sessionId: string;
  text: string;
  runtime: string;
}

export interface CommandStatusPayload {
  ok: boolean;
  message: string;
}

export interface AgentHubEndpoint {
  kind: "app" | "device" | "relay";
  id: string;
}

export interface AgentHubEnvelope<TPayload = unknown> {
  v: 1;
  id: string;
  type: AgentHubEnvelopeType;
  timestamp: string;
  source?: AgentHubEndpoint;
  target?: AgentHubEndpoint;
  accountId?: string;
  deviceId?: string;
  replyTo?: string;
  correlationId?: string;
  commandId?: string;
  payload: TPayload;
}

export type DeviceHelloEnvelope = AgentHubEnvelope<DeviceHelloPayload> & { type: "device.hello" };
export type DeviceHeartbeatEnvelope = AgentHubEnvelope<{ status?: string }> & { type: "device.heartbeat" };
export type DeviceStateRequestEnvelope = AgentHubEnvelope<Record<string, never>> & { type: "device.state.request" };
export type DeviceStateSnapshotEnvelope = AgentHubEnvelope<DeviceStateSnapshotPayload> & { type: "device.state.snapshot" };
export type DeviceProviderSnapshotEnvelope = AgentHubEnvelope<ProviderSnapshot> & { type: "device.provider.snapshot" };
export type ProviderRefreshRequestEnvelope = AgentHubEnvelope<Record<string, never>> & { type: "provider.refresh.request" };
export type AgentRosterRequestEnvelope = AgentHubEnvelope<Record<string, never>> & { type: "agent.roster.request" };
export type AgentRosterSnapshotEnvelope = AgentHubEnvelope<AgentRosterSnapshotPayload> & { type: "agent.roster.snapshot" };
export type CommandAcceptedEnvelope = AgentHubEnvelope<CommandStatusPayload> & { type: "command.accepted" };
export type CommandRejectedEnvelope = AgentHubEnvelope<CommandStatusPayload> & { type: "command.rejected" };
export type CommandCompletedEnvelope = AgentHubEnvelope<CommandStatusPayload> & { type: "command.completed" };
export type CommandFailedEnvelope = AgentHubEnvelope<CommandStatusPayload> & { type: "command.failed" };

export type KnownAgentHubEnvelope =
  | DeviceHelloEnvelope
  | DeviceHeartbeatEnvelope
  | DeviceStateRequestEnvelope
  | DeviceStateSnapshotEnvelope
  | DeviceProviderSnapshotEnvelope
  | ProviderRefreshRequestEnvelope
  | AgentRosterRequestEnvelope
  | AgentRosterSnapshotEnvelope
  | CommandAcceptedEnvelope
  | CommandRejectedEnvelope
  | CommandCompletedEnvelope
  | CommandFailedEnvelope;

export function createEnvelope<TPayload>(
  type: AgentHubEnvelopeType,
  payload: TPayload,
  options: Partial<Omit<AgentHubEnvelope<TPayload>, "v" | "id" | "type" | "timestamp" | "payload">> = {}
): AgentHubEnvelope<TPayload> {
  return {
    v: AGENTHUB_PROTOCOL_VERSION,
    id: createEnvelopeId(),
    type,
    timestamp: new Date().toISOString(),
    payload,
    ...options
  };
}

export function isAgentHubEnvelope(value: unknown): value is KnownAgentHubEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AgentHubEnvelope>;
  return (
    candidate.v === AGENTHUB_PROTOCOL_VERSION &&
    typeof candidate.id === "string" &&
    typeof candidate.timestamp === "string" &&
    typeof candidate.type === "string" &&
    agentHubEnvelopeTypes.includes(candidate.type as AgentHubEnvelopeType) &&
    "payload" in candidate
  );
}

export function isRelayRequestType(type: AgentHubEnvelopeType) {
  return type === "device.state.request" || type === "provider.refresh.request" || type === "agent.roster.request";
}

export function createEnvelopeId(prefix = "env") {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}
