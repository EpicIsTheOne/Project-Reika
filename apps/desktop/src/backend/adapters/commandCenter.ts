import type { ProviderAdapter, ProviderSnapshotItem } from "./types";
import { fetchJson, probeHealth, slug, statusFromHealth } from "./common";
import type { ProviderCapability } from "../../shared/agenthub";

interface CommandCenterAgentLike {
  id?: string;
  name?: string;
  role?: string;
  status?: string;
}

export class CommandCenterProviderAdapter implements ProviderAdapter {
  kind = "commandcenter" as const;
  name = "Command Center";
  private readonly agentCapabilities: ProviderCapability[] = ["status", "chat", "tools"];

  constructor(private readonly baseUrl: string) {}

  async probe(deviceId: string): Promise<ProviderSnapshotItem> {
    const id = `${deviceId}-commandcenter`;
    if (!this.baseUrl) {
      return {
        id,
        kind: this.kind,
        name: this.name,
        status: "offline",
        capabilities: ["status", "agent-discovery", "chat", "tools"],
        agents: [],
        error: "COMMANDCENTER_BASE_URL is not configured"
      };
    }

    const health = await probeHealth(this.baseUrl, ["/health", "/api/health", "/api/v1/health", "/status"]);
    const status = statusFromHealth(health?.data ?? null);
    const agents = await this.fetchAgents(deviceId, id, status);

    return {
      id,
      kind: this.kind,
      name: this.name,
      endpoint: this.baseUrl,
      version: String(health?.data.version ?? health?.data.appVersion ?? ""),
      status,
      capabilities: ["status", "agent-discovery", "chat", "tools"],
      agents,
      error: status === "offline" ? `Command Center did not respond at ${this.baseUrl}` : undefined
    };
  }

  private async fetchAgents(deviceId: string, providerId: string, status: ProviderSnapshotItem["status"]) {
    const trimmed = this.baseUrl.replace(/\/+$/, "");
    const payload =
      (await fetchJson<{ agents?: CommandCenterAgentLike[] }>(`${trimmed}/agents`)) ??
      (await fetchJson<{ agents?: CommandCenterAgentLike[] }>(`${trimmed}/api/agents`)) ??
      (await fetchJson<{ agents?: CommandCenterAgentLike[] }>(`${trimmed}/api/v1/agents`));

    if (payload?.agents?.length) {
      return payload.agents.map((agent) => {
        const name = agent.name ?? "Command Center Agent";
        return {
          id: agent.id ?? `${providerId}-${slug(name)}`,
          name,
          role: agent.role ?? "Command Center provider agent",
          status: normalizeStatus(agent.status) ?? status,
          capabilities: this.agentCapabilities,
          lastActivity: "Discovered from Command Center"
        };
      });
    }

    if (status === "online" || status === "busy" || status === "thinking") {
      return [
        {
          id: `${providerId}-assistant`,
          name: "Command Center",
          role: "Overlay API provider",
          status,
          capabilities: this.agentCapabilities,
          lastActivity: "Command Center health endpoint is reachable"
        }
      ];
    }

    return [];
  }
}

function normalizeStatus(value?: string) {
  if (!value) return null;
  const lowered = value.toLowerCase();
  if (["online", "offline", "connecting", "busy", "thinking", "error", "unknown"].includes(lowered)) {
    return lowered as ProviderSnapshotItem["status"];
  }
  return null;
}
