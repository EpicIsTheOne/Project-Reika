export type DevicePlatform = 'linux';
export type DeviceServerStatus = 'booting' | 'ready' | 'degraded' | 'offline';

export interface DeviceIdentity {
  id: string;
  name: string;
  platform: DevicePlatform;
  hostname: string;
  status: DeviceServerStatus;
  startedAt: string;
}
