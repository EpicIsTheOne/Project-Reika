export type Status = "online" | "offline" | "connecting" | "busy" | "thinking" | "error" | "unknown";

export type DeviceType = "pc" | "laptop" | "server" | "phone" | "unknown";

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  status: Status;
  location: string;
  systemLabel?: string;
  lastSeenAt?: string;
  localIp?: string;
  agentVersion?: string;
  metrics?: { cpu?: number; ram?: number; disk?: number };
  activeProviderId?: string;
  providers: Provider[];
}

export interface Provider {
  id: string;
  name: "Hermes" | "OpenClaw" | "CommandCenter" | "Mock" | "Custom";
  deviceId: string;
  status: Status;
  latency: string;
  agents: Agent[];
  relayProviderId?: string;
}

export interface Agent {
  id: string;
  name: string;
  providerId: string;
  deviceId: string;
  role: string;
  status: Status;
  lastActivity: string;
  characterId?: string;
  relayAgentId?: string;
  relayProviderId?: string;
  voiceProvider?: string;
  voiceId?: string;
  voiceLabel?: string;
  voiceAvailable?: boolean;
  voiceSettings?: Record<string, unknown>;
}

export interface CharacterProfile {
  id: string;
  displayName: string;
  shortDescription: string;
  providerId: string;
  deviceId: string;
  avatarPath: string;
  splashPath: string;
  halfBodyPath: string;
  chibiPath: string;
  roomBackgroundPath: string;
  themeColor: string;
  defaultExpression: keyof CharacterExpressions;
  availableExpressions: CharacterExpressions;
  statusMessages: Record<string, string>;
}

export interface CharacterExpressions {
  neutral: string;
  happy: string;
  thinking: string;
  playful: string;
}

export interface ChatMessage {
  id: string;
  sender: "user" | "agent" | "system";
  body: string;
  time: string;
  meta?: Record<string, unknown>;
}

export type View = "loading" | "home" | "chat" | "devices" | "notifications" | "memory" | "agentArt" | "settings";
