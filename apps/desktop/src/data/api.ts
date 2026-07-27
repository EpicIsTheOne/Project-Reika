import type { AgentHubDevice, AgentHubProvider, ProviderKind } from "../shared/agenthub";
import type { Device, Provider } from "../types";

interface DevicesResponse {
  ok: boolean;
  devices: AgentHubDevice[];
  error?: string;
}

interface ScanResponse {
  ok: boolean;
  device: AgentHubDevice;
  error?: string;
}

export async function fetchAgentHubDevices() {
  const response = await fetch("/api/devices");
  const payload = (await response.json()) as DevicesResponse;
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Reika backend did not return nodes.");
  return payload.devices.map(mapDevice);
}

export async function scanLocalAgentHubProviders() {
  const response = await fetch("/api/devices/local/scan", { method: "POST" });
  const payload = (await response.json()) as ScanResponse;
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Local provider scan failed.");
  return payload.device;
}

export function mapDevice(device: AgentHubDevice): Device {
  const deviceStatus = device.status;
  return {
    id: device.id,
    name: device.name,
    type: device.type,
    status: deviceStatus,
    location: labelLocation(device.location),
    lastSeenAt: device.lastSeenAt,
    agentVersion: device.agentVersion,
    providers: device.providers.map((provider) => mapProvider(provider, deviceStatus))
  };
}

function mapProvider(provider: AgentHubProvider, deviceStatus: Device["status"] = "online"): Provider {
  const providerStatus = deviceStatus === "online" ? provider.status : "offline";
  return {
    id: provider.id,
    name: labelProvider(provider.kind),
    deviceId: provider.deviceId,
    status: providerStatus,
    latency: provider.endpoint ? "api" : "--",
    agents: provider.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      providerId: agent.providerId,
      deviceId: agent.deviceId,
      role: agent.role,
      status: providerStatus === "online" ? agent.status : "offline",
      lastActivity: agent.lastActivity ?? "Discovered by backend",
      characterId: agent.characterId,
      voiceProvider: agent.voiceProvider,
      voiceId: agent.voiceId,
      voiceLabel: agent.voiceLabel,
      voiceAvailable: agent.voiceAvailable,
      voiceSettings: agent.voiceSettings
    }))
  };
}

function labelProvider(kind: ProviderKind): Provider["name"] {
  if (kind === "hermes") return "Hermes";
  if (kind === "openclaw") return "OpenClaw";
  if (kind === "commandcenter") return "CommandCenter";
  if (kind === "mock") return "Mock";
  return "Custom";
}

function labelLocation(location: AgentHubDevice["location"]) {
  if (location === "local") return "Local";
  if (location === "lan") return "LAN";
  return "Remote";
}
