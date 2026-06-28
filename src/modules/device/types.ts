export type DeviceStatus = 'this-device' | 'online' | 'planned' | 'offline';

export interface DeviceSummary {
  id: string;
  name: string;
  platform: 'linux' | 'windows' | 'android' | 'ios' | 'macos' | 'web';
  status: DeviceStatus;
  description: string;
}
