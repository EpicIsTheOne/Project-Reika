import { Bell, BrainCircuit, Home, MessageCircle, Monitor, PanelsTopLeft, Settings, WandSparkles } from "lucide-react";
import { defaultReikaRelayDeviceUrl } from "../config/relay";
import type { ReikaSettings } from "../lib/reikaApi";
import type { Device, Status } from "../types";

export const statusLabels: Record<Status, string> = {
  online: "Online",
  offline: "Offline",
  connecting: "Connecting",
  busy: "Busy",
  thinking: "Thinking",
  error: "Error",
  unknown: "Unknown"
};

export const navItems = [
  { key: "home", route: "home" as const, label: "Home", icon: Home },
  { key: "chat", route: "chat" as const, label: "Chats", icon: MessageCircle },
  { key: "command-center", route: "commandCenter" as const, label: "Command Center", icon: PanelsTopLeft },
  { key: "devices", route: "devices" as const, label: "Devices", icon: Monitor },
  { key: "notifications", route: "notifications" as const, label: "Notifications", icon: Bell },
  { key: "memory", route: "memory" as const, label: "Memory", icon: BrainCircuit },
  { key: "agent-art", route: "agentArt" as const, label: "Agent Art", icon: WandSparkles },
  { key: "settings", route: "settings" as const, label: "Settings", icon: Settings }
];

export const defaultSettings: ReikaSettings = {
  version: 1,
  language: "English",
  startupView: "home",
  relayUrl: defaultReikaRelayDeviceUrl,
  theme: "dark",
  minimizeToTray: true,
  mockEnabled: true,
  notificationPreferences: {
    agent: true,
    device: true,
    provider: true,
    chat: true,
    file: true,
    system: true,
    warning: true
  },
  agentSelector: {
    labelMode: "agent-provider",
    showRole: true,
    hideCommandCenterDuplicates: true,
    duplicatePreference: "commandcenter"
  },
  projectDiscovery: {
    enabled: true,
    roots: [],
    excludeDirectories: ["node_modules", ".git", "dist", "build", "release"],
    maxDepth: 4,
    scanIntervalMinutes: 15
  },
  voice: {
    speakAgentReplies: false,
    defaultVoice: { provider: "system", voiceId: "system-default", voiceLabel: "System default" },
    agents: {}
  },
  autoUpdateServer: false,
  autoUpdateClient: false,
  developerDiagnostics: false,
  updatedAt: new Date(0).toISOString()
};

export const emptyDevice: Device = {
  id: "offline-local",
  name: "Local Agent Offline",
  type: "unknown",
  status: "offline",
  location: "Local",
  providers: []
};

export const demoFallbackLabel = "Demo fallback";
