export type ProviderKind = 'commandcenter' | 'openclaw' | 'hermes' | 'mock';
export type ProviderStatus = 'preferred' | 'available' | 'planned' | 'offline' | 'error';

export interface ProviderCapability {
  id: string;
  label: string;
  planned?: boolean;
}

export interface ProviderAgentSummary {
  id: string;
  name: string;
  label?: string;
  model?: string;
  source?: string;
}

export interface ProviderRecord {
  id: string;
  kind: ProviderKind;
  name: string;
  status: ProviderStatus;
  priority: number;
  endpointLabel: string;
  capabilities: ProviderCapability[];
  agents: ProviderAgentSummary[];
  notes: string;
  error?: string;
}

export interface ProviderAdapter {
  id: string;
  kind: ProviderKind;
  priority: number;
  detect(): Promise<ProviderRecord>;
}
