import { defaultDeviceId } from '../platform/runtime.js';

function intFromEnv(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boolFromEnv(name: string, fallback = false) {
  const value = process.env[name];
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const serverConfig = {
  serviceName: 'project-reika-node',
  displayName: 'Reika Node',
  host: process.env.REIKA_AGENT_HOST || '127.0.0.1',
  port: intFromEnv('REIKA_AGENT_PORT', 47840),
  externalUplinkEnabled: boolFromEnv('REIKA_UPLINK_ENABLED', false),
  providerConnectionsEnabled: true,
  chatTransportEnabled: false,
  uplink: {
    enabled: boolFromEnv('REIKA_UPLINK_ENABLED', false),
    relayUrl: process.env.REIKA_RELAY_URL || 'ws://127.0.0.1:8790/v1/device',
    deviceId: process.env.REIKA_DEVICE_ID || defaultDeviceId(),
    deviceKeyPath: process.env.REIKA_DEVICE_KEY_PATH || '',
    pairingToken: process.env.REIKA_PAIRING_TOKEN || '',
    heartbeatMs: intFromEnv('REIKA_HEARTBEAT_MS', 25_000),
    watchdogMs: intFromEnv('REIKA_WATCHDOG_MS', Math.max(45_000, intFromEnv('REIKA_HEARTBEAT_MS', 25_000) + Math.max(15_000, Math.floor(intFromEnv('REIKA_HEARTBEAT_MS', 25_000) / 2)))),
    reconnectMinMs: intFromEnv('REIKA_RECONNECT_MIN_MS', 1_000),
    reconnectMaxMs: intFromEnv('REIKA_RECONNECT_MAX_MS', 30_000)
  }
} as const;
