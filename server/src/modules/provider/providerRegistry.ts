import type { ProviderAdapter, ProviderRecord } from './types.js';
import { commandCenterProvider } from './adapters/commandCenterProvider.js';
import { hermesProvider, openClawProvider } from './adapters/processProvider.js';

const mockProvider: ProviderRecord = {
  id: 'mock-local',
  kind: 'mock',
  name: 'Mock Local Provider',
  status: 'available',
  priority: 99,
  endpointLabel: 'in-memory mock',
  notes: 'Fallback provider used when no richer provider is active or when tests need offline fixtures.',
  agents: [
    { id: 'reika', name: 'Reika', label: 'Reika', source: 'mock' }
  ],
  capabilities: [
    { id: 'state', label: 'Local state' },
    { id: 'events', label: 'In-memory events' },
    { id: 'chat', label: 'Mock chat transport' }
  ]
};

const adapters: ProviderAdapter[] = [commandCenterProvider, openClawProvider, hermesProvider];

export async function detectProviders(options: { mockEnabled?: boolean } = {}): Promise<ProviderRecord[]> {
  const detected = await Promise.all(adapters.map((adapter) => adapter.detect()));
  const providers = options.mockEnabled === false ? detected : [...detected, mockProvider];
  return providers.sort((a, b) => a.priority - b.priority);
}

export function chooseActiveProvider(providers: ProviderRecord[], options: { mockEnabled?: boolean } = {}): ProviderRecord | undefined {
  return providers.find((provider) => provider.status === 'preferred')
    || providers.find((provider) => provider.status === 'available')
    || (options.mockEnabled === false ? undefined : mockProvider);
}
