export type DevicePlatform = 'linux' | 'windows' | 'macos' | 'unknown';
export type DeviceServerStatus = 'booting' | 'ready' | 'degraded' | 'offline';

export interface DeviceIdentity {
  id: string;
  name: string;
  platform: DevicePlatform;
  hostname: string;
  status: DeviceServerStatus;
  startedAt: string;
}
