import { agents, createDeviceIdentity, providers } from '../runtime/mockState.js';

export class StateStore {
  readonly device = createDeviceIdentity();
  readonly providers = providers;
  readonly agents = agents;

  snapshot() {
    return {
      device: this.device,
      providers: this.providers,
      agents: this.agents,
      connectionPolicy: {
        externalUplinkEnabled: false,
        providerConnectionsEnabled: false,
        note: 'No external connection code is implemented yet. This server exposes local mock state only.'
      }
    };
  }
}
