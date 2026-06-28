import type { StateStore } from '../../core/stateStore.js';
import { createEnvelope, type AgentHubEndpoint, type AgentHubEnvelope } from '../../shared/protocol/envelope.js';
import type { AgentRosterSnapshotPayload, CommandRejectedPayload, DeviceStateSnapshotPayload, ProviderSnapshotPayload } from '../../shared/protocol/messages.js';

export class CommandDispatcher {
  constructor(
    private readonly state: StateStore,
    private readonly deviceEndpoint: AgentHubEndpoint
  ) {}

  async dispatch(envelope: AgentHubEnvelope): Promise<AgentHubEnvelope[]> {
    switch (envelope.type) {
      case 'device.state.request':
        return [this.stateSnapshot(envelope)];
      case 'provider.refresh.request':
        await this.state.refreshProviders();
        return [this.providerSnapshot(envelope)];
      case 'agent.roster.request':
        return [this.agentRoster(envelope)];
      default:
        return [this.reject(envelope, 'UNSUPPORTED_COMMAND', 'This command is not supported by this device agent.')];
    }
  }

  stateSnapshot(request?: AgentHubEnvelope) {
    return createEnvelope<DeviceStateSnapshotPayload>({
      type: 'device.state.snapshot',
      source: this.deviceEndpoint,
      target: request?.source,
      replyTo: request?.id,
      correlationId: request?.correlationId || request?.id,
      payload: { snapshot: this.state.snapshot() }
    });
  }

  providerSnapshot(request?: AgentHubEnvelope) {
    const snapshot = this.state.snapshot();
    return createEnvelope<ProviderSnapshotPayload>({
      type: 'device.provider.snapshot',
      source: this.deviceEndpoint,
      target: request?.source,
      replyTo: request?.id,
      correlationId: request?.correlationId || request?.id,
      payload: {
        activeProviderId: snapshot.activeProviderId,
        providers: snapshot.providers
      }
    });
  }

  agentRoster(request?: AgentHubEnvelope) {
    const snapshot = this.state.snapshot();
    const active = snapshot.providers.find((provider) => provider.id === snapshot.activeProviderId) || snapshot.providers[0];
    return createEnvelope<AgentRosterSnapshotPayload>({
      type: 'agent.roster.snapshot',
      source: this.deviceEndpoint,
      target: request?.source,
      replyTo: request?.id,
      correlationId: request?.correlationId || request?.id,
      payload: {
        providerId: active?.id || snapshot.activeProviderId,
        agents: active?.agents || []
      }
    });
  }

  reject(request: AgentHubEnvelope, reason: CommandRejectedPayload['reason'], message: string) {
    return createEnvelope<CommandRejectedPayload>({
      type: 'command.rejected',
      source: this.deviceEndpoint,
      target: request.source,
      replyTo: request.id,
      correlationId: request.correlationId || request.id,
      payload: {
        commandType: request.type,
        reason,
        message
      }
    });
  }
}
