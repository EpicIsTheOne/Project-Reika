import type { StateStore } from '../../core/stateStore.js';
import { createEnvelope, type AgentHubEndpoint, type AgentHubEnvelope } from '../../shared/protocol/envelope.js';
import type { AgentActivityPayload, AgentChatRequestPayload, AgentChatResponsePayload, AgentRosterSnapshotPayload, CommandRejectedPayload, CommandStatusPayload, CommandStatusRequestPayload, DeliveryState, DeviceStateSnapshotPayload, ProviderSnapshotPayload } from '../../shared/protocol/messages.js';
import { IdempotencyLedger, type IdempotencyRecord } from './idempotencyLedger.js';

export type AgentChatHandler = (payload: AgentChatRequestPayload) => Promise<AgentChatResponsePayload>;
export type AgentOutboundSink = (envelope: AgentHubEnvelope) => void;
export type AgentChatRecoveryHandler = (input: {
  providerId: string;
  agent: string;
  sessionId: string;
  providerSessionId: string;
}) => Promise<AgentChatResponsePayload | undefined>;

export class CommandDispatcher {
  private readonly idempotency = new IdempotencyLedger();
  private readonly activeRequestKeys = new Set<string>();

  constructor(
    private readonly state: StateStore,
    private readonly deviceEndpoint: AgentHubEndpoint,
    private readonly chatHandler?: AgentChatHandler,
    private readonly outboundSink?: AgentOutboundSink,
    private readonly recoveryHandler?: AgentChatRecoveryHandler
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
      case 'command.status.request':
        return this.commandStatus(envelope);
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
      ,delivery: payload.delivery?.statusMetadataVersion === 1 ? payload.delivery : undefined
    };
    const sessionId = chatPayload.sessionId || '';
    const existing = this.idempotency.get(request.id, this.deviceEndpoint.id, sessionId);
    if (existing) return this.responsesForExisting(request, existing);
    const record = this.idempotency.begin(
      request.id,
      this.deviceEndpoint.id,
      sessionId,
      payload.delivery?.statusMetadataVersion !== 1,
      { providerId: chatPayload.providerId, agent: chatPayload.agent, providerSessionId: chatPayload.providerSessionId }
    );
    this.emitDeliveryStatus(request, record, 'delivered', 'Request delivered to device authority.');

    this.idempotency.update(record, 'executing');
    this.activeRequestKeys.add(record.key);
    this.emitDeliveryStatus(request, record, 'executing', 'Request execution started.');
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
      const response = createEnvelope<AgentChatResponsePayload>({
        type: 'agent.chat.response',
        source: this.deviceEndpoint,
        target: request.source,
        replyTo: request.id,
        correlationId: request.correlationId || request.id,
        payload: result
      });
      const completed = this.deliveryStatus(request, record, 'completed', 'Request completed.', true);
      const responses = [completed, response];
      this.idempotency.update(record, 'completed', responses);
      return responses;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitActivity(request, chatPayload, 'error', { message });
      this.emitActivity(request, chatPayload, 'idle');
      const rejected = this.reject(request, 'INTERNAL_ERROR', message);
      const failed = this.deliveryStatus(request, record, 'failed', message, false);
      const responses = [failed, rejected];
      this.idempotency.update(record, 'failed', responses, message);
      return responses;
    } finally {
      this.activeRequestKeys.delete(record.key);
    }
  }

  private async commandStatus(request: AgentHubEnvelope) {
    const payload = request.payload as Partial<CommandStatusRequestPayload>;
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
    if (!requestId) return [this.reject(request, 'INVALID_PAYLOAD', 'command.status.request requires payload.requestId.')];
    const record = this.idempotency.get(requestId, this.deviceEndpoint.id, sessionId);
    if (!record) return [this.reject(request, 'INVALID_PAYLOAD', 'No idempotency record exists for that request scope.')];
    if (record.responses?.length) return record.responses;
    if (
      record.state === 'executing'
      && !this.activeRequestKeys.has(record.key)
      && this.recoveryHandler
      && record.providerId
      && record.agent
      && record.providerSessionId
    ) {
      const recovered = await this.recoveryHandler({
        providerId: record.providerId,
        agent: record.agent,
        sessionId: record.sessionId,
        providerSessionId: record.providerSessionId
      }).catch(() => undefined);
      if (recovered?.text.trim()) {
        const response = createEnvelope<AgentChatResponsePayload>({
          type: 'agent.chat.response',
          source: this.deviceEndpoint,
          target: request.source,
          replyTo: record.requestId,
          correlationId: record.requestId,
          payload: recovered
        });
        const completed = this.deliveryStatus(request, record, 'completed', 'Recovered completed provider result after device restart.', true);
        const responses = [completed, response];
        this.idempotency.update(record, 'completed', responses);
        return responses;
      }
    }
    return [this.deliveryStatus(request, record, record.state, `Request is ${record.state}.`, record.state === 'completed')];
  }

  private responsesForExisting(request: AgentHubEnvelope, record: IdempotencyRecord) {
    if (record.responses?.length) return record.responses;
    return [this.deliveryStatus(request, record, record.state, `Duplicate request was not re-executed; existing state is ${record.state}.`, record.state === 'completed')];
  }

  private deliveryStatus(request: AgentHubEnvelope, record: IdempotencyRecord, state: DeliveryState, message: string, ok = state !== 'failed') {
    return createEnvelope<CommandStatusPayload>({
      type: 'command.status',
      source: this.deviceEndpoint,
      target: request.source,
      replyTo: request.id,
      correlationId: request.correlationId || request.id,
      payload: { ok, message, state, requestId: record.requestId, legacy: record.legacy }
    });
  }

  private emitDeliveryStatus(request: AgentHubEnvelope, record: IdempotencyRecord, state: DeliveryState, message: string) {
    this.outboundSink?.(this.deliveryStatus(request, record, state, message));
  }

  private emitActivity(
    request: AgentHubEnvelope,
    payload: AgentChatRequestPayload,
    status: AgentActivityPayload['status'],
    overrides: Partial<AgentActivityPayload> = {}
  ) {
    if (!this.outboundSink) return;
    const snapshot = this.state.snapshot();
    const providerId = overrides.providerId || payload.providerId || snapshot.activeProviderId;
    const activeProvider = snapshot.providers.find((provider) => provider.id === providerId) || snapshot.providers[0];
    const agent = overrides.agent || payload.agent || activeProvider?.agents?.[0]?.id || 'unknown';
    this.outboundSink(createEnvelope<AgentActivityPayload>({
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
