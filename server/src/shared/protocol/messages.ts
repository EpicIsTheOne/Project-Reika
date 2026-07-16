import type { AgentHubEnvelope } from './envelope.js';
import type { ProviderRecord } from '../../modules/provider/types.js';

export interface DeviceHelloPayload {
  deviceId: string;
  deviceName: string;
  platform: string;
  service: string;
  capabilities: string[];
  pairingCode?: string;
}

export interface DeviceHeartbeatPayload {
  deviceId: string;
  status: 'ready' | 'degraded' | 'offline';
  activeProviderId: string;
  uptimeSeconds: number;
}

export interface DeviceStateRequestPayload {
  includeProviders?: boolean;
  includeAgents?: boolean;
}

export interface DeviceStateSnapshotPayload {
  snapshot: unknown;
}

export interface ProviderSnapshotPayload {
  activeProviderId: string;
  providers: ProviderRecord[];
}

export interface AgentRosterRequestPayload {
  providerId?: string;
}

export interface AgentRosterSnapshotPayload {
  providerId: string;
  agents: ProviderRecord['agents'];
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

export type ProjectDiscoverySource = 'explicit' | 'git' | 'marker';
export type ProjectDiscoveryConfidence = 'explicit' | 'high' | 'medium';

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

export type DeliveryState = 'accepted' | 'delivered' | 'executing' | 'completed' | 'failed';

export interface CommandStatusPayload {
  ok: boolean;
  message: string;
  state: DeliveryState;
  requestId: string;
  legacy?: boolean;
}

export interface CommandStatusRequestPayload {
  requestId: string;
  sessionId?: string;
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

export interface AgentVoiceRequestPayload {
  providerId?: string;
  agent: string;
  text: string;
  requestId?: string;
}

export interface AgentVoiceResponsePayload {
  provider: 'commandcenter';
  agent: string;
  voiceId?: string;
  contentType: string;
  audioBase64: string;
  requestId?: string;
}

export type AgentActivityStatus = 'idle' | 'thinking' | 'responding' | 'tool_use' | 'error' | 'active';

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

export interface CommandAcceptedPayload {
  commandType: string;
}

export interface CommandRejectedPayload {
  commandType: string;
  reason: 'UNSUPPORTED_COMMAND' | 'INVALID_PAYLOAD' | 'UPLINK_DISABLED' | 'INTERNAL_ERROR';
  message: string;
}

export interface CommandCompletedPayload {
  commandType: string;
}

export interface CommandFailedPayload {
  commandType: string;
  reason: string;
  message: string;
}

export type InboundDeviceCommand = AgentHubEnvelope<DeviceStateRequestPayload | AgentRosterRequestPayload | Record<string, never>>;
