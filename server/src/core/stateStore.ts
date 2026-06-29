import { agents as baseAgents, createDeviceIdentity } from '../runtime/mockState.js';
import { chooseActiveProvider, detectProviders } from '../modules/provider/providerRegistry.js';
import type { ProviderRecord } from '../modules/provider/types.js';

export class StateStore {
  readonly device = createDeviceIdentity();
  private providers: ProviderRecord[] = [];
  private activeProviderId = 'mock-local';
  private lastDetectionAt = '';

  async refreshProviders() {
    this.providers = await detectProviders();
    this.activeProviderId = chooseActiveProvider(this.providers).id;
    this.lastDetectionAt = new Date().toISOString();
  }

  snapshot() {
    return {
      device: this.device,
      activeProviderId: this.activeProviderId,
      providerDetection: {
        lastDetectionAt: this.lastDetectionAt,
        priority: ['CommandCenter', 'OpenClaw direct', 'Hermes direct', 'Mock/offline']
      },
      providers: this.providers,
      agents: baseAgents.map((agent) => ({
        ...agent,
        providerId: this.activeProviderId
      })),
      connectionPolicy: {
        externalUplinkEnabled: false,
        providerConnectionsEnabled: true,
        chatTransportEnabled: true,
        note: 'Local provider detection and direct provider chat are enabled. External uplink remains opt-in.'
      }
    };
  }
}
