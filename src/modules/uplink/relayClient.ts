import { serverConfig } from '../../config/defaults.js';
import type { EventBus } from '../../core/eventBus.js';
import type { StateStore } from '../../core/stateStore.js';
import { CommandDispatcher } from '../commands/dispatcher.js';
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

export class RelayClient {
  private status: RelayClientStatus = serverConfig.uplink.enabled ? 'idle' : 'disabled';
  private socket?: WebSocket;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectDelay = serverConfig.uplink.reconnectMinMs;
  private lastConnectedAt?: string;
  private lastError?: string;
  private readonly startedAt = Date.now();
  private readonly deviceEndpoint: AgentHubEndpoint;
  private readonly dispatcher: CommandDispatcher;

  constructor(
    private readonly state: StateStore,
    private readonly events: EventBus
  ) {
    this.deviceEndpoint = { kind: 'device', id: serverConfig.uplink.deviceId };
    this.dispatcher = new CommandDispatcher(state, this.deviceEndpoint);
  }

  start() {
    if (!serverConfig.uplink.enabled) {
      this.events.emit('uplink.disabled', { reason: 'REIKA_UPLINK_ENABLED is false' });
      return;
    }

    if (!serverConfig.uplink.relayUrl) {
      this.fail('REIKA_RELAY_URL is required when uplink is enabled');
      return;
    }

    this.connect();
  }

  stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = undefined;
    this.status = serverConfig.uplink.enabled ? 'disconnected' : 'disabled';
  }

  snapshot(): RelayClientSnapshot {
    return {
      enabled: serverConfig.uplink.enabled,
      status: this.status,
      relayUrl: serverConfig.uplink.relayUrl,
      deviceId: serverConfig.uplink.deviceId,
      lastConnectedAt: this.lastConnectedAt,
      lastError: this.lastError
    };
  }

  private connect() {
    this.status = 'connecting';
    this.events.emit('uplink.connecting', { relayUrl: serverConfig.uplink.relayUrl });

    try {
      const url = new URL(serverConfig.uplink.relayUrl);
      if (serverConfig.uplink.pairingToken) url.searchParams.set('pairingToken', serverConfig.uplink.pairingToken);
      url.searchParams.set('deviceId', serverConfig.uplink.deviceId);

      this.socket = new WebSocket(url);
      this.socket.addEventListener('open', () => this.onOpen());
      this.socket.addEventListener('message', (event) => void this.onMessage(event.data));
      this.socket.addEventListener('close', () => this.onClose());
      this.socket.addEventListener('error', () => this.fail('Relay WebSocket error'));
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
      this.scheduleReconnect();
    }
  }

  private onOpen() {
    this.status = 'connected';
    this.lastConnectedAt = new Date().toISOString();
    this.lastError = undefined;
    this.reconnectDelay = serverConfig.uplink.reconnectMinMs;
    this.events.emit('uplink.connected', { relayUrl: serverConfig.uplink.relayUrl });
    this.sendHello();
    this.sendStateSnapshots();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), serverConfig.uplink.heartbeatMs);
  }

  private onClose() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.status = 'disconnected';
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

    const responses = await this.dispatcher.dispatch(parsed);
    for (const response of responses) this.send(response);
  }

  private scheduleReconnect() {
    if (!serverConfig.uplink.enabled) return;
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
        deviceId: snapshot.device.id,
        deviceName: snapshot.device.name,
        platform: snapshot.device.platform,
        service: serverConfig.serviceName,
        capabilities: [...deviceAgentCapabilities]
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
        deviceId: snapshot.device.id,
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
