import type { ProviderAdapter, ProviderSnapshotItem } from "./types";
import { fetchJson, probeHealth, slug, statusFromHealth } from "./common";
import type { ProviderCapability } from "../../shared/agenthub";

interface HermesAgentLike {
  id?: string;
  name?: string;
  displayName?: string;
  role?: string;
  status?: string;
  characterId?: string;
}

export class HermesProviderAdapter implements ProviderAdapter {
  kind = "hermes" as const;
  name = "Hermes";
  private readonly agentCapabilities: ProviderCapability[] = ["status", "chat"];

  constructor(private readonly baseUrl: string) {}

  async probe(deviceId: string): Promise<ProviderSnapshotItem> {
    const id = `${deviceId}-hermes`;
    if (!this.baseUrl) {
      return {
        id,
        kind: this.kind,
        name: this.name,
        status: "offline",
        capabilities: ["status", "agent-discovery", "chat"],
        agents: [],
        error: "HERMES_BASE_URL is not configured"
      };
    }

    const health = await probeHealth(this.baseUrl, ["/health", "/api/health", "/status", "/api/status"]);
    const status = statusFromHealth(health?.data ?? null);
    const agents = await this.fetchAgents(deviceId, id, status);

    return {
      id,
      kind: this.kind,
      name: this.name,
      endpoint: this.baseUrl,
      version: String(health?.data.version ?? health?.data.appVersion ?? ""),
      status,
      capabilities: ["status", "agent-discovery", "chat", "streaming-chat"],
      agents,
      error: status === "offline" ? `Hermes did not respond at ${this.baseUrl}` : undefined
    };
  }

  private async fetchAgents(deviceId: string, providerId: string, status: ProviderSnapshotItem["status"]) {
    const trimmed = this.baseUrl.replace(/\/+$/, "");
    const payload =
      (await fetchJson<{ agents?: HermesAgentLike[] }>(`${trimmed}/agents`)) ??
      (await fetchJson<{ agents?: HermesAgentLike[] }>(`${trimmed}/api/agents`));

    if (payload?.agents?.length) {
      return payload.agents.map((agent) => {
        const name = agent.displayName ?? agent.name ?? "Hermes Agent";
        return {
          id: agent.id ?? `${providerId}-${slug(name)}`,
          name,
          role: agent.role ?? "Hermes provider agent",
          status: normalizeStatus(agent.status) ?? status,
          characterId: agent.characterId,
          capabilities: this.agentCapabilities,
          lastActivity: "Discovered from Hermes"
        };
      });
    }

    if (status === "online" || status === "busy" || status === "thinking") {
      return [
        {
          id: "reika",
          name: "Reika",
          role: "Hermes personal assistant",
          status,
          characterId: "reika",
          capabilities: this.agentCapabilities,
          lastActivity: "Hermes health endpoint is reachable"
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
