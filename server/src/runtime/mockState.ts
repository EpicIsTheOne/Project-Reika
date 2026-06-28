import os from 'node:os';
import type { AgentRecord } from '../modules/agent/types.js';
import type { DeviceIdentity } from '../modules/device/types.js';

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
