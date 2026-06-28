export type AgentHubStatus = "online" | "offline" | "connecting" | "busy" | "thinking" | "error" | "unknown";

export type DeviceType = "pc" | "laptop" | "server" | "phone" | "unknown";

export type ProviderKind = "hermes" | "commandcenter" | "openclaw" | "mock" | "custom";

export type ProviderCapability =
  | "status"
  | "agent-discovery"
  | "chat"
  | "streaming-chat"
  | "files"
  | "tools"
  | "voice"
  | "logs";

export interface AgentHubAccount {
  id: string;
  displayName: string;
  createdAt: string;
}

export interface AgentHubAgent {
  id: string;
  providerId: string;
  deviceId: string;
  name: string;
  role: string;
  status: AgentHubStatus;
  characterId?: string;
  avatar?: string;
  lastActivity?: string;
  capabilities: ProviderCapability[];
  updatedAt: string;
}

export interface AgentHubProvider {
  id: string;
  deviceId: string;
  kind: ProviderKind;
  name: string;
  status: AgentHubStatus;
  endpoint?: string;
  version?: string;
  lastSeenAt: string;
  capabilities: ProviderCapability[];
  agents: AgentHubAgent[];
  error?: string;
  remote: boolean;
}

export interface AgentHubDevice {
  id: string;
  accountId: string;
  name: string;
  type: DeviceType;
  status: AgentHubStatus;
  location: "local" | "lan" | "remote";
  agentVersion: string;
  fingerprint: string;
  trusted: boolean;
  lastSeenAt: string;
  providers: AgentHubProvider[];
}

export interface DeviceRegistrationRequest {
  accountId?: string;
  pairingCode?: string;
  deviceToken?: string;
  name: string;
  type: DeviceType;
  fingerprint: string;
  agentVersion: string;
  location?: AgentHubDevice["location"];
}

export interface DeviceRegistrationResponse {
  ok: boolean;
  account: AgentHubAccount;
  device: AgentHubDevice;
  deviceToken?: string;
  error?: string;
}

export interface ProviderSnapshot {
  deviceId: string;
  providers: Array<{
    id?: string;
    kind: ProviderKind;
    name: string;
    status: AgentHubStatus;
    endpoint?: string;
    version?: string;
    capabilities: ProviderCapability[];
    agents: Array<{
      id?: string;
      name: string;
      role: string;
      status: AgentHubStatus;
      characterId?: string;
      avatar?: string;
      capabilities?: ProviderCapability[];
      lastActivity?: string;
    }>;
    error?: string;
  }>;
}

export interface PairingCode {
  code: string;
  accountId: string;
  expiresAt: string;
  claimedAt?: string;
}

export interface AgentMessageRequest {
  conversationId?: string;
  message: string;
}

export interface AgentMessageResponse {
  ok: boolean;
  agentId: string;
  providerId: string;
  deviceId: string;
  message?: string;
  status: AgentHubStatus;
  error?: string;
}

export type DeviceAgentClientMessage =
  | {
      type: "hello";
      request: DeviceRegistrationRequest;
    }
  | {
      type: "provider-snapshot";
      snapshot: ProviderSnapshot;
    }
  | {
      type: "heartbeat";
      deviceId: string;
      providers?: ProviderSnapshot["providers"];
    };

export type DeviceAgentServerMessage =
  | {
      type: "registered";
      response: DeviceRegistrationResponse;
    }
  | {
      type: "error";
      error: string;
    }
  | {
      type: "ack";
      ok: true;
      at: string;
    };
