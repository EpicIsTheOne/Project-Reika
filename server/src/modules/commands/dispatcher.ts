import type { StateStore } from '../../core/stateStore.js';
import { createEnvelope, type AgentHubEndpoint, type AgentHubEnvelope } from '../../shared/protocol/envelope.js';
import type { AgentChatRequestPayload, AgentChatResponsePayload, AgentRosterSnapshotPayload, CommandRejectedPayload, DeviceStateSnapshotPayload, ProviderSnapshotPayload } from '../../shared/protocol/messages.js';

export type AgentChatHandler = (payload: AgentChatRequestPayload) => Promise<AgentChatResponsePayload>;

export class CommandDispatcher {
  constructor(
    private readonly state: StateStore,
    private readonly deviceEndpoint: AgentHubEndpoint,
    private readonly chatHandler?: AgentChatHandler
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
      case 'agent.chat.request':
        return this.agentChat(envelope);
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

  async agentChat(request: AgentHubEnvelope) {
    if (!this.chatHandler) return [this.reject(request, 'UNSUPPORTED_COMMAND', 'Chat transport is not configured on this device agent.')];
    const payload = request.payload as Partial<AgentChatRequestPayload>;
    if (!payload || typeof payload.message !== 'string' || !payload.message.trim()) {
      return [this.reject(request, 'INVALID_PAYLOAD', 'agent.chat.request requires payload.message.')];
    }
    try {
      const result = await this.chatHandler({
        providerId: typeof payload.providerId === 'string' ? payload.providerId : undefined,
        agent: typeof payload.agent === 'string' ? payload.agent : undefined,
        sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : undefined,
        message: payload.message,
        model: typeof payload.model === 'string' ? payload.model : undefined
      });
      return [createEnvelope<AgentChatResponsePayload>({
        type: 'agent.chat.response',
        source: this.deviceEndpoint,
        target: request.source,
        replyTo: request.id,
        correlationId: request.correlationId || request.id,
        payload: result
      })];
    } catch (error) {
      return [this.reject(request, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error))];
    }
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
