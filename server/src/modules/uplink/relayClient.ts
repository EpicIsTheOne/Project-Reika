import { serverConfig } from '../../config/defaults.js';
import type { EventBus } from '../../core/eventBus.js';
import type { StateStore } from '../../core/stateStore.js';
import { CommandDispatcher, type AgentChatHandler, type AgentChatRecoveryHandler } from '../commands/dispatcher.js';
import { deviceAgentCapabilities } from '../../shared/protocol/capabilities.js';
import { createEnvelope, isAgentHubEnvelope, type AgentHubEndpoint, type AgentHubEnvelope } from '../../shared/protocol/envelope.js';
import type { DeviceHeartbeatPayload, DeviceHelloPayload } from '../../shared/protocol/messages.js';

export type RelayClientStatus = 'disabled' | 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface RelayClientSnapshot {
  enabled: boolean;
  status: RelayClientStatus;
  relayUrl: string;
  deviceId: string;
  lastConnectedAt?: string;
  lastError?: string;
}

export interface RelayConnectOptions {
  relayUrl?: string;
  pairingToken?: string;
  deviceId?: string;
}

export class RelayClient {
  private status: RelayClientStatus = serverConfig.uplink.enabled ? 'idle' : 'disabled';
  private enabled = serverConfig.uplink.enabled;
  private relayUrl = serverConfig.uplink.relayUrl;
  private pairingToken = serverConfig.uplink.pairingToken;
  private deviceId = serverConfig.uplink.deviceId;
  private socket?: WebSocket;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectDelay = serverConfig.uplink.reconnectMinMs;
  private lastConnectedAt?: string;
  private lastError?: string;
  private readonly startedAt = Date.now();
  private deviceEndpoint: AgentHubEndpoint;
  private readonly dispatcher: CommandDispatcher;

  constructor(
    private readonly state: StateStore,
    private readonly events: EventBus,
    chatHandler?: AgentChatHandler,
    recoveryHandler?: AgentChatRecoveryHandler
  ) {
    this.deviceEndpoint = { kind: 'device', id: this.deviceId };
    this.dispatcher = new CommandDispatcher(state, this.deviceEndpoint, chatHandler, (envelope) => this.send(envelope), recoveryHandler);
  }

  start() {
    if (!this.enabled) {
      this.events.emit('uplink.disabled', { reason: 'REIKA_UPLINK_ENABLED is false' });
      return;
    }

    if (!serverConfig.uplink.relayUrl) {
      this.fail('REIKA_RELAY_URL is required when uplink is enabled');
      return;
    }

    this.connect();
  }

  connectWith(options: RelayConnectOptions) {
    this.stop(false);
    this.enabled = true;
    this.status = 'idle';
    this.relayUrl = options.relayUrl || this.relayUrl;
    this.pairingToken = options.pairingToken || this.pairingToken;
    this.deviceId = options.deviceId || this.deviceId;
    this.deviceEndpoint = { kind: 'device', id: this.deviceId };
    this.lastError = undefined;
    this.start();
  }

  stop(disableReconnect = true) {
    if (disableReconnect) this.enabled = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.status = this.enabled ? 'disconnected' : 'disabled';
  }

  snapshot(): RelayClientSnapshot {
    return {
      enabled: this.enabled,
      status: this.status,
      relayUrl: this.relayUrl,
      deviceId: this.deviceId,
      lastConnectedAt: this.lastConnectedAt,
      lastError: this.lastError
    };
  }

  private connect() {
    if (!this.enabled) return;
    this.status = 'connecting';
    this.events.emit('uplink.connecting', { relayUrl: this.relayUrl });

    try {
      const url = new URL(this.relayUrl);
      if (this.pairingToken) url.searchParams.set('pairingToken', this.pairingToken);
      url.searchParams.set('deviceId', this.deviceId);

      const socket = new WebSocket(url);
      this.socket = socket;
      socket.addEventListener('open', () => this.onOpen());
      socket.addEventListener('message', (event) => void this.onMessage(event.data));
      socket.addEventListener('close', () => this.onClose(socket));
      socket.addEventListener('error', () => this.fail('Relay WebSocket error'));
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
      this.scheduleReconnect();
    }
  }

  private onOpen() {
    if (!this.enabled) {
      this.socket?.close();
      return;
    }
    this.status = 'connected';
    this.lastConnectedAt = new Date().toISOString();
    this.lastError = undefined;
    this.reconnectDelay = serverConfig.uplink.reconnectMinMs;
    this.events.emit('uplink.connected', { relayUrl: this.relayUrl });
    this.sendHello();
    this.sendStateSnapshots();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), serverConfig.uplink.heartbeatMs);
  }

  private onClose(socket: WebSocket) {
    if (this.socket !== socket) return;
    this.socket = undefined;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.status = this.enabled ? 'disconnected' : 'disabled';
    this.events.emit('uplink.disconnected', {});
    this.scheduleReconnect();
  }

  private async onMessage(data: unknown) {
    const raw = typeof data === 'string' ? data : data instanceof ArrayBuffer ? Buffer.from(data).toString('utf8') : String(data);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.events.emit('uplink.invalid_message', { reason: 'INVALID_JSON' });
      return;
    }

    if (!isAgentHubEnvelope(parsed)) {
      this.events.emit('uplink.invalid_message', { reason: 'INVALID_ENVELOPE' });
      return;
    }

    if (parsed.type.startsWith('command.')) {
      this.events.emit('uplink.command_status', { type: parsed.type, replyTo: parsed.replyTo, payload: parsed.payload });
      return;
    }

    const responses = await this.dispatcher.dispatch(parsed);
    for (const response of responses) this.send(response);
  }

  private scheduleReconnect() {
    if (!this.enabled) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, serverConfig.uplink.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
    this.events.emit('uplink.reconnect_scheduled', { delayMs: delay });
  }

  private fail(message: string) {
    this.status = 'error';
    this.lastError = message;
    this.events.emit('uplink.error', { message });
  }

  private sendHello() {
    const snapshot = this.state.snapshot();
    this.send(createEnvelope<DeviceHelloPayload>({
      type: 'device.hello',
      source: this.deviceEndpoint,
      target: { kind: 'relay', id: 'relay' },
      payload: {
        deviceId: this.deviceId,
        deviceName: snapshot.device.name,
        platform: snapshot.device.platform,
        service: serverConfig.serviceName,
        capabilities: [...deviceAgentCapabilities],
        pairingCode: this.pairingToken || undefined
      }
    }));
  }

  private sendHeartbeat() {
    const snapshot = this.state.snapshot();
    this.send(createEnvelope<DeviceHeartbeatPayload>({
      type: 'device.heartbeat',
      source: this.deviceEndpoint,
      target: { kind: 'relay', id: 'relay' },
      payload: {
        deviceId: this.deviceId,
        status: snapshot.device.status === 'ready' ? 'ready' : 'degraded',
        activeProviderId: snapshot.activeProviderId,
        uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000)
      }
    }));
  }

  sendStateSnapshots() {
    this.send(this.dispatcher.stateSnapshot());
    this.send(this.dispatcher.providerSnapshot());
    this.send(this.dispatcher.agentRoster());
  }

  private send(envelope: AgentHubEnvelope) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(envelope));
  }
}
