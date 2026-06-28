import type { AgentSummary } from '../modules/agent/types';
import type { MascotAsset } from '../modules/asset/types';
import type { ConversationSummary, ChatMessage } from '../modules/chat/types';
import type { DeviceSummary } from '../modules/device/types';
import type { AppNotification } from '../modules/notification/types';
import type { ProviderSummary } from '../modules/provider/types';
import type { ClientSettings } from '../modules/settings/types';

export const providers: ProviderSummary[] = [
  {
    id: 'mock-local',
    name: 'Local Mock Runtime',
    kind: 'mock',
    status: 'preferred',
    endpointLabel: 'offline fixture',
    notes: 'Temporary local-only provider while external connection planning is deferred.',
    capabilities: [
      { id: 'chat', label: 'Chat shell' },
      { id: 'history', label: 'Mock history' },
      { id: 'events', label: 'Local UI events' },
      { id: 'commandcenter', label: 'CommandCenter adapter', planned: true }
    ]
  },
  {
    id: 'commandcenter-planned',
    name: 'CommandCenter',
    kind: 'commandcenter',
    status: 'planned',
    endpointLabel: 'planned local provider',
    notes: 'Preferred future rich provider when installed locally; no connection code yet.',
    capabilities: [
      { id: 'roster', label: 'Roster discovery', planned: true },
      { id: 'sessions', label: 'Sessions/history', planned: true },
      { id: 'sse', label: 'Turn lifecycle SSE', planned: true },
      { id: 'ws', label: 'Ambient WebSocket events', planned: true }
    ]
  }
];

export const agents: AgentSummary[] = [
  {
    id: 'reika',
    name: 'Reika',
    callsign: 'REI-01',
    role: 'Main agent mascot and Linux client pilot',
    mood: 'ready',
    providerId: 'mock-local',
    accent: '#6FEFFF',
    isMascot: true
  }
];

export const devices: DeviceSummary[] = [
  {
    id: 'linux-client',
    name: 'Linux Agent Client',
    platform: 'linux',
    status: 'this-device',
    description: 'This repo: a Linux-first shell for Reika, built locally by Astra.'
  },
  {
    id: 'windows-machine',
    name: 'Windows Agent Machine',
    platform: 'windows',
    status: 'planned',
    description: 'Epic’s Windows Codex machine lives outside this repo for now.'
  }
];

export const conversations: ConversationSummary[] = [
  { id: 'welcome', title: 'Reika boot sequence', agentId: 'reika', messageCount: 3, updatedAt: 'local mock' }
];

export const messages: ChatMessage[] = [
  { id: 'm1', role: 'system', speaker: 'System', text: 'External provider connections are intentionally disabled in this phase.', timestamp: 'now' },
  { id: 'm2', role: 'assistant', speaker: 'Reika', text: 'Linux client shell online. Waiting for the real provider contract, boss.', timestamp: 'now' },
  { id: 'm3', role: 'user', speaker: 'Epic', text: 'Hold connection work until we plan it.', timestamp: 'now' }
];

export const notifications: AppNotification[] = [
  { id: 'n1', tone: 'success', title: 'Phase 0 active', body: 'UI shell, modules, and mock provider boundary are ready.' },
  { id: 'n2', tone: 'info', title: 'Connection layer locked', body: 'No external provider calls are implemented yet.' }
];

export const assets: MascotAsset[] = [
  { id: 'portrait-placeholder', label: 'Reika portrait placeholder', kind: 'portrait', status: 'placeholder' },
  { id: 'theme-reika-night', label: 'Reika Night theme', kind: 'theme', status: 'ready' },
  { id: 'voice-reika', label: 'Reika voice profile', kind: 'voice', status: 'planned' }
];

export const settings: ClientSettings = {
  theme: 'reika-night',
  externalConnectionsEnabled: false,
  preferredProviderOrder: ['CommandCenter', 'OpenClaw', 'Hermes', 'Mock'],
  notes: [
    'Devices are not providers; providers are not agents.',
    'CommandCenter is a future preferred provider, not the app data model.',
    'Reika vertical slice comes before extra mascots, voice, Live2D, VRM, or Twitch features.'
  ]
};
