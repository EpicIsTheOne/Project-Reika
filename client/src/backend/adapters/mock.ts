import type { ProviderAdapter, ProviderSnapshotItem } from "./types";

export class MockProviderAdapter implements ProviderAdapter {
  kind = "mock" as const;
  name = "Mock Provider";

  async probe(deviceId: string): Promise<ProviderSnapshotItem> {
    return {
      id: `${deviceId}-mock`,
      kind: this.kind,
      name: this.name,
      status: "online",
      version: "0.1.0",
      capabilities: ["status", "agent-discovery", "chat"],
      agents: [
        {
          id: "mock-assistant",
          name: "Mock Assistant",
          role: "Backend connectivity test agent",
          status: "online",
          capabilities: ["status", "chat"],
          lastActivity: "Registered by AgentHub backend"
        }
      ]
    };
  }

  async sendMessage(agentId: string) {
    return {
      ok: true,
      agentId,
      providerId: "",
      deviceId: "",
      status: "online" as const,
      message: "Backend message route is alive. Real provider transport comes next."
    };
  }
}
