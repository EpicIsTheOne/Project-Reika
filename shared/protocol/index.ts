import type { AgentHubAgent, AgentHubDevice, DeviceRegistrationRequest, ProviderSnapshot } from "../agenthub.js";

export const AGENTHUB_PROTOCOL_VERSION = 1;

export const agentHubEnvelopeTypes = [
  "device.hello",
  "device.heartbeat",
  "device.state.request",
  "device.state.snapshot",
  "device.provider.snapshot",
  "device.project.snapshot",
  "provider.refresh.request",
  "agent.roster.request",
  "agent.roster.snapshot",
  "agent.chat.request",
  "agent.chat.response",
  "agent.voice.request",
  "agent.voice.response",
  "agent.activity",
  "command.status",
  "command.status.request",
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

export type AgentChatMode = 'agent' | 'roleplay';

export interface AgentChatRequestPayload {
  providerId?: string;
  agent?: string;
  sessionId?: string;
  providerSessionId?: string;
  message: string;
  mode?: AgentChatMode;
  model?: string;
  fileIds?: string[];
  delivery?: {
    idempotencyKey?: string;
    statusMetadataVersion?: 1;
  };
}

export interface AgentChatResponsePayload {
  providerId: string;
  agent: string;
  sessionId: string;
  text: string;
  runtime: string;
  mode?: AgentChatMode;
  model?: string;
  providerSessionId?: string;
}

export type AgentActivityStatus = "idle" | "thinking" | "responding" | "tool_use" | "error" | "active";

export interface AgentActivityPayload {
  deviceId: string;
  providerId?: string;
  agent: string;
  status: AgentActivityStatus;
  message?: string;
  tool?: string;
  input?: unknown;
  sessionId?: string;
  providerSessionId?: string;
  source?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
  commandId?: string;
  correlationId?: string;
  toolCallId?: string;
}

export interface CommandStatusPayload {
  ok: boolean;
  message: string;
  state?: DeliveryState;
  requestId?: string;
  legacy?: boolean;
}

export interface AgentVoiceRequestPayload {
  providerId?: string;
  agent: string;
  text: string;
  requestId?: string;
}

export interface AgentVoiceResponsePayload {
  provider: "commandcenter";
  agent: string;
  voiceId?: string;
  contentType: string;
  audioBase64: string;
  requestId?: string;
}

export type ProjectDiscoverySource = "explicit" | "git" | "marker";
export type ProjectDiscoveryConfidence = "explicit" | "high" | "medium";

export interface ProjectDiscoveryEntry {
  projectId: string;
  identityKey: string;
  name: string;
  description: string;
  aliases: string[];
  path: string;
  repositoryUrl?: string;
  branch?: string;
  technologyStack: string[];
  source: ProjectDiscoverySource;
  confidence: ProjectDiscoveryConfidence;
  discoveredAt: string;
}

export interface ProjectDiscoverySnapshotPayload {
  deviceId: string;
  scannedAt: string;
  complete: boolean;
  roots: string[];
  skippedPaths?: string[];
  defaultAgentId?: string;
  projects: ProjectDiscoveryEntry[];
}

export type DeliveryState = "accepted" | "delivered" | "executing" | "completed" | "failed";

export interface CommandStatusRequestPayload {
  requestId: string;
  sessionId?: string;
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
  encrypted?: {
    alg: "x25519-xsalsa20-poly1305" | "age-v1" | "custom";
    keyId: string;
    contentType?: string;
  };
  payload: TPayload;
}

export type DeviceHelloEnvelope = AgentHubEnvelope<DeviceHelloPayload> & { type: "device.hello" };
export type DeviceHeartbeatEnvelope = AgentHubEnvelope<{ status?: string }> & { type: "device.heartbeat" };
export type DeviceStateRequestEnvelope = AgentHubEnvelope<Record<string, never>> & { type: "device.state.request" };
export type DeviceStateSnapshotEnvelope = AgentHubEnvelope<DeviceStateSnapshotPayload> & { type: "device.state.snapshot" };
export type DeviceProviderSnapshotEnvelope = AgentHubEnvelope<ProviderSnapshot> & { type: "device.provider.snapshot" };
export type DeviceProjectSnapshotEnvelope = AgentHubEnvelope<ProjectDiscoverySnapshotPayload> & { type: "device.project.snapshot" };
export type ProviderRefreshRequestEnvelope = AgentHubEnvelope<Record<string, never>> & { type: "provider.refresh.request" };
export type AgentRosterRequestEnvelope = AgentHubEnvelope<Record<string, never>> & { type: "agent.roster.request" };
export type AgentRosterSnapshotEnvelope = AgentHubEnvelope<AgentRosterSnapshotPayload> & { type: "agent.roster.snapshot" };
export type AgentChatRequestEnvelope = AgentHubEnvelope<AgentChatRequestPayload> & { type: "agent.chat.request" };
export type AgentChatResponseEnvelope = AgentHubEnvelope<AgentChatResponsePayload> & { type: "agent.chat.response" };
export type AgentVoiceRequestEnvelope = AgentHubEnvelope<AgentVoiceRequestPayload> & { type: "agent.voice.request" };
export type AgentVoiceResponseEnvelope = AgentHubEnvelope<AgentVoiceResponsePayload> & { type: "agent.voice.response" };
export type AgentActivityEnvelope = AgentHubEnvelope<AgentActivityPayload> & { type: "agent.activity" };
export type CommandAcceptedEnvelope = AgentHubEnvelope<CommandStatusPayload> & { type: "command.accepted" };
export type CommandStatusEnvelope = AgentHubEnvelope<CommandStatusPayload> & { type: "command.status" };
export type CommandStatusRequestEnvelope = AgentHubEnvelope<CommandStatusRequestPayload> & { type: "command.status.request" };
export type CommandRejectedEnvelope = AgentHubEnvelope<CommandStatusPayload> & { type: "command.rejected" };
export type CommandCompletedEnvelope = AgentHubEnvelope<CommandStatusPayload> & { type: "command.completed" };
export type CommandFailedEnvelope = AgentHubEnvelope<CommandStatusPayload> & { type: "command.failed" };

export type KnownAgentHubEnvelope =
  | DeviceHelloEnvelope
  | DeviceHeartbeatEnvelope
  | DeviceStateRequestEnvelope
  | DeviceStateSnapshotEnvelope
  | DeviceProviderSnapshotEnvelope
  | DeviceProjectSnapshotEnvelope
  | ProviderRefreshRequestEnvelope
  | AgentRosterRequestEnvelope
  | AgentRosterSnapshotEnvelope
  | AgentChatRequestEnvelope
  | AgentChatResponseEnvelope
  | AgentVoiceRequestEnvelope
  | AgentVoiceResponseEnvelope
  | AgentActivityEnvelope
  | CommandStatusEnvelope
  | CommandStatusRequestEnvelope
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
  return type === "device.state.request" || type === "provider.refresh.request" || type === "agent.roster.request" || type === "agent.chat.request" || type === "agent.voice.request" || type === "command.status.request";
}

export function createEnvelopeId(prefix = "env") {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}
