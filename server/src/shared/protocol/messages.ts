import type { AgentHubEnvelope } from './envelope.js';
import type { ProviderRecord } from '../../modules/provider/types.js';

export interface DeviceHelloPayload {
  deviceId: string;
  deviceName: string;
  platform: string;
  service: string;
  capabilities: string[];
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

export interface AgentChatRequestPayload {
  providerId?: string;
  agent?: string;
  sessionId?: string;
  message: string;
  model?: string;
}

export interface AgentChatResponsePayload {
  providerId: string;
  agent: string;
  sessionId: string;
  text: string;
  runtime: string;
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
