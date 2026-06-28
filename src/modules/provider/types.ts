export type ProviderKind = 'commandcenter' | 'openclaw' | 'hermes' | 'mock';
export type ProviderStatus = 'available' | 'preferred' | 'offline' | 'planned';

export interface ProviderCapability {
  id: string;
  label: string;
  planned?: boolean;
}

export interface ProviderSummary {
  id: string;
  name: string;
  kind: ProviderKind;
  status: ProviderStatus;
  endpointLabel: string;
  capabilities: ProviderCapability[];
  notes: string;
}
