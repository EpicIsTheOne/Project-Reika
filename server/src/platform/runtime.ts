import os from 'node:os';
import type { DevicePlatform } from '../modules/device/types.js';

export function currentPlatform(): DevicePlatform {
  switch (process.platform) {
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    default:
      return 'unknown';
  }
}

export function defaultDeviceId() {
  const platform = currentPlatform();
  const hostname = os.hostname().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${platform}-${hostname || 'device'}-local`;
}

export function defaultDeviceName() {
  const hostname = os.hostname();
  switch (currentPlatform()) {
    case 'windows':
      return `${hostname} Windows Agent`;
    case 'linux':
      return `${hostname} Linux Agent`;
    case 'macos':
      return `${hostname} macOS Agent`;
    default:
      return `${hostname} Reika Agent`;
  }
}

export function shouldOpenPairingUi() {
  return process.platform === 'win32' && process.env.REIKA_PAIRING_UI !== '0' && process.env.REIKA_PAIRING_UI !== 'false';
}
