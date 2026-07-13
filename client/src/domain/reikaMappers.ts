import { assets } from "../data/assets";
import { mapDevice } from "../data/api";
import { devices as demoDevices } from "../data/mockData";
import type { RelayDeviceRecord } from "../data/relay";
import type { LocalAgentStartupStatus } from "../data/startup";
import type { ArtRuntime } from "../lib/artRuntime";
import type { ReikaChatMessage, ReikaProviderKind, ReikaProviderRecord, ReikaProviderStatus, ReikaStateResponse } from "../lib/reikaApi";
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
      characterId: inferAgentCharacterId(agent, provider),
      voiceProvider: typeof agent.voiceProvider === "string" ? agent.voiceProvider : undefined,
      voiceId: typeof agent.voiceId === "string" ? agent.voiceId : undefined,
      voiceLabel: typeof agent.voiceLabel === "string" ? agent.voiceLabel : undefined,
      voiceAvailable: typeof agent.voiceAvailable === "boolean" ? agent.voiceAvailable : undefined,
      voiceSettings: isVoiceSettings(agent.voiceSettings) ? agent.voiceSettings : undefined
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
    time: formatClock(message.timestamp),
    meta: message.meta
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

export function getAgentAvatarRender(agent: Agent, artRuntime: ArtRuntime) {
  return artRuntime.agentAvatarRender(agent, `agent-avatar-${agent.id}`);
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
  const device = namespaceRelayDevice(mapDevice(record.device), record.device.id);
  const activeProvider =
    device.providers.find((provider) => provider.id === record.activeProviderId) ??
    device.providers.find((provider) => getRelayOriginalProviderId(provider) === record.activeProviderId) ??
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
    agents: record.agents.length > 0 ? record.agents.map((agent) => mapRelayAgent(agent, record.device.id)) : device.providers.flatMap((provider) => provider.agents),
    activeProviderId: record.activeProviderId ? namespaceRelayProviderId(record.device.id, record.activeProviderId) : activeProvider?.id,
    lastCommand: record.lastCommand,
    lastConnected,
    localIp: device.localIp ?? (record.device.location === "local" ? "Local relay" : "Outbound WSS"),
    version: record.device.agentVersion ?? "Unknown",
    relayUrl,
    startupDeviceId: record.device.id
  };
}

export function mapRelayRecordToDevice(record: RelayDeviceRecord): Device {
  const device = namespaceRelayDevice(mapDevice(record.device), record.device.id);
  const deviceStatus = normalizeDeviceStatus(device.status);
  const hasProviderScopedRoster = record.agents.some((agent) => Boolean(agent.providerId));
  const agents = hasProviderScopedRoster ? record.agents.map((agent) => mapRelayAgent(agent, record.device.id)) : device.providers.flatMap((provider) => provider.agents);
  const providers = device.providers.map((provider) => ({
    ...provider,
    status: deviceStatus === "online" ? provider.status : "offline",
    agents: agents
      .filter((agent) => agent.providerId === provider.id || getRelayOriginalProviderId(agent) === getRelayOriginalProviderId(provider))
      .map((agent) => ({
        ...agent,
        status: deviceStatus === "online" && provider.status === "online" ? agent.status : "offline"
      }))
  }));
  return {
    ...device,
    status: deviceStatus,
    activeProviderId: record.activeProviderId ? namespaceRelayProviderId(record.device.id, record.activeProviderId) : device.activeProviderId,
    providers: providers.length > 0 ? providers : device.providers
  };
}

export function mapRelayRecordsToProviderState(records: RelayDeviceRecord[]): ReikaProviderRecord[] {
  return records.flatMap((record, recordIndex) => {
    const device = namespaceRelayDevice(mapDevice(record.device), record.device.id);
    return device.providers.map((provider, providerIndex): ReikaProviderRecord => ({
      id: provider.id,
      kind: providerNameToKind(provider.name),
      name: `${provider.name} (${device.name})`,
      status: providerStatusToReika(provider.status),
      priority: recordIndex * 10 + providerIndex,
      endpointLabel: `Relay ${device.name}`,
      capabilities: [
        { id: "roster", label: "Roster" },
        { id: "relay", label: "Relay" },
        ...(provider.agents.some((agent) => agent.status === "online") ? [{ id: "chat", label: "Relay Chat" }] : [])
      ],
      agents: provider.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        characterId: agent.characterId,
        status: agent.status,
        source: device.name,
        deviceId: agent.deviceId || device.id,
        providerId: provider.id,
        relayAgentId: getRelayOriginalAgentId(agent),
        relayProviderId: getRelayOriginalProviderId(provider),
        voiceProvider: agent.voiceProvider,
        voiceId: agent.voiceId,
        voiceLabel: agent.voiceLabel,
        voiceAvailable: agent.voiceAvailable,
        voiceSettings: agent.voiceSettings
      })),
      notes: "Discovered through relay chat transport.",
      relayDeviceId: device.id,
      relayProviderId: getRelayOriginalProviderId(provider)
    }));
  });
}

export function mapRelayAgent(agent: RelayDeviceRecord["agents"][number], fallbackDeviceId?: string): Agent {
  const deviceId = agent.deviceId || fallbackDeviceId || "relay-device";
  return {
    id: namespaceRelayAgentId(deviceId, agent.providerId, agent.id),
    name: agent.name,
    providerId: namespaceRelayProviderId(deviceId, agent.providerId),
    deviceId,
    role: agent.role,
    status: agent.status,
    lastActivity: agent.lastActivity ?? "Relay roster",
    characterId: agent.characterId,
    relayAgentId: agent.id,
    relayProviderId: agent.providerId,
    voiceProvider: agent.voiceProvider,
    voiceId: agent.voiceId,
    voiceLabel: agent.voiceLabel,
    voiceAvailable: agent.voiceAvailable,
    voiceSettings: agent.voiceSettings
  };
}

function namespaceRelayDevice(device: Device, deviceId: string): Device {
  const providers = device.providers.map((provider) => {
    const providerId = namespaceRelayProviderId(deviceId, provider.id);
    return {
      ...provider,
      id: providerId,
      relayProviderId: provider.id,
      agents: provider.agents.map((agent) => ({
        ...agent,
        id: namespaceRelayAgentId(deviceId, provider.id, agent.id),
        providerId,
        deviceId,
        relayAgentId: agent.id,
        relayProviderId: provider.id
      }))
    };
  });
  return {
    ...device,
    activeProviderId: device.activeProviderId ? namespaceRelayProviderId(deviceId, device.activeProviderId) : device.activeProviderId,
    providers
  };
}

function namespaceRelayProviderId(deviceId: string, providerId: string) {
  return `relay:${deviceId}:${providerId}`;
}

function namespaceRelayAgentId(deviceId: string, providerId: string, agentId: string) {
  return `relay:${deviceId}:${providerId}:${agentId}`;
}

function getRelayOriginalProviderId(value: { providerId?: string; id?: string; relayProviderId?: unknown }) {
  return typeof value.relayProviderId === "string" && value.relayProviderId ? value.relayProviderId : value.providerId ?? value.id ?? "";
}

function getRelayOriginalAgentId(value: { id?: string; relayAgentId?: unknown }) {
  return typeof value.relayAgentId === "string" && value.relayAgentId ? value.relayAgentId : value.id ?? "";
}

function isVoiceSettings(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function providerNameToKind(name: Provider["name"]): ReikaProviderKind {
  if (name === "CommandCenter") return "commandcenter";
  if (name === "OpenClaw") return "openclaw";
  if (name === "Hermes") return "hermes";
  return "mock";
}

function providerStatusToReika(status: Status): ReikaProviderStatus {
  if (status === "online" || status === "busy" || status === "thinking") return "available";
  if (status === "error") return "error";
  return "offline";
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
  return devices.map((device) => {
    const deviceStatus = normalizeDeviceStatus(device.status);
    return {
      ...device,
      status: deviceStatus,
      providers: device.providers.map((provider) => {
        const providerStatus = deviceStatus === "online" ? normalizeProviderUiStatus(provider.status) : "offline";
        return {
          ...provider,
          status: providerStatus,
          agents: provider.agents.map((agent) => ({
            ...agent,
            status: providerStatus === "online" ? normalizeAgentUiStatus(agent.status) : "offline"
          }))
        };
      })
    };
  });
}

function normalizeDeviceStatus(status: Status): Status {
  return status === "online" || status === "busy" || status === "thinking" ? status : status === "error" ? "error" : "offline";
}

function normalizeProviderUiStatus(status: Status): Status {
  return status === "online" || status === "busy" || status === "thinking" ? status : status === "error" ? "error" : "offline";
}

function normalizeAgentUiStatus(status: Status): Status {
  return status === "online" || status === "busy" || status === "thinking" ? status : status === "error" ? "error" : "offline";
}
