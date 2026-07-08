import type { StateStore } from '../../core/stateStore.js';
import { createEnvelope, type AgentHubEndpoint, type AgentHubEnvelope } from '../../shared/protocol/envelope.js';
import type { AgentActivityPayload, AgentChatRequestPayload, AgentChatResponsePayload, AgentRosterSnapshotPayload, CommandRejectedPayload, DeviceStateSnapshotPayload, ProviderSnapshotPayload } from '../../shared/protocol/messages.js';

export type AgentChatHandler = (payload: AgentChatRequestPayload) => Promise<AgentChatResponsePayload>;
export type AgentActivitySink = (envelope: AgentHubEnvelope<AgentActivityPayload>) => void;

export class CommandDispatcher {
  constructor(
    private readonly state: StateStore,
    private readonly deviceEndpoint: AgentHubEndpoint,
    private readonly chatHandler?: AgentChatHandler,
    private readonly activitySink?: AgentActivitySink
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

    const chatPayload: AgentChatRequestPayload = {
      providerId: typeof payload.providerId === 'string' ? payload.providerId : undefined,
      agent: typeof payload.agent === 'string' ? payload.agent : undefined,
      sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : undefined,
      providerSessionId: typeof payload.providerSessionId === 'string' ? payload.providerSessionId : undefined,
      message: payload.message,
      model: typeof payload.model === 'string' ? payload.model : undefined,
      fileIds: Array.isArray(payload.fileIds) ? payload.fileIds.map(String) : undefined
    };

    this.emitActivity(request, chatPayload, 'thinking');

    try {
      const result = await this.chatHandler(chatPayload);
      this.emitActivity(request, chatPayload, 'responding', {
        providerId: result.providerId,
        agent: result.agent,
        sessionId: result.sessionId,
        message: result.text,
        metadata: { runtime: result.runtime }
      });
      this.emitActivity(request, chatPayload, 'idle', {
        providerId: result.providerId,
        agent: result.agent,
        sessionId: result.sessionId,
        metadata: { runtime: result.runtime }
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
      const message = error instanceof Error ? error.message : String(error);
      this.emitActivity(request, chatPayload, 'error', { message });
      this.emitActivity(request, chatPayload, 'idle');
      return [this.reject(request, 'INTERNAL_ERROR', message)];
    }
  }

  private emitActivity(
    request: AgentHubEnvelope,
    payload: AgentChatRequestPayload,
    status: AgentActivityPayload['status'],
    overrides: Partial<AgentActivityPayload> = {}
  ) {
    if (!this.activitySink) return;
    const snapshot = this.state.snapshot();
    const providerId = overrides.providerId || payload.providerId || snapshot.activeProviderId;
    const activeProvider = snapshot.providers.find((provider) => provider.id === providerId) || snapshot.providers[0];
    const agent = overrides.agent || payload.agent || activeProvider?.agents?.[0]?.id || 'unknown';
    this.activitySink(createEnvelope<AgentActivityPayload>({
      type: 'agent.activity',
      source: this.deviceEndpoint,
      target: request.source,
      replyTo: request.id,
      correlationId: request.correlationId || request.id,
      payload: {
        deviceId: this.deviceEndpoint.id,
        providerId,
        agent,
        status,
        sessionId: overrides.sessionId || payload.sessionId,
        providerSessionId: overrides.providerSessionId || payload.providerSessionId,
        source: 'relay-chat',
        timestamp: new Date().toISOString(),
        ...overrides
      }
    }));
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
