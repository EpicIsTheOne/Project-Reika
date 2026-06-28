export type ProviderKind = 'commandcenter' | 'openclaw' | 'hermes' | 'mock';
export type ProviderStatus = 'preferred' | 'available' | 'planned' | 'offline';

export interface ProviderCapability {
  id: string;
  label: string;
  planned?: boolean;
}

export interface ProviderRecord {
  id: string;
  kind: ProviderKind;
  name: string;
  status: ProviderStatus;
  capabilities: ProviderCapability[];
  notes: string;
}
