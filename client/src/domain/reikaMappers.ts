import { assets } from "../data/assets";
import { mapDevice } from "../data/api";
import { devices as demoDevices } from "../data/mockData";
import type { RelayDeviceRecord } from "../data/relay";
import type { LocalAgentStartupStatus } from "../data/startup";
import type { ArtRuntime } from "../lib/artRuntime";
import type { ReikaChatMessage, ReikaProviderRecord, ReikaStateResponse } from "../lib/reikaApi";
import type { Agent, ChatMessage, Device, Provider, Status } from "../types";

export type DevicePageRow = {
  id: string;
  name: string;
  icon: string;
  typeLabel: string;
  system: string;
  connection: string;
  status: Status;
  statusLabel?: string;
  tag?: string;
  tagTone?: "blue" | "green" | "purple" | "orange" | "gray";
  metrics?: { cpu?: number; ram?: number; disk?: number };
  provider: Provider["name"];
  providers?: Provider[];
  agents?: Agent[];
  activeProviderId?: string;
  lastCommand?: string;
  lastConnected: string;
  localIp: string;
  version: string;
  relayUrl?: string;
  startupDeviceId?: string;
};

export function mapReikaStateToDevice(state: ReikaStateResponse): Device {
  const deviceId = String(state.device.id ?? state.device.deviceId ?? "local-reika-device");
  return {
    id: deviceId,
    name: getReikaDeviceName(state) || "Project Reika Device",
    type: inferReikaDeviceType(state),
    status: "online",
    location: "Local",
    systemLabel: getReikaSystemLabel(state),
    lastSeenAt: String(state.device.lastSeenAt ?? state.providerDetection?.lastDetectionAt ?? new Date().toISOString()),
    localIp: typeof state.device.localIp === "string" ? state.device.localIp : undefined,
    agentVersion: String(state.device.agentVersion ?? state.device.version ?? "v0.1.0"),
    activeProviderId: state.activeProviderId,
    providers: state.providers.map((provider) => mapReikaProvider(provider, deviceId))
  };
}

export function mapReikaProvider(provider: ReikaProviderRecord, deviceId: string): Provider {
  return {
    id: provider.id,
    name: labelReikaProvider(provider.kind),
    deviceId,
    status: mapProviderStatus(provider.status),
    latency: provider.endpointLabel || "local",
    agents: provider.agents.map((agent, index) => ({
      id: agent.id || `${provider.id}-agent-${index + 1}`,
      name: agent.name || agent.label || agent.id || "Reika",
      providerId: provider.id,
      deviceId,
      role: String(agent.role || agent.source || agent.model || provider.name),
      status: mapProviderStatus(provider.status),
      lastActivity: provider.notes || "Detected by Reika server",
      characterId: inferAgentCharacterId(agent, provider)
    }))
  };
}

export function inferAgentCharacterId(agent: ReikaProviderRecord["agents"][number], provider: ReikaProviderRecord) {
  const text = [agent.characterId, agent.id, agent.name, agent.label, agent.role, agent.source, agent.model, provider.id, provider.name]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
  if (text.includes("astra")) return "astra";
  if (text.includes("miyabi")) return "miyabi";
  if (text.includes("nyxie")) return "nyxie";
  if (text.includes("reika")) return "reika";
  if (provider.kind === "hermes") return "reika";
  return undefined;
}

export function labelReikaProvider(kind: ReikaProviderRecord["kind"]): Provider["name"] {
  if (kind === "commandcenter") return "CommandCenter";
  if (kind === "openclaw") return "OpenClaw";
  if (kind === "hermes") return "Hermes";
  if (kind === "mock") return "Mock";
  return "Custom";
}

export function mapProviderStatus(status?: ReikaProviderRecord["status"]): Status {
  if (status === "preferred" || status === "available") return "online";
  if (status === "planned") return "connecting";
  if (status === "error") return "error";
  if (status === "offline") return "offline";
  return "unknown";
}

export function providerCanChat(provider: ReikaProviderRecord | undefined) {
  if (!provider) return false;
  return provider.capabilities.some((capability) => capability.id === "chat" && capability.planned !== true);
}

export function getReikaDeviceName(state: ReikaStateResponse | null) {
  if (!state) return "";
  return String(state.device.name ?? state.device.hostname ?? state.device.id ?? "").trim();
}

export function getReikaSystemLabel(state: ReikaStateResponse) {
  const platform = String(state.device.platform ?? state.device.os ?? state.device.system ?? "").trim();
  if (platform) return platform;
  const type = inferReikaDeviceType(state);
  if (type === "server") return "Linux Server";
  if (type === "laptop") return "Windows Laptop";
  if (type === "phone") return "Mobile Companion";
  if (type === "pc") return "Windows PC";
  return "Unknown system";
}

export function inferReikaDeviceType(state: ReikaStateResponse): Device["type"] {
  const label = String(state.device.platform ?? state.device.name ?? state.device.hostname ?? "").toLowerCase();
  if (label.includes("linux") || label.includes("server")) return "server";
  if (label.includes("laptop")) return "laptop";
  if (label.includes("phone") || label.includes("ios") || label.includes("android")) return "phone";
  return "pc";
}

export function mapReikaMessage(message: ReikaChatMessage): ChatMessage {
  return {
    id: message.id,
    sender: message.role === "assistant" ? "agent" : message.role,
    body: message.text,
    time: formatClock(message.timestamp)
  };
}

export function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "now";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function getAgentAvatar(agent: Agent, artRuntime: ArtRuntime) {
  return artRuntime.agentAvatar(agent, `agent-avatar-${agent.id}`);
}

export function mapLocalDeviceRecord(device: Device): DevicePageRow {
  const activeProvider =
    device.providers.find((provider) => provider.id === device.activeProviderId) ??
    device.providers.find((provider) => provider.status === "online") ??
    device.providers.find((provider) => provider.status !== "offline") ??
    device.providers[0];
  const agents = device.providers.flatMap((provider) => provider.agents);
  return {
    id: device.id,
    name: device.name,
    icon: getDeviceIcon(device.type),
    typeLabel: device.type,
    system: getSystemLabel(device),
    connection: `${device.location} Connection`,
    status: device.status,
    tag: device.location === "Local" ? "This Device" : "Detected",
    tagTone: device.location === "Local" ? "blue" : "green",
    metrics: device.metrics,
    provider: activeProvider?.name ?? "Custom",
    providers: device.providers,
    agents,
    activeProviderId: activeProvider?.id,
    lastConnected: device.lastSeenAt ? formatRelativeTime(device.lastSeenAt) : (device.status === "offline" ? "Unknown" : "Just now"),
    localIp: device.localIp ?? "Unknown",
    version: device.agentVersion ?? "Unknown"
  };
}

export function mapRelayDeviceRecord(record: RelayDeviceRecord, relayUrl: string): DevicePageRow {
  const device = mapDevice(record.device);
  const activeProvider =
    device.providers.find((provider) => provider.id === record.activeProviderId) ??
    device.providers.find((provider) => provider.status === "online") ??
    device.providers[0];
  const statusLabel = device.status === "busy" ? "Idle" : undefined;
  const lastConnected = formatRelativeTime(record.device.lastSeenAt);
  return {
    id: device.id,
    name: device.name,
    icon: getDeviceIcon(device.type),
    typeLabel: device.type,
    system: getSystemLabel(device),
    connection: device.location === "Local" ? "Local Connection" : "Relay Connection",
    status: device.status,
    statusLabel,
    tag: device.location === "Local" ? "This Device" : "Paired",
    tagTone: device.location === "Local" ? "blue" : "green",
    metrics: device.metrics,
    provider: activeProvider?.name ?? "Custom",
    providers: device.providers,
    agents: record.agents.length > 0 ? record.agents.map(mapRelayAgent) : device.providers.flatMap((provider) => provider.agents),
    activeProviderId: record.activeProviderId ?? activeProvider?.id,
    lastCommand: record.lastCommand,
    lastConnected,
    localIp: device.localIp ?? (record.device.location === "local" ? "Local relay" : "Outbound WSS"),
    version: record.device.agentVersion ?? "Unknown",
    relayUrl,
    startupDeviceId: record.device.id
  };
}

export function mapRelayAgent(agent: RelayDeviceRecord["agents"][number]): Agent {
  return {
    id: agent.id,
    name: agent.name,
    providerId: agent.providerId,
    deviceId: agent.deviceId,
    role: agent.role,
    status: agent.status,
    lastActivity: agent.lastActivity ?? "Relay roster",
    characterId: agent.characterId
  };
}

export function startupMatchesDevice(status: LocalAgentStartupStatus, device: DevicePageRow) {
  if (!status.command || !device.startupDeviceId || !device.relayUrl) return false;
  return status.command.includes(device.startupDeviceId) && status.command.includes(device.relayUrl);
}

export function getDeviceIcon(type: Device["type"]) {
  if (type === "server") return assets.icons.devices.server;
  if (type === "laptop") return assets.icons.devices.laptop;
  if (type === "phone") return assets.icons.devices.phone;
  return assets.icons.devices.pc;
}

export function getSystemLabel(device: Device) {
  if (device.systemLabel) return device.systemLabel;
  if (device.type === "server") return "Linux Server";
  if (device.type === "laptop") return "Windows Laptop";
  if (device.type === "phone") return "Mobile Companion";
  if (device.type === "pc") return "Windows PC";
  return "Unknown system";
}

export function formatRelativeTime(value: string) {
  const ms = Date.now() - Date.parse(value);
  if (!Number.isFinite(ms) || ms < 0) return "Just now";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function getFallbackAgent(demoEnabled: boolean): Agent {
  if (demoEnabled) return demoDevices[0]?.providers[0]?.agents[0] ?? offlineAgent();
  return offlineAgent();
}

export function offlineAgent(): Agent {
  return {
    id: "offline-agent",
    name: "Reika",
    providerId: "offline",
    deviceId: "offline-local",
    role: "Local server offline",
    status: "offline",
    lastActivity: "Start the Reika server to chat.",
    characterId: "reika"
  };
}

export function deviceMatchesQuery(device: Device, query: string) {
  const text = [
    device.name,
    device.type,
    device.status,
    device.location,
    device.systemLabel,
    ...device.providers.flatMap((provider) => [
      provider.name,
      provider.status,
      ...provider.agents.flatMap((agent) => [agent.name, agent.role, agent.status, agent.lastActivity])
    ])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text.includes(query);
}

export function filterDeviceRows(rows: DevicePageRow[], search: string, filter: "all" | "online" | "offline" | "issues") {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "online" && row.status === "online") ||
      (filter === "offline" && row.status === "offline") ||
      (filter === "issues" && row.status === "error");
    if (!matchesFilter) return false;
    if (!query) return true;
    const text = [
      row.name,
      row.typeLabel,
      row.system,
      row.connection,
      row.status,
      row.statusLabel,
      row.provider,
      row.lastConnected,
      row.localIp,
      row.version,
      ...(row.providers ?? []).flatMap((provider) => [provider.name, ...provider.agents.map((agent) => agent.name)])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return text.includes(query);
  });
}

export function nextDeviceFilter(current: "all" | "online" | "offline" | "issues") {
  const order: Array<typeof current> = ["all", "online", "offline", "issues"];
  return order[(order.indexOf(current) + 1) % order.length];
}

export function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatMetric(value: number | undefined) {
  return typeof value === "number" ? `${value}%` : "Unknown";
}

export function buildPresentationDevices(devices: Device[]) {
  return devices;
}
