import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface ReikaSettings {
  version: 1;
  language: string;
  startupView: 'home' | 'chat' | 'devices' | 'notifications' | 'settings';
  relayUrl: string;
  minimizeToTray: boolean;
  mockEnabled: boolean;
  autoUpdateServer: boolean;
  autoUpdateClient: boolean;
  developerDiagnostics: boolean;
  updatedAt: string;
}

export interface SettingsStoreSnapshot {
  path: string;
  loaded: boolean;
  lastSavedAt?: string;
  lastError?: string;
}

const defaultSettings: ReikaSettings = {
  version: 1,
  language: 'English',
  startupView: 'home',
  relayUrl: process.env.REIKA_RELAY_URL || 'wss://relay.techexplore.us/v1/device',
  minimizeToTray: true,
  mockEnabled: true,
  autoUpdateServer: false,
  autoUpdateClient: false,
  developerDiagnostics: false,
  updatedAt: new Date(0).toISOString()
};

const defaultStorePath = join(homedir(), '.local', 'share', 'project-reika', 'settings.json');

function storagePath() {
  return process.env.REIKA_SETTINGS_STORE_PATH || defaultStorePath;
}

function normalizeSettings(input: Partial<ReikaSettings> = {}): ReikaSettings {
  const startupView = ['home', 'chat', 'devices', 'notifications', 'settings'].includes(String(input.startupView))
    ? input.startupView as ReikaSettings['startupView']
    : defaultSettings.startupView;
  return {
    ...defaultSettings,
    ...input,
    version: 1,
    language: typeof input.language === 'string' && input.language.trim() ? input.language.trim() : defaultSettings.language,
    startupView,
    relayUrl: normalizeRelayUrl(input.relayUrl) ?? defaultSettings.relayUrl,
    minimizeToTray: typeof input.minimizeToTray === 'boolean' ? input.minimizeToTray : defaultSettings.minimizeToTray,
    mockEnabled: typeof input.mockEnabled === 'boolean' ? input.mockEnabled : defaultSettings.mockEnabled,
    autoUpdateServer: typeof input.autoUpdateServer === 'boolean' ? input.autoUpdateServer : defaultSettings.autoUpdateServer,
    autoUpdateClient: typeof input.autoUpdateClient === 'boolean' ? input.autoUpdateClient : defaultSettings.autoUpdateClient,
    developerDiagnostics: typeof input.developerDiagnostics === 'boolean' ? input.developerDiagnostics : defaultSettings.developerDiagnostics,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString()
  };
}

function normalizeRelayUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}

export class SettingsStore {
  private readonly path = storagePath();
  private settings = normalizeSettings();
  private loaded = false;
  private lastSavedAt?: string;
  private lastError?: string;
  private saveQueue: Promise<void> = Promise.resolve();

  async load() {
    try {
      const raw = await readFile(this.path, 'utf8');
      this.settings = normalizeSettings(JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<ReikaSettings>);
      this.loaded = true;
      this.lastError = undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.settings = normalizeSettings({ updatedAt: new Date().toISOString() });
        this.loaded = true;
        this.lastError = undefined;
        this.queueSave();
        return;
      }
      this.loaded = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  snapshot(): SettingsStoreSnapshot {
    return {
      path: this.path,
      loaded: this.loaded,
      lastSavedAt: this.lastSavedAt,
      lastError: this.lastError
    };
  }

  get() {
    return this.settings;
  }

  update(input: Partial<ReikaSettings>) {
    const cleanInput = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<ReikaSettings>;
    this.settings = normalizeSettings({
      ...this.settings,
      ...cleanInput,
      updatedAt: new Date().toISOString()
    });
    this.queueSave();
    return this.settings;
  }

  async flush() {
    await this.saveQueue;
  }

  private queueSave() {
    this.saveQueue = this.saveQueue.then(() => this.save()).catch((error) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error(`Failed to save Project Reika settings: ${this.lastError}`);
    });
  }

  private async save() {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8');
    await rename(tmp, this.path);
    this.lastSavedAt = new Date().toISOString();
    this.lastError = undefined;
  }
}
