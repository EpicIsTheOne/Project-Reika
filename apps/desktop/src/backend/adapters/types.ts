import type { AgentMessageRequest, AgentMessageResponse, ProviderKind, ProviderSnapshot } from "../../shared/agenthub";

export type ProviderSnapshotItem = ProviderSnapshot["providers"][number];

export interface ProviderAdapter {
  kind: ProviderKind;
  name: string;
  probe(deviceId: string): Promise<ProviderSnapshotItem>;
  sendMessage?(agentId: string, request: AgentMessageRequest): Promise<AgentMessageResponse>;
}
