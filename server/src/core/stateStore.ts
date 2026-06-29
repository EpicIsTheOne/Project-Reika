import { agents as baseAgents, createDeviceIdentity } from '../runtime/mockState.js';
import { chooseActiveProvider, detectProviders } from '../modules/provider/providerRegistry.js';
import type { ProviderRecord } from '../modules/provider/types.js';

export class StateStore {
  readonly device = createDeviceIdentity();
  private providers: ProviderRecord[] = [];
  private activeProviderId = '';
  private lastDetectionAt = '';
  private mockEnabled = true;

  async refreshProviders(options: { mockEnabled?: boolean } = {}) {
    this.mockEnabled = options.mockEnabled !== false;
    this.providers = await detectProviders({ mockEnabled: this.mockEnabled });
    this.activeProviderId = chooseActiveProvider(this.providers, { mockEnabled: this.mockEnabled })?.id ?? '';
    this.lastDetectionAt = new Date().toISOString();
  }

  snapshot() {
    return {
      device: this.device,
      activeProviderId: this.activeProviderId,
      providerDetection: {
        lastDetectionAt: this.lastDetectionAt,
        priority: this.mockEnabled ? ['CommandCenter', 'OpenClaw direct', 'Hermes direct', 'Mock/offline'] : ['CommandCenter', 'OpenClaw direct', 'Hermes direct']
      },
      providers: this.providers,
      agents: baseAgents.map((agent) => ({
        ...agent,
        providerId: this.activeProviderId || 'unavailable'
      })),
      connectionPolicy: {
        externalUplinkEnabled: false,
        providerConnectionsEnabled: true,
        chatTransportEnabled: true,
        mockEnabled: this.mockEnabled,
        note: 'Local provider detection and direct provider chat are enabled. External uplink remains opt-in.'
      }
    };
  }
}
