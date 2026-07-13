import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir, platform } from 'node:os';

export interface ProjectDiscoverySettings {
  enabled: boolean;
  roots: string[];
  excludeDirectories: string[];
  maxDepth: number;
  scanIntervalMinutes: number;
  defaultAgentId?: string;
}

export interface ReikaSettings {
  version: 1;
  language: string;
  startupView: 'home' | 'chat' | 'devices' | 'notifications' | 'settings';
  relayUrl: string;
  theme: 'dark' | 'blue' | 'contrast';
  minimizeToTray: boolean;
  mockEnabled: boolean;
  notificationPreferences: NotificationPreferences;
  agentSelector: AgentSelectorSettings;
  projectDiscovery: ProjectDiscoverySettings;
  autoUpdateServer: boolean;
  autoUpdateClient: boolean;
  developerDiagnostics: boolean;
  updatedAt: string;
}

export type NotificationPreferenceKey = 'agent' | 'device' | 'provider' | 'chat' | 'file' | 'system' | 'warning';
export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>;
export type AgentSelectorLabelMode = 'agent-provider' | 'agent-only' | 'agent-device';
export type AgentSelectorDuplicatePreference = 'agent' | 'commandcenter';
export interface AgentSelectorSettings {
  labelMode: AgentSelectorLabelMode;
  showRole: boolean;
  hideCommandCenterDuplicates: boolean;
  duplicatePreference: AgentSelectorDuplicatePreference;
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
  relayUrl: process.env.REIKA_RELAY_URL || 'ws://127.0.0.1:8790/v1/device',
  theme: 'dark',
  minimizeToTray: true,
  mockEnabled: true,
  notificationPreferences: {
    agent: true,
    device: true,
    provider: true,
    chat: true,
    file: true,
    system: true,
    warning: true
  },
  agentSelector: {
    labelMode: 'agent-provider',
    showRole: true,
    hideCommandCenterDuplicates: true,
    duplicatePreference: 'agent'
  },
  projectDiscovery: {
    enabled: true,
    roots: defaultProjectDiscoveryRoots(),
    excludeDirectories: [
      'node_modules', '.git', '.svn', '.hg', '.next', '.nuxt', '.cache', '.venv', 'venv',
      'dist', 'build', 'release', 'coverage', 'target', 'bin', 'obj', 'vendor', 'packages'
    ],
    maxDepth: 4,
    scanIntervalMinutes: 15
  },
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
    theme: normalizeTheme(input.theme),
    minimizeToTray: typeof input.minimizeToTray === 'boolean' ? input.minimizeToTray : defaultSettings.minimizeToTray,
    mockEnabled: typeof input.mockEnabled === 'boolean' ? input.mockEnabled : defaultSettings.mockEnabled,
    notificationPreferences: normalizeNotificationPreferences(input.notificationPreferences),
    agentSelector: normalizeAgentSelector(input.agentSelector),
    projectDiscovery: normalizeProjectDiscovery(input.projectDiscovery),
    autoUpdateServer: typeof input.autoUpdateServer === 'boolean' ? input.autoUpdateServer : defaultSettings.autoUpdateServer,
    autoUpdateClient: typeof input.autoUpdateClient === 'boolean' ? input.autoUpdateClient : defaultSettings.autoUpdateClient,
    developerDiagnostics: typeof input.developerDiagnostics === 'boolean' ? input.developerDiagnostics : defaultSettings.developerDiagnostics,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString()
  };
}

function defaultProjectDiscoveryRoots() {
  if (platform() === 'win32') return [join(homedir(), 'Documents')];
  return [join(homedir(), '.agenthub'), join(homedir(), '.openclaw', 'workspace')];
}

function normalizeProjectDiscovery(value: unknown): ProjectDiscoverySettings {
  const input = typeof value === 'object' && value ? value as Partial<ProjectDiscoverySettings> : {};
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : defaultSettings.projectDiscovery.enabled,
    roots: cleanStringList(input.roots, defaultSettings.projectDiscovery.roots),
    excludeDirectories: cleanStringList(input.excludeDirectories, defaultSettings.projectDiscovery.excludeDirectories),
    maxDepth: boundedInteger(input.maxDepth, defaultSettings.projectDiscovery.maxDepth, 1, 8),
    scanIntervalMinutes: boundedInteger(input.scanIntervalMinutes, defaultSettings.projectDiscovery.scanIntervalMinutes, 1, 1440),
    defaultAgentId: typeof input.defaultAgentId === 'string' && input.defaultAgentId.trim() ? input.defaultAgentId.trim() : undefined
  };
}

function cleanStringList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return [...fallback];
  return Array.from(new Set(value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)));
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function normalizeTheme(value: unknown): ReikaSettings['theme'] {
  return value === 'blue' || value === 'contrast' || value === 'dark' ? value : defaultSettings.theme;
}

function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
  const input = typeof value === 'object' && value ? value as Partial<Record<NotificationPreferenceKey, unknown>> : {};
  return {
    agent: typeof input.agent === 'boolean' ? input.agent : defaultSettings.notificationPreferences.agent,
    device: typeof input.device === 'boolean' ? input.device : defaultSettings.notificationPreferences.device,
    provider: typeof input.provider === 'boolean' ? input.provider : defaultSettings.notificationPreferences.provider,
    chat: typeof input.chat === 'boolean' ? input.chat : defaultSettings.notificationPreferences.chat,
    file: typeof input.file === 'boolean' ? input.file : defaultSettings.notificationPreferences.file,
    system: typeof input.system === 'boolean' ? input.system : defaultSettings.notificationPreferences.system,
    warning: typeof input.warning === 'boolean' ? input.warning : defaultSettings.notificationPreferences.warning
  };
}

function normalizeAgentSelector(value: unknown): AgentSelectorSettings {
  const input = typeof value === 'object' && value ? value as Partial<Record<keyof AgentSelectorSettings, unknown>> : {};
  const labelMode = input.labelMode === 'agent-only' || input.labelMode === 'agent-device' || input.labelMode === 'agent-provider'
    ? input.labelMode
    : defaultSettings.agentSelector.labelMode;
  const duplicatePreference = input.duplicatePreference === 'commandcenter' || input.duplicatePreference === 'agent'
    ? input.duplicatePreference
    : defaultSettings.agentSelector.duplicatePreference;
  return {
    labelMode,
    showRole: typeof input.showRole === 'boolean' ? input.showRole : defaultSettings.agentSelector.showRole,
    hideCommandCenterDuplicates: typeof input.hideCommandCenterDuplicates === 'boolean'
      ? input.hideCommandCenterDuplicates
      : defaultSettings.agentSelector.hideCommandCenterDuplicates,
    duplicatePreference
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
      projectDiscovery: cleanInput.projectDiscovery ? { ...this.settings.projectDiscovery, ...cleanInput.projectDiscovery } : this.settings.projectDiscovery,
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
