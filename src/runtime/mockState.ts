import os from 'node:os';
import type { AgentRecord } from '../modules/agent/types.js';
import type { DeviceIdentity } from '../modules/device/types.js';
import type { ProviderRecord } from '../modules/provider/types.js';

export function createDeviceIdentity(): DeviceIdentity {
  return {
    id: 'linux-device-local',
    name: 'Linux Reika Agent Server',
    platform: 'linux',
    hostname: os.hostname(),
    status: 'ready',
    startedAt: new Date().toISOString()
  };
}

export const providers: ProviderRecord[] = [
  {
    id: 'mock-local',
    kind: 'mock',
    name: 'Mock Local Provider',
    status: 'preferred',
    notes: 'Offline placeholder provider. Real provider detection/connectivity is intentionally not implemented yet.',
    capabilities: [
      { id: 'state', label: 'Local state' },
      { id: 'events', label: 'In-memory events' },
      { id: 'commandcenter', label: 'CommandCenter adapter', planned: true },
      { id: 'openclaw', label: 'OpenClaw direct adapter', planned: true },
      { id: 'hermes', label: 'Hermes direct adapter', planned: true }
    ]
  }
];

export const agents: AgentRecord[] = [
  {
    id: 'reika',
    name: 'Reika',
    callsign: 'REI-01',
    role: 'Main mascot agent represented by this device server.',
    state: 'ready',
    providerId: 'mock-local',
    isMascot: true
  }
];
