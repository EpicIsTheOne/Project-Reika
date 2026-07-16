import http from 'node:http';
import { existsSync } from 'node:fs';
import { parseCliArgs, helpText, type CliOptions } from './cli/args.js';
import { serverConfig } from './config/defaults.js';
import { EventBus } from './core/eventBus.js';
import { StateStore } from './core/stateStore.js';
import { CommandDispatcher } from './modules/commands/dispatcher.js';
import { ArtStore } from './modules/art/artStore.js';
import { FileStore, publicFile } from './modules/file/fileStore.js';
import { NotificationStore } from './modules/notification/notificationStore.js';
import { MemoryMeshStore } from './modules/memoryMesh/memoryMeshStore.js';
import { ReikaMemoryToolRuntime, createReikaToolCall, reikaMemoryToolDefinitions, toCommandCenterToolSchemas, toHermesToolManifest, toOpenAiToolSchemas } from './modules/memoryMesh/toolRuntime.js';
import type { MemoryAccessContext, MemoryRecord, MeshAgent, MeshDevice, MeshProject, ReikaMemoryToolName, RouteDecision, RoutingTask } from './modules/memoryMesh/types.js';
import { findProvider, getProviderHistoryMessages, listProviderHistorySessions, runProviderChat, type ProviderChatEvent, type ProviderChatMessage, type ProviderHistoryMessage, type ProviderHistorySession } from './modules/provider/providerRuntime.js';
import { SettingsStore } from './modules/settings/settingsStore.js';
import { scanProjects } from './modules/projectDiscovery/projectScanner.js';
import { SessionStore, type ChatMessageRecord, type ChatSessionRecord } from './modules/session/sessionStore.js';
import { RelayClient } from './modules/uplink/relayClient.js';
import { applyGitHubUpdate, getUpdateStatus, updateTargetsEnabled } from './modules/update/updateService.js';
import { openLocalUrl } from './platform/openBrowser.js';
import { shouldOpenPairingUi } from './platform/runtime.js';
import { disableStartup, enableStartup, formatStartupStatus, getStartupStatus } from './platform/startup.js';
import { pairingPage } from './ui/pairingPage.js';
import { createEnvelope, type AgentHubMessageType } from './shared/protocol/envelope.js';
import type { ProjectDiscoverySnapshotPayload } from './shared/protocol/messages.js';

type ChatMessage = ChatMessageRecord;
type ChatSession = ChatSessionRecord;

let cli: CliOptions;
try {
  cli = parseCliArgs();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error('');
  console.error(helpText());
  process.exit(1);
}

if (cli.mode === 'help') {
  console.log(helpText());
  process.exit(0);
}

async function runStartupCli(options: CliOptions) {
  try {
    const action = options.startupAction ?? 'status';
    const status =
      action === 'enable'
        ? await enableStartup({ relayUrl: options.relayUrl, deviceId: options.deviceId ?? serverConfig.uplink.deviceId })
        : action === 'disable'
          ? await disableStartup()
          : await getStartupStatus();
    console.log(formatStartupStatus(status));
    process.exit(status.supported ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function formatUpdateStatus(status: Awaited<ReturnType<typeof getUpdateStatus>>) {
  const lines = [
    `Supported: ${status.supported ? 'yes' : 'no'}`,
    `Mode: ${status.mode || 'unknown'}`,
    `Available: ${status.available ? 'yes' : 'no'}`,
    `Behind: ${status.behindBy}`,
    `Ahead: ${status.aheadBy}`,
    `Branch: ${status.branch || 'unknown'}`,
    `Local: ${status.localSha?.slice(0, 12) || 'unknown'}`,
    `Remote: ${status.remoteSha?.slice(0, 12) || 'unknown'}`,
    `Auto update server: ${status.settings?.autoUpdateServer ? 'on' : 'off'}`,
    `Auto update client: ${status.settings?.autoUpdateClient ? 'on' : 'off'}`,
    `Message: ${status.message}`
  ];
  if (status.descriptions.length > 0) {
    lines.push('', 'Update descriptions:');
    for (const item of status.descriptions.slice(0, 8)) {
      lines.push(`- ${item.sha ? `${item.sha} ` : ''}${item.title}`);
      if (item.body) lines.push(`  ${item.body.replace(/\n/g, '\n  ')}`);
    }
  }
  if (status.files.length > 0) {
    lines.push('', 'Changed files:');
    for (const file of status.files.slice(0, 40)) lines.push(`- ${file.status} ${file.path}`);
    if (status.files.length > 40) lines.push(`- ...and ${status.files.length - 40} more`);
  }
  if (status.installerAsset) {
    lines.push('', 'Packaged installer:');
    lines.push(`- ${status.installerAsset.name}`);
    lines.push(`- ${status.installerAsset.url}`);
  }
  return lines.join('\n');
}

async function runUpdatesCli(options: CliOptions) {
  const cliSettings = new SettingsStore();
  try {
    await cliSettings.load();
    const action = options.updatesAction ?? 'status';
    if (action === 'enable' || action === 'disable') {
      const target = options.updatesTarget ?? 'all';
      const enabled = action === 'enable';
      const next = cliSettings.update({
        autoUpdateServer: target === 'server' || target === 'all' ? enabled : undefined,
        autoUpdateClient: target === 'client' || target === 'all' ? enabled : undefined
      });
      await cliSettings.flush();
      console.log(`Auto update server: ${next.autoUpdateServer ? 'on' : 'off'}`);
      console.log(`Auto update client: ${next.autoUpdateClient ? 'on' : 'off'}`);
      process.exit(0);
    }
    if (action === 'apply') {
      const result = await applyGitHubUpdate(cliSettings.get());
      console.log(formatUpdateStatus(result));
      if (result.applyOutput) console.log(`\nApply output:\n${result.applyOutput}`);
      process.exit(0);
    }
    const status = await getUpdateStatus(cliSettings.get());
    console.log(formatUpdateStatus(status));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function runRelayCli(options: CliOptions) {
  const cliSettings = new SettingsStore();
  try {
    await cliSettings.load();
    const action = options.relayAction ?? 'status';
    if (action === 'set') {
      if (!options.relayUrl) throw new Error('relay set requires --relay <ws:// or wss:// URL ending in /v1/device>.');
      if (!isRelayDeviceUrl(options.relayUrl)) throw new Error('Relay URL must be a ws:// or wss:// URL ending in /v1/device.');
      const previous = cliSettings.get().relayUrl;
      const next = cliSettings.update({ relayUrl: options.relayUrl });
      await cliSettings.flush();
      if (next.relayUrl === previous) {
        console.log(`Relay URL unchanged: ${next.relayUrl}`);
      } else {
        console.log(`Relay URL updated: ${next.relayUrl}`);
      }
      console.log('Use `pair --code <code> --relay <url>` for an immediate terminal pairing run.');
      process.exit(0);
    }
    console.log(`Saved relay URL: ${cliSettings.get().relayUrl}`);
    console.log(`Default relay URL: ${serverConfig.uplink.relayUrl}`);
    console.log('Change it with: reika-node relay set --relay wss://relay.example.com/v1/device');
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function isRelayDeviceUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === 'ws:' || url.protocol === 'wss:') && /\/v1\/device\/?$/u.test(url.pathname);
  } catch {
    return false;
  }
}

if (cli.mode === 'startup') {
  void runStartupCli(cli);
}

if (cli.mode === 'updates') {
  void runUpdatesCli(cli);
}

if (cli.mode === 'relay') {
  void runRelayCli(cli);
}

if (cli.mode !== 'startup' && cli.mode !== 'updates' && cli.mode !== 'relay') {
const events = new EventBus();
const state = new StateStore();
const sessions = new SessionStore();
const files = new FileStore();
const art = new ArtStore();
const settings = new SettingsStore();
const notifications = new NotificationStore();
const memoryMesh = new MemoryMeshStore();
const deviceEndpoint = { kind: 'device' as const, id: serverConfig.uplink.deviceId };
const appEndpoint = { kind: 'app' as const, id: 'local-simulator' };
const handleAgentChat: (payload: { sessionId?: string; providerSessionId?: string; providerId?: string; agent?: string; message: string; mode?: 'agent' | 'roleplay'; model?: string; fileIds?: string[] }) => Promise<import('./shared/protocol/messages.js').AgentChatResponsePayload> = async (payload) => {
  const result = await runChatTurn({
    sessionId: payload.sessionId,
    providerSessionId: payload.providerSessionId,
    providerId: payload.providerId,
    agent: payload.agent,
    message: payload.message,
    mode: payload.mode,
    model: payload.model,
    fileIds: payload.fileIds
  });
  const responseMode = result.result.mode === 'roleplay' ? 'roleplay' : result.result.mode === 'agent' ? 'agent' : undefined;
  return {
    providerId: result.result.providerId,
    agent: result.result.agentId,
    sessionId: result.result.sessionId,
    text: result.result.text,
    runtime: result.result.runtime,
    mode: responseMode,
    model: result.result.model,
    providerSessionId: typeof (result.result.metadata as Record<string, unknown> | undefined)?.providerSessionId === 'string' ? String((result.result.metadata as Record<string, unknown>).providerSessionId) : result.result.sessionId
  };
};
const recoverAgentChat = async (input: { providerId: string; agent: string; sessionId: string; providerSessionId: string }) => {
  const messages = await getProviderHistoryMessages(input.providerId, input.providerSessionId, state.snapshot().providers);
  const result = [...messages].reverse().find((message) => message.role === 'assistant' && message.text.trim());
  if (!result) return undefined;
  return { providerId: input.providerId, agent: input.agent, sessionId: input.providerSessionId || input.sessionId, text: result.text, runtime: 'recovered-history' };
};
const handleAgentVoice = async (payload: { providerId?: string; agent: string; text: string; requestId?: string }) => {
  const provider = state.snapshot().providers.find((item) => item.id === payload.providerId || item.kind === payload.providerId)
    || state.snapshot().providers.find((item) => item.kind === 'commandcenter');
  if (!provider || provider.kind !== 'commandcenter' || provider.status === 'offline' || provider.status === 'error') {
    throw new Error('Command Center voice provider is unavailable.');
  }
  const baseUrl = (process.env.COMMANDCENTER_LOCAL_API_BASE || 'http://127.0.0.1:3002/commandcenter/api/v1').replace(/\/api\/v1\/?$/u, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const [voiceResponse, audioResponse] = await Promise.all([
      fetch(`${baseUrl}/api/v1/voice?agent=${encodeURIComponent(payload.agent)}`, { signal: controller.signal }),
      fetch(`${baseUrl}/api/voice/speak`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ text: payload.text, agent: payload.agent })
      })
    ]);
    if (!audioResponse.ok) throw new Error(`Command Center voice synthesis failed (${audioResponse.status}).`);
    const audio = Buffer.from(await audioResponse.arrayBuffer());
    if (!audio.length || audio.length > 16 * 1024 * 1024) throw new Error('Command Center returned invalid voice audio.');
    const voice = voiceResponse.ok ? await voiceResponse.json().catch(() => ({})) as { resolved?: { voiceId?: string } } : {};
    return {
      provider: 'commandcenter' as const,
      agent: payload.agent,
      voiceId: voice.resolved?.voiceId,
      contentType: audioResponse.headers.get('content-type') || 'audio/mpeg',
      audioBase64: audio.toString('base64'),
      requestId: payload.requestId
    };
  } finally {
    clearTimeout(timeout);
  }
};
const dispatcher = new CommandDispatcher(state, deviceEndpoint, handleAgentChat, undefined, recoverAgentChat, handleAgentVoice);
const relayClient = new RelayClient(state, events, handleAgentChat, recoverAgentChat, handleAgentVoice);
let projectDiscoveryTimer: NodeJS.Timeout | undefined;
let projectDiscoveryInFlight: Promise<Awaited<ReturnType<typeof scanProjects>>> | undefined;

events.emit('server.boot', { serviceName: serverConfig.serviceName });

async function boot() {
  await settings.load();
  await notifications.load();
  await sessions.load();
  await files.load();
  await art.load();
  events.emit('settings.loaded', settings.snapshot());
  events.emit('notifications.loaded', notifications.snapshot());
  events.emit('session.store.loaded', sessions.snapshot());
  events.emit('file.store.loaded', files.snapshot());
  events.emit('art.store.loaded', art.snapshot());
  await state.refreshProviders({ mockEnabled: settings.get().mockEnabled });
  syncLocalStateToMemoryMesh();
  events.emit('provider.state', state.snapshot().providers);
  relayClient.start();
  void resumeInterruptedMemoryMeshTasks();
  if (cli.mode === 'pair') {
    relayClient.connectWith({
      relayUrl: cli.relayUrl,
      pairingToken: cli.code,
      deviceId: cli.deviceId
    });
  } else {
    void autoPairLocalRelay();
  }
  void syncMemoryMeshDiscovery().finally(scheduleProjectDiscovery);
  events.emit('server.ready', fullSnapshot());
  void runConfiguredUpdateCheck();
}

function fullSnapshot() {
  return {
    ...state.snapshot(),
    settings: settings.get(),
    settingsStore: settings.snapshot(),
    notifications: notifications.snapshot(),
    sessionStore: sessions.snapshot(),
    fileStore: files.snapshot(),
    artStore: art.snapshot(),
    memoryMesh: memoryMesh.snapshot(),
    uplink: relayClient.snapshot()
  };
}

async function autoPairLocalRelay() {
  if (String(process.env.REIKA_AUTO_PAIR_LOCAL_RELAY || 'true').toLowerCase() === 'false') return;
  const relayUrl = settings.get().relayUrl || serverConfig.uplink.relayUrl;
  if (!isRelayDeviceUrl(relayUrl)) return;
  const current = relayClient.snapshot();
  if (current.status === 'connected' && current.relayUrl === relayUrl) return;

  const snapshot = state.snapshot();
  const deviceId = snapshot.device.id;
  const baseUrl = relayApiBaseUrl(relayUrl);
  if (!baseUrl) return;

  try {
    const deviceState = await relayFetch<{ ok: boolean; devices?: Array<{ device?: { id?: string } }> }>(baseUrl, '/devices');
    if (deviceState.devices?.some((record) => record.device?.id === deviceId)) {
      relayClient.connectWith({ relayUrl, deviceId });
      addNotification({
        kind: 'device',
        title: 'Relay uplink restored',
        body: `${snapshot.device.name} reconnected to ${relayUrl}.`,
        source: 'uplink',
        tone: 'green',
        data: { relayUrl, deviceId }
      });
      return;
    }

    const created = await relayFetch<{ ok: boolean; pairing?: { code?: string } }>(baseUrl, '/pairing/create', 'POST', {});
    const code = created.pairing?.code;
    if (!code) throw new Error('Relay did not return a pairing code.');
    await relayFetch(baseUrl, '/pairing/claim', 'POST', {
      code,
      device: {
        name: snapshot.device.name,
        platform: snapshot.device.platform,
        type: snapshot.device.platform === 'linux' ? 'server' : 'pc',
        location: 'local',
        agentVersion: serverConfig.serviceName,
        fingerprint: deviceId
      }
    });
    await relayFetch(baseUrl, '/pairing/approve', 'POST', { code });
    relayClient.connectWith({ relayUrl, pairingToken: code, deviceId });
    addNotification({
      kind: 'device',
      title: 'Local device auto-paired',
      body: `${snapshot.device.name} was paired with ${relayUrl}.`,
      source: 'uplink',
      tone: 'green',
      data: { relayUrl, deviceId }
    });
  } catch (error) {
    addNotification({
      kind: 'warning',
      title: 'Relay auto-pair failed',
      body: error instanceof Error ? error.message : String(error),
      source: 'uplink',
      tone: 'orange',
      data: { relayUrl, deviceId }
    });
  }
}

function relayApiBaseUrl(relayDeviceUrl: string) {
  try {
    const url = new URL(relayDeviceUrl);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return undefined;
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = url.pathname.replace(/\/device\/?$/u, '').replace(/\/+$/u, '') || '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/u, '');
  } catch {
    return undefined;
  }
}

async function relayFetch<T = unknown>(baseUrl: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5_000)
  });
  const payload = await response.json().catch(() => undefined) as T & { error?: string; ok?: boolean };
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Relay request failed (${response.status}).`);
  return payload as T;
}

function meshStatus(value: unknown): MeshDevice['status'] {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'online' || normalized === 'ready' || normalized === 'available' || normalized === 'preferred') return 'online';
  if (normalized === 'busy' || normalized === 'thinking' || normalized === 'responding') return 'busy';
  if (normalized === 'offline' || normalized === 'error') return 'offline';
  return 'unknown';
}

function discoveredAgentId(deviceId: string, providerId: string, providerAgentId: string) {
  return `${deviceId}:${providerId}:${providerAgentId}`;
}

function syncLocalStateToMemoryMesh() {
  const snapshot = state.snapshot();
  const now = new Date().toISOString();
  memoryMesh.registerDevice({
    id: snapshot.device.id,
    name: snapshot.device.name,
    operatingSystem: snapshot.device.platform,
    status: meshStatus(snapshot.device.status),
    availableProviders: snapshot.providers.map((provider) => provider.id),
    availableTools: Array.from(new Set(snapshot.providers.flatMap((provider) => provider.capabilities.map((capability) => capability.id)))),
    relayEndpoint: settings.get().relayUrl,
    lastSeenAt: now
  });
  for (const provider of snapshot.providers) {
    for (const agent of provider.agents) {
      memoryMesh.registerAgent({
        id: discoveredAgentId(snapshot.device.id, provider.id, agent.id),
        displayName: agent.name,
        description: agent.label || `${agent.name} discovered through ${provider.name}.`,
        capabilities: provider.capabilities.filter((capability) => !capability.planned).map((capability) => capability.id),
        providerId: provider.id,
        providerAgentId: agent.id,
        deviceId: snapshot.device.id,
        status: meshStatus(provider.status),
        supportedTools: provider.capabilities.filter((capability) => !capability.planned).map((capability) => capability.id),
        permissions: ['local-discovery'],
        relayEndpoint: settings.get().relayUrl,
        lastSeenAt: now
      });
    }
  }
}

async function syncMemoryMeshDiscovery() {
  syncLocalStateToMemoryMesh();
  const localProjects = await runLocalProjectDiscovery();
  const baseUrl = relayApiBaseUrl(settings.get().relayUrl);
  if (!baseUrl) return { syncedLocal: true, syncedRelayDevices: 0, syncedProjects: localProjects.snapshot.projects.length, warnings: localProjects.warnings, warning: 'Relay URL is not usable for HTTP discovery.' };
  try {
    const response = await relayFetch<{ devices?: Array<{ device?: Record<string, unknown>; socketConnected?: boolean; lastHeartbeatAt?: string; projectSnapshot?: ProjectDiscoverySnapshotPayload }> }>(baseUrl, '/devices');
    let syncedRelayDevices = 0;
    let syncedProjects = localProjects.snapshot.projects.length;
    for (const record of response.devices || []) {
      const device = record.device || {};
      const deviceId = String(device.id || '').trim();
      if (!deviceId) continue;
      const providers = Array.isArray(device.providers) ? device.providers.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object')) : [];
      memoryMesh.registerDevice({
        id: deviceId,
        name: String(device.name || deviceId),
        operatingSystem: String(device.platform || device.type || 'unknown'),
        status: record.socketConnected ? 'online' : meshStatus(device.status),
        availableProviders: providers.map((provider) => String(provider.id || '')).filter(Boolean),
        availableTools: Array.from(new Set(providers.flatMap((provider) => Array.isArray(provider.capabilities) ? provider.capabilities.map(String) : []))),
        relayEndpoint: settings.get().relayUrl,
        lastSeenAt: String(record.lastHeartbeatAt || device.lastSeenAt || '') || undefined
      });
      for (const provider of providers) {
        const providerId = String(provider.id || '').trim();
        if (!providerId) continue;
        const providerCapabilities = Array.isArray(provider.capabilities) ? provider.capabilities.map(String) : [];
        const agents = Array.isArray(provider.agents) ? provider.agents.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object')) : [];
        for (const agent of agents) {
          const providerAgentId = String(agent.id || agent.name || '').trim();
          if (!providerAgentId) continue;
          memoryMesh.registerAgent({
            id: discoveredAgentId(deviceId, providerId, providerAgentId),
            displayName: String(agent.name || providerAgentId),
            description: String(agent.role || `Agent discovered through ${String(provider.name || providerId)}.`),
            capabilities: Array.isArray(agent.capabilities) ? agent.capabilities.map(String) : providerCapabilities,
            providerId,
            providerAgentId,
            deviceId,
            status: record.socketConnected ? meshStatus(agent.status || 'online') : 'offline',
            supportedTools: Array.isArray(agent.capabilities) ? agent.capabilities.map(String) : providerCapabilities,
            permissions: ['relay-discovery'],
            relayEndpoint: settings.get().relayUrl,
            lastSeenAt: String(record.lastHeartbeatAt || device.lastSeenAt || '') || undefined
          });
        }
      }
      if (deviceId !== localProjects.snapshot.deviceId && record.projectSnapshot?.deviceId === deviceId && Array.isArray(record.projectSnapshot.projects)) {
        memoryMesh.reconcileProjectDiscovery(record.projectSnapshot);
        syncedProjects += record.projectSnapshot.projects.length;
      }
      syncedRelayDevices += 1;
    }
    return { syncedLocal: true, syncedRelayDevices, syncedProjects, warnings: localProjects.warnings };
  } catch (error) {
    return { syncedLocal: true, syncedRelayDevices: 0, syncedProjects: localProjects.snapshot.projects.length, warnings: localProjects.warnings, warning: error instanceof Error ? error.message : String(error) };
  }
}

async function runLocalProjectDiscovery() {
  if (projectDiscoveryInFlight) return projectDiscoveryInFlight;
  projectDiscoveryInFlight = scanProjects(relayClient.snapshot().deviceId, settings.get().projectDiscovery);
  try {
    const result = await projectDiscoveryInFlight;
    memoryMesh.reconcileProjectDiscovery(result.snapshot);
    relayClient.setProjectSnapshot(result.snapshot);
    return result;
  } finally {
    projectDiscoveryInFlight = undefined;
  }
}

function scheduleProjectDiscovery() {
  if (projectDiscoveryTimer) clearTimeout(projectDiscoveryTimer);
  if (!settings.get().projectDiscovery.enabled) return;
  const delay = settings.get().projectDiscovery.scanIntervalMinutes * 60_000;
  projectDiscoveryTimer = setTimeout(() => {
    void syncMemoryMeshDiscovery().finally(scheduleProjectDiscovery);
  }, delay);
  projectDiscoveryTimer.unref();
}

function summarizeUpdateFiles(files: { path: string }[]) {
  if (!files.length) return 'No file list was reported.';
  const first = files.slice(0, 6).map((file) => file.path).join(', ');
  const extra = files.length > 6 ? `, and ${files.length - 6} more` : '';
  return `${first}${extra}`;
}

function updateDescriptionText(descriptions: { title: string; body?: string }[]) {
  if (!descriptions.length) return 'No update description was provided.';
  const [first] = descriptions;
  return first.body ? `${first.title}: ${first.body}` : first.title;
}

function addNotification(input: Parameters<NotificationStore['add']>[0]) {
  const preferences = settings.get().notificationPreferences;
  if (preferences[input.kind] === false) return undefined;
  return notifications.add(input);
}

function notifyUpdateAvailable(status: Awaited<ReturnType<typeof getUpdateStatus>>) {
  if (!status.available) return;
  const alreadyUnread = notifications.list({ unreadOnly: true, limit: 200 }).some((item) => {
    const update = typeof item.data?.update === 'object' && item.data.update ? item.data.update as { remoteSha?: unknown } : undefined;
    return item.source === 'github' && (item.title === 'Project Reika update available' || item.title === 'AgentHub update available') && update?.remoteSha === status.remoteSha;
  });
  if (alreadyUnread) return;
  addNotification({
    kind: 'system',
    title: 'Project Reika update available',
    body: `${status.message} Changed files: ${summarizeUpdateFiles(status.files)}. ${updateDescriptionText(status.descriptions)}`,
    source: 'github',
    tone: 'blue',
    data: { update: status }
  });
}

function notifyUpdateApplied(result: Awaited<ReturnType<typeof applyGitHubUpdate>>) {
  addNotification({
    kind: 'system',
    title: result.applied ? 'Project Reika updated from GitHub' : 'Project Reika update checked',
    body: `${result.message} Changed files: ${summarizeUpdateFiles(result.files)}. ${updateDescriptionText(result.descriptions)}`,
    source: 'github',
    tone: result.applied ? 'green' : 'blue',
    data: { update: result }
  });
}

async function runConfiguredUpdateCheck() {
  const currentSettings = settings.get();
  try {
    const status = await getUpdateStatus(currentSettings);
    events.emit('updates.checked', status);
    if (!status.available) return;
    if (updateTargetsEnabled(currentSettings)) {
      const result = await applyGitHubUpdate(currentSettings);
      events.emit('updates.applied', result);
      notifyUpdateApplied(result);
      return;
    }
    notifyUpdateAvailable(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    events.emit('updates.error', { error: message });
    addNotification({
      kind: 'warning',
      title: 'Project Reika update check failed',
      body: message,
      source: 'github',
      tone: 'orange'
    });
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(json);
}

async function readJson(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function publicSession(session: ChatSession) {
  return {
    id: session.id,
    providerId: session.providerId,
    agent: session.agent,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    lastMessagePreview: session.messages.at(-1)?.text?.slice(0, 160) || '',
    metadata: session.metadata
  };
}

function searchSessions(input: { q?: string; agent?: string; providerId?: string; limit?: number }) {
  const q = String(input.q || '').trim().toLowerCase();
  const agent = String(input.agent || '').trim().toLowerCase();
  const providerId = String(input.providerId || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(100, Number(input.limit || 20) || 20));
  return sessions.list()
    .filter((session) => !agent || session.agent.toLowerCase() === agent)
    .filter((session) => !providerId || session.providerId.toLowerCase() === providerId)
    .map((session) => {
      const haystack = [session.title, session.agent, session.providerId, ...session.messages.map((message) => message.text)].join('\n').toLowerCase();
      const score = q ? (haystack.includes(q) ? 1 : 0) : 1;
      return { session, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.session.updatedAt.localeCompare(a.session.updatedAt))
    .slice(0, limit)
    .map((item) => publicSession(item.session));
}

function filesPayload(fileIds: unknown) {
  return files.resolve(fileIds).map(publicFile);
}

function attachmentContext(fileIds: unknown) {
  const resolved = files.resolve(fileIds).map(publicFile);
  if (!resolved.length) return '';
  return resolved.map((file) => {
    const label = file.kind === 'link' ? file.sourceUrl : `${file.name} (${file.mimeType}, ${file.size} bytes)`;
    return `- ${file.id}: ${label}${file.notes ? ` — ${file.notes}` : ''}`;
  }).join('\n');
}

function createSession(input: { providerId?: string; agent?: string; title?: string; metadata?: Record<string, unknown> }) {
  const now = new Date().toISOString();
  const snapshot = state.snapshot();
  const activeProviderId = String(input.providerId || snapshot.activeProviderId || 'mock-local');
  const provider = snapshot.providers.find((item) => item.id === activeProviderId) || snapshot.providers[0];
  const agent = String(input.agent || provider?.agents?.[0]?.id || 'reika');
  const session: ChatSession = {
    id: `prs_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    providerId: activeProviderId,
    agent,
    title: String(input.title || `${agent} session`),
    createdAt: now,
    updatedAt: now,
    messages: [],
    metadata: input.metadata || {}
  };
  sessions.set(session);
  events.emit('chat.session.created', publicSession(session));
  return session;
}

function getOrCreateSession(input: { sessionId?: string; providerId?: string; agent?: string; title?: string; metadata?: Record<string, unknown> }) {
  const existing = input.sessionId ? sessions.get(input.sessionId) : undefined;
  if (existing) return existing;
  return createSession(input);
}

function localImportedSessionId(providerId: string, providerSessionId: string) {
  const safe = `${providerId}_${providerSessionId}`.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
  return `prs_import_${safe}`;
}

function importProviderSession(record: ProviderHistorySession, messages: ProviderHistoryMessage[] = []) {
  const id = localImportedSessionId(record.providerId, record.providerSessionId);
  const existing = sessions.get(id);
  const createdAt = record.createdAt || messages[0]?.timestamp || new Date().toISOString();
  const updatedAt = record.updatedAt || messages.at(-1)?.timestamp || createdAt;
  const metadata: Record<string, unknown> = {
    ...(existing?.metadata || {}),
    ...(record.metadata || {}),
    importedFromProvider: record.providerId,
    providerSessionId: record.providerSessionId,
    providerSessionIds: {
      ...(typeof existing?.metadata.providerSessionIds === 'object' && existing.metadata.providerSessionIds ? existing.metadata.providerSessionIds as Record<string, string> : {}),
      [record.providerId]: record.providerSessionId
    }
  };
  if (record.providerId === 'hermes-direct') {
    metadata.hermesSessionId = record.providerSessionId;
    metadata.hermesProfile = typeof metadata.hermesProfile === 'string' ? metadata.hermesProfile : 'default';
  }
  const session: ChatSession = {
    id,
    providerId: record.providerId,
    agent: record.agentId,
    title: record.title || record.lastMessagePreview || `${record.agentId} imported session`,
    createdAt,
    updatedAt,
    messages: messages.map((message, index) => ({
      id: message.id || `msg_import_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`,
      role: message.role,
      text: message.text,
      timestamp: message.timestamp || new Date(Date.parse(createdAt) + index).toISOString(),
      meta: { ...(message.meta || {}), importedFromProvider: record.providerId, providerSessionId: record.providerSessionId }
    })),
    metadata
  };
  if (!session.messages.length && record.lastMessagePreview) {
    session.messages.push({
      id: `msg_import_preview_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      role: 'system',
      text: `Imported provider session preview: ${record.lastMessagePreview}`,
      timestamp: updatedAt,
      meta: { importedPreviewOnly: true, importedFromProvider: record.providerId, providerSessionId: record.providerSessionId }
    });
  }
  sessions.set(session);
  return { session, created: !existing, messageCount: session.messages.length };
}

function appendMessage(session: ChatSession, role: ChatMessage['role'], text: string, meta: Record<string, unknown> = {}) {
  const message: ChatMessage = {
    id: `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`,
    role,
    text,
    timestamp: new Date().toISOString(),
    meta
  };
  session.messages.push(message);
  session.updatedAt = message.timestamp;
  sessions.touch(session);
  return message;
}

function sessionHistory(session: ChatSession): ProviderChatMessage[] {
  return session.messages.map((message) => ({ role: message.role, text: message.text, timestamp: message.timestamp }));
}

function emitChatEvent(event: ProviderChatEvent, session?: ChatSession) {
  events.emit(`chat.${event.type}`, { sessionId: session?.id, ...event.data });
}

const chatTurnQueues = new Map<string, Promise<unknown>>();

function enqueueChatTurn<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = chatTurnQueues.get(sessionId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  chatTurnQueues.set(sessionId, current);
  void current.finally(() => {
    if (chatTurnQueues.get(sessionId) === current) chatTurnQueues.delete(sessionId);
  }).catch(() => undefined);
  return current;
}

async function runChatTurn(input: { sessionId?: string; providerSessionId?: string; providerId?: string; agent?: string; message: string; mode?: 'agent' | 'roleplay'; model?: string; title?: string; metadata?: Record<string, unknown>; fileIds?: unknown }, onEvent?: (event: ProviderChatEvent) => void) {
  const session = getOrCreateSession(input);
  return enqueueChatTurn(session.id, () => executeChatTurn(session, input, onEvent));
}

function naturalProjectReference(message: string, recentProjectIds: string[] = []) {
  const normalized = message.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return { status: 'not_found' as const, projects: [] as MeshProject[] };
  const projects = memoryMesh.listProjects();
  const matched = projects.filter((project) => [project.name, ...project.aliases].some((label) => {
    const phrase = label.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!phrase) return false;
    return new RegExp(`(?:^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`, 'i').test(normalized);
  }));
  if (!matched.length) {
    const messageTokens = new Set(normalized.split(/[^a-z0-9]+/u).filter((token) => token.length > 1));
    const lexical = projects.map((project) => {
      const labels = [project.name, ...project.aliases];
      const score = Math.max(...labels.map((label) => {
        const terms = label.toLowerCase().split(/[^a-z0-9]+/u).filter((token) => token.length > 1);
        return terms.length ? terms.filter((term) => messageTokens.has(term)).length / terms.length : 0;
      }));
      return { project, score: score + (recentProjectIds.includes(project.id) ? 0.15 : 0) };
    }).filter((item) => item.score >= 0.75).sort((a, b) => b.score - a.score);
    if (lexical.length === 1 || (lexical.length > 1 && lexical[0].score - lexical[1].score >= 0.2)) return { status: 'resolved' as const, projects: lexical.map((item) => item.project), project: lexical[0].project };
    if (lexical.length > 1) return { status: 'ambiguous' as const, projects: lexical.map((item) => item.project) };
    if (/\b(?:it|that project|this project|there)\b/i.test(message)) {
      const recent = recentProjectIds.map((id) => memoryMesh.getProject(id)).filter((project): project is MeshProject => Boolean(project));
      if (recent.length) return { status: 'resolved' as const, projects: recent, project: recent[0] };
    }
    return { status: 'not_found' as const, projects: [] as MeshProject[] };
  }
  if (matched.length > 1) return { status: 'ambiguous' as const, projects: matched };
  return { status: 'resolved' as const, projects: matched, project: matched[0] };
}

function looksLikeProjectWork(message: string) {
  return /\b(?:fix|update|change|add|remove|build|implement|test|check|inspect|investigate|debug|refactor|deploy|run|work\s+on|review|repair|create|modify|finish|continue|handle|can\s+you|could\s+you|please)\b/i.test(message);
}

function currentMeshAgentId(providerId: string, providerAgentId: string) {
  return memoryMesh.listAgents().find((agent) => agent.deviceId === state.device.id && agent.providerId === providerId && agent.providerAgentId === providerAgentId)?.id;
}

async function runOriginProviderActionPlan(input: { providerId: string; providerAgentId: string; sourceAgentId: string; sourceDeviceId: string; conversationId: string; messageId: string; project: MeshProject; task: string; recentProjectIds: string[] }, onEvent?: (event: ProviderChatEvent) => void) {
  const provider = findProvider(state.snapshot().providers, input.providerId);
  if (!provider) throw new Error(`Origin provider not found: ${input.providerId}`);
  const allowedNames = new Set<ReikaMemoryToolName>(['reika.resolveProject', 'reika.getProjectContext', 'reika.findCapability', 'reika.planRoute']);
  const tools = reikaMemoryToolDefinitions.filter((definition) => allowedNames.has(definition.name));
  const executeTool = async (call: { id: string; name: string; arguments: Record<string, unknown> }) => {
    if (!allowedNames.has(call.name as ReikaMemoryToolName)) throw new Error(`Origin provider requested disallowed planning tool: ${call.name}`);
    return memoryMeshTools.execute({ id: call.id, name: call.name as ReikaMemoryToolName, arguments: call.arguments }, {
      actor: { agentId: input.sourceAgentId, deviceId: input.sourceDeviceId, isUser: false },
      sessionId: input.conversationId,
      currentAgentId: input.sourceAgentId,
      currentDeviceId: input.sourceDeviceId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      userApproved: true
    });
  };
  const basePrompt = [
    'You are the origin agent for a Reika Agent Action. Use a Reika planning tool before the task is routed.',
    `Current agent: ${input.sourceAgentId}`,
    `Current device: ${input.sourceDeviceId}`,
    `Resolved project reference: ${input.project.name}`,
    `User request: ${input.task}`,
    'Call reika.resolveProject or reika.planRoute. Do not invent projects, paths, permissions, agents, nodes, or results.'
  ].join('\n');
  const hiddenSessionId = `mesh_plan_${input.conversationId}_${input.messageId}`;
  if (provider.kind === 'openclaw' || provider.kind === 'commandcenter') {
    const result = await runProviderChat({ providerId: input.providerId, agentId: input.providerAgentId, sessionId: hiddenSessionId, message: basePrompt, tools, requireToolCall: true, executeTool }, state.snapshot().providers, onEvent);
    const toolCalls = Array.isArray(result.metadata?.toolCalls) ? result.metadata.toolCalls : [];
    if (!toolCalls.length) throw new Error(`${provider.name} returned without invoking a Reika planning tool.`);
    return { runtime: result.runtime, transport: provider.kind === 'openclaw' ? 'native-functions' : 'commandcenter-tools', toolCalls };
  }
  const manifest = tools.map((tool) => `${tool.name}: ${tool.description}`).join('\n');
  const result = await runProviderChat({
    providerId: input.providerId,
    agentId: input.providerAgentId,
    sessionId: hiddenSessionId,
    message: `${basePrompt}\n\nAvailable tools:\n${manifest}\n\nReturn only JSON in this shape: {"name":"reika.resolveProject","arguments":{"query":"${input.project.name.replace(/"/g, '\\"')}"}}`
  }, state.snapshot().providers, onEvent);
  const call = parseManifestToolCall(result.text);
  if (!call || !allowedNames.has(call.name as ReikaMemoryToolName)) throw new Error(`${provider.name} did not return a valid Reika planning tool call.`);
  const toolResult = await executeTool(call);
  onEvent?.({ type: 'tool', data: { stage: 'completed', toolCallId: call.id, name: call.name, ok: (toolResult as { ok?: unknown }).ok !== false } });
  return { runtime: result.runtime, transport: 'manifest-json', toolCalls: [{ ...call, ok: (toolResult as { ok?: unknown }).ok !== false }] };
}

function parseManifestToolCall(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || text;
  const match = fenced.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[0]) as { name?: unknown; arguments?: unknown };
    if (typeof parsed.name !== 'string') return undefined;
    return { id: crypto.randomUUID(), name: parsed.name, arguments: parsed.arguments && typeof parsed.arguments === 'object' ? parsed.arguments as Record<string, unknown> : {} };
  } catch {
    return undefined;
  }
}

function routeExplanation(task: RoutingTask) {
  const decision = task.decision;
  if (task.status === 'completed') return `${decision.agent?.displayName || 'The selected agent'} completed the task for ${decision.project?.name || 'the project'}.\n\n${task.result || 'The task completed without a text result.'}`;
  if (task.status === 'cancelled') return `The delegated task for ${decision.project?.name || 'the project'} was cancelled.`;
  if (task.status === 'failed') return `The delegated task for ${decision.project?.name || 'the project'} failed: ${task.error || 'unknown remote error'}`;
  if (task.status === 'timed_out') return `The delegated task for ${decision.project?.name || 'the project'} timed out: ${task.error || 'the remote agent did not return a result in time'}`;
  if (task.status === 'awaiting_approval') return `The routed action for ${decision.project?.name || 'the project'} is waiting for explicit approval before it is sent.`;
  if (task.status === 'unavailable') return `I could not route this task for ${decision.project?.name || 'that project'}.\n${decision.reasons.join('\n')}`;
  const details = decision.considered.flatMap((candidate) => candidate.reasons.map((reason) => `${candidate.agentId}: ${reason}`)).slice(0, 6);
  return [`I could not route this task for ${decision.project?.name || 'that project'}.`, ...decision.reasons, ...details].join('\n');
}

async function executeChatTurn(session: ChatSession, input: { sessionId?: string; providerSessionId?: string; providerId?: string; agent?: string; message: string; mode?: 'agent' | 'roleplay'; model?: string; title?: string; metadata?: Record<string, unknown>; fileIds?: unknown }, onEvent?: (event: ProviderChatEvent) => void) {
  const providers = state.snapshot().providers;
  const requestedProviderId = input.providerId || session.providerId;
  const provider = findProvider(providers, requestedProviderId);
  if (!provider) throw new Error(`Provider not found: ${requestedProviderId}`);
  if (provider.status === 'offline' || provider.status === 'error') throw new Error(`${provider.name} is ${provider.status}: ${provider.error || provider.notes}`);
  if (requestedProviderId === 'mock-local' && !settings.get().mockEnabled) throw new Error('Mock provider is disabled in Reika settings.');
  const attachedFiles = filesPayload(input.fileIds);
  const context = attachmentContext(input.fileIds);
  const userMessage = appendMessage(session, 'user', input.message, { providerId: session.providerId, agent: session.agent, files: attachedFiles });
  const handler = (event: ProviderChatEvent) => {
    emitChatEvent(event, session);
    onEvent?.(event);
  };
  try {
    const recentProjectIds = Array.isArray(session.metadata.recentProjectIds) ? session.metadata.recentProjectIds.map(String) : [];
    const projectReference = input.metadata?.skipMemoryMeshRouting === true || !looksLikeProjectWork(input.message) ? { status: 'not_found' as const, projects: [] as MeshProject[] } : naturalProjectReference(input.message, recentProjectIds);
    if (projectReference.status === 'ambiguous') {
      const candidates = projectReference.projects.map((project) => project.name);
      const lifecycle = [{ stage: 'resolving', at: new Date().toISOString() }, { stage: 'clarification_required', at: new Date().toISOString(), candidates }];
      handler({ type: 'delegation', data: { stage: 'clarification_required', candidates } });
      const text = `I found multiple matching projects: ${candidates.join(', ')}. Which one did you mean?`;
      const assistantMessage = appendMessage(session, 'assistant', text, { providerId: session.providerId, agent: session.agent, runtime: 'memory-mesh', memoryMesh: { status: 'ambiguous', lifecycle, candidates } });
      return { session, userMessage, assistantMessage, result: { providerId: session.providerId, agentId: session.agent, sessionId: session.id, runtime: 'memory-mesh' as const, text, mode: input.mode === 'roleplay' ? 'roleplay' : 'agent', model: input.model, metadata: { memoryMesh: assistantMessage.meta?.memoryMesh } } };
    }
    if (projectReference.status === 'resolved' && projectReference.project) {
      const lifecycle: Array<Record<string, unknown>> = [];
      const sourceAgentId = currentMeshAgentId(input.providerId || session.providerId, input.agent || session.agent);
      let originProviderTools: Record<string, unknown> | undefined;
      if (sourceAgentId) {
        try {
          originProviderTools = await runOriginProviderActionPlan({
            providerId: input.providerId || session.providerId,
            providerAgentId: input.agent || session.agent,
            sourceAgentId,
            sourceDeviceId: state.device.id,
            conversationId: session.id,
            messageId: userMessage.id,
            project: projectReference.project,
            task: input.message,
            recentProjectIds
          }, handler);
        } catch (error) {
          originProviderTools = { warning: error instanceof Error ? error.message : String(error), toolCalls: [] };
        }
      }
      const task = await executeMemoryMeshTask({
        projectQuery: projectReference.project.name,
        task: input.message,
        currentAgentId: sourceAgentId,
        currentDeviceId: state.device.id,
        recentProjectIds,
        originConversationId: session.id,
        originMessageId: userMessage.id,
        userApproved: true
      }, (stage, data) => {
        const item = { stage, at: new Date().toISOString(), ...data };
        lifecycle.push(item);
        handler({ type: 'delegation', data: item });
      });
      session.metadata.recentProjectIds = [projectReference.project.id, ...(Array.isArray(session.metadata.recentProjectIds) ? session.metadata.recentProjectIds.map(String) : []).filter((id) => id !== projectReference.project!.id)].slice(0, 5);
      const text = routeExplanation(task);
      const lifecycleMeta = [...task.lifecycle, ...lifecycle.filter((item) => item.stage === 'memory_updated')];
      const meshMeta = { taskId: task.id, status: task.status, projectId: task.projectId, projectName: task.decision.project?.name, targetAgentId: task.targetAgentId, targetAgentName: task.decision.agent?.displayName, targetDeviceId: task.targetDeviceId, targetDeviceName: task.decision.device?.name, executeLocally: task.decision.executeLocally, reasons: task.decision.reasons, result: task.result, error: task.error, memoryWritebackIds: task.memoryWritebackIds, originConversationId: task.originConversationId, originMessageId: task.originMessageId, originProviderTools, lifecycle: lifecycleMeta };
      const assistantMessage = appendMessage(session, 'assistant', text, { providerId: session.providerId, agent: session.agent, runtime: 'memory-mesh', memoryMesh: meshMeta });
      return { session, userMessage, assistantMessage, result: { providerId: session.providerId, agentId: session.agent, sessionId: session.id, runtime: 'memory-mesh' as const, text, mode: input.mode === 'roleplay' ? 'roleplay' : 'agent', model: input.model, metadata: { memoryMesh: meshMeta } } };
    }
    const result = await runProviderChat({
      providerId: input.providerId || session.providerId,
      agentId: input.agent || session.agent,
      sessionId: session.id,
      message: context ? `${input.message}\n\nAttached files/links:\n${context}` : input.message,
      history: sessionHistory(session).slice(0, -1),
      mode: input.mode,
      model: input.model,
      providerSessionId: typeof input.providerSessionId === 'string' && input.providerSessionId.trim()
        ? input.providerSessionId.trim()
        : typeof session.metadata.hermesSessionId === 'string'
          ? session.metadata.hermesSessionId
          : typeof session.metadata.providerSessionIds === 'object' && session.metadata.providerSessionIds
            ? (session.metadata.providerSessionIds as Record<string, string>)[input.providerId || session.providerId]
            : undefined
    }, providers, handler);
    session.providerId = result.providerId;
    session.agent = result.agentId;
    if (result.metadata?.hermesProfile) session.metadata.hermesProfile = result.metadata.hermesProfile;
    if (result.metadata?.hermesSource) session.metadata.hermesSource = result.metadata.hermesSource;
    const providerSessionIds = typeof session.metadata.providerSessionIds === 'object' && session.metadata.providerSessionIds
      ? session.metadata.providerSessionIds as Record<string, string>
      : {};
    const realProviderSessionId = typeof result.metadata?.providerSessionId === 'string' ? result.metadata.providerSessionId.trim() : '';
    if (realProviderSessionId) providerSessionIds[result.providerId] = realProviderSessionId;
    session.metadata.providerSessionIds = providerSessionIds;
    if (result.runtime === 'hermes' && typeof result.metadata?.hermesSessionId === 'string' && result.metadata.hermesSessionId.trim()) {
      session.metadata.hermesSessionId = result.metadata.hermesSessionId.trim();
    }
    const assistantMessage = appendMessage(session, 'assistant', result.text, { providerId: result.providerId, agent: result.agentId, runtime: result.runtime, files: [] });
    addNotification({
      kind: 'chat',
      title: `${result.runtime === 'mock' ? 'Mock' : result.agentId} replied`,
      body: result.text.slice(0, 160) || 'A chat response completed.',
      source: result.providerId,
      tone: result.runtime === 'mock' ? 'gray' : 'blue',
      data: { sessionId: session.id, providerId: result.providerId, agent: result.agentId }
    });
    return { session, userMessage, assistantMessage, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    handler({ type: 'error', data: { providerId: session.providerId, agent: session.agent, error: message } });
    throw error;
  }
}

function memoryActor(req: http.IncomingMessage): MemoryAccessContext {
  const agentHeader = req.headers['x-reika-agent-id'];
  const deviceHeader = req.headers['x-reika-device-id'];
  const agentId = Array.isArray(agentHeader) ? agentHeader[0] : agentHeader;
  const deviceId = Array.isArray(deviceHeader) ? deviceHeader[0] : deviceHeader;
  return agentId ? { agentId, deviceId, isUser: false } : { isUser: true };
}

function compactTaskContext(decision: RouteDecision, task: string) {
  if (!decision.project || !decision.agent || !decision.device) return { prompt: task, memoryIds: [] as string[] };
  const actor = { agentId: decision.agent.id, deviceId: decision.device.id, isUser: false };
  const memories = memoryMesh.getRelevantMemories({
    task,
    projectId: decision.project.id,
    agentId: decision.agent.id,
    deviceId: decision.device.id,
    limit: 8
  }, actor);
  const contextLines = memories.map((memory) => `- [${memory.scope}; source=${memory.source}] ${memory.content.slice(0, 600)}`);
  return { prompt: [
    `Project: ${decision.project.name}`,
    decision.localPath ? `Authoritative device-scoped project checkout: ${decision.localPath}` : '',
    decision.localPath ? 'Use that exact checkout when it exists. Do not substitute a similarly named workspace or stale clone. If it is missing, report the mismatch before touching another path.' : '',
    `Task: ${task}`,
    contextLines.length ? `Relevant Memory Mesh context:\n${contextLines.join('\n')}` : '',
    'For service checks, inspect the running process and both system and user service scopes before declaring a service inactive.',
    'If the task restarts the Reika relay or node carrying this action, preserve the dedicated provider session so Reika can recover the result after reconnect.',
    'Return a concise result describing the work, verification, and any blockers. Do not assume paths from another device are valid.'
  ].filter(Boolean).join('\n\n'), memoryIds: memories.map((memory) => memory.id) };
}

async function relaySocketText(data: unknown) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (data && typeof data === 'object' && 'text' in data && typeof (data as { text?: unknown }).text === 'function') return (data as { text: () => Promise<string> }).text();
  return String(data);
}

function relayAppUrl(relayDeviceUrl: string) {
  const url = new URL(relayDeviceUrl);
  url.pathname = url.pathname.replace(/\/device\/?$/u, '/app');
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function sendRemoteMemoryMeshTask(decision: RouteDecision, message: string, taskId: string, timeoutMs = 120_000, signal?: AbortSignal) {
  if (!decision.device || !decision.agent || !decision.providerId) throw new Error('Route decision is incomplete.');
  const sessionId = `mesh_${taskId}`;
  const providerSessionId = `memory_mesh_${taskId.replace(/[^a-zA-Z0-9_-]+/g, '_')}`;
  const request = {
    ...createEnvelope({
    type: 'agent.chat.request',
    source: { kind: 'app', id: 'reika-memory-mesh' },
    target: { kind: 'device', id: decision.device.id },
    deviceId: decision.device.id,
    payload: {
      providerId: decision.providerId,
      agent: decision.agent.providerAgentId,
      sessionId,
      providerSessionId,
      message,
      delivery: { idempotencyKey: crypto.randomUUID(), statusMetadataVersion: 1 as const }
    }
    }),
    id: `memory-mesh-task-${taskId}`
  };
  const relayUrl = relayAppUrl(decision.agent.relayEndpoint || settings.get().relayUrl);
  return new Promise<{ text: string; sessionId?: string }>((resolve, reject) => {
    let settled = false;
    let socket: WebSocket | undefined;
    let initialRequestSent = false;
    let reconnectDelayMs = 500;
    let reconnectTimer: NodeJS.Timeout | undefined;
    let pollTimer: NodeJS.Timeout | undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollTimer) clearInterval(pollTimer);
      signal?.removeEventListener('abort', abort);
      try { socket?.close(); } catch { /* Socket may still be connecting. */ }
      callback();
    };
    const abort = () => finish(() => reject(new Error('Memory Mesh task was cancelled.')));
    const timer = setTimeout(() => finish(() => reject(new Error('Memory Mesh relay task timed out.'))), timeoutMs);
    const sendStatusRequest = () => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify(createEnvelope({
        type: 'command.status.request',
        source: { kind: 'app', id: 'reika-memory-mesh' },
        target: { kind: 'device', id: decision.device!.id },
        deviceId: decision.device!.id,
        payload: { requestId: request.id, sessionId }
      })));
    };
    const scheduleReconnect = () => {
      if (settled || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, 5_000);
    };
    const connect = () => {
      if (settled) return;
      const next = new WebSocket(relayUrl);
      socket = next;
      next.addEventListener('open', () => {
        reconnectDelayMs = 500;
        if (!initialRequestSent) {
          next.send(JSON.stringify(request));
          initialRequestSent = true;
        } else {
          sendStatusRequest();
        }
        if (!pollTimer) pollTimer = setInterval(sendStatusRequest, 15_000);
      });
      next.addEventListener('message', (event) => void (async () => {
        try {
          const envelope = JSON.parse(await relaySocketText(event.data)) as { type?: string; replyTo?: string; correlationId?: string; payload?: Record<string, unknown> };
          if (envelope.replyTo !== request.id && envelope.correlationId !== request.id) return;
          if (envelope.type === 'agent.chat.response') {
            finish(() => resolve({ text: String(envelope.payload?.text || ''), sessionId: String(envelope.payload?.sessionId || '') || undefined }));
          } else if (envelope.type === 'command.rejected' || envelope.type === 'command.failed') {
            finish(() => reject(new Error(String(envelope.payload?.message || 'Memory Mesh relay task failed.'))));
          }
        } catch {
          // Ignore unrelated relay broadcasts and malformed messages.
        }
      })());
      next.addEventListener('error', () => {
        if (socket === next) socket = undefined;
        try { next.close(); } catch { /* A connecting WebSocket can reject close(). */ }
        scheduleReconnect();
      });
      next.addEventListener('close', () => {
        if (socket === next) socket = undefined;
        scheduleReconnect();
      });
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    connect();
  });
}

const activeMemoryMeshTasks = new Map<string, AbortController>();

interface MemoryMeshTaskInput {
  projectQuery: string;
  task: string;
  requiredCapabilities?: string[];
  currentAgentId?: string;
  currentDeviceId?: string;
  recentProjectIds?: string[];
  originConversationId?: string;
  originMessageId?: string;
  userApproved?: boolean;
}

async function executeMemoryMeshTask(input: MemoryMeshTaskInput, onLifecycle?: (stage: string, data: Record<string, unknown>) => void) {
  const currentDeviceId = input.currentDeviceId || state.device.id;
  onLifecycle?.('resolving', { projectQuery: input.projectQuery });
  const decision = memoryMesh.routeTask({ ...input, currentDeviceId });
  onLifecycle?.('planning', { decision });
  const task = memoryMesh.createRoutingTask({
    request: input.task,
    requiredCapabilities: input.requiredCapabilities,
    sourceAgentId: input.currentAgentId,
    sourceDeviceId: currentDeviceId,
    originConversationId: input.originConversationId,
    originMessageId: input.originMessageId,
    decision
  });
  if (decision.status !== 'selected' || !decision.agent || !decision.device || !decision.project) return task;
  if (task.status === 'awaiting_approval' && !input.userApproved) {
    onLifecycle?.('awaiting_approval', { taskId: task.id, reason: decision.approvalReason });
    return task;
  }
  if (task.status === 'awaiting_approval') memoryMesh.updateRoutingTask(task.id, { status: 'queued', progress: 'Approved by the originating user request.' });
  return runPersistedMemoryMeshTask(task.id, onLifecycle);
}

async function runPersistedMemoryMeshTask(taskId: string, onLifecycle?: (stage: string, data: Record<string, unknown>) => void) {
  const task = memoryMesh.getRoutingTask(taskId);
  if (!task) throw new Error(`Routing task not found: ${taskId}`);
  const decision = task.decision;
  if (decision.status !== 'selected' || !decision.agent || !decision.device || !decision.project) return task;
  const controller = new AbortController();
  activeMemoryMeshTasks.set(task.id, controller);
  memoryMesh.updateRoutingTask(task.id, { status: 'sent', progress: decision.executeLocally ? 'Dispatching to the selected local provider.' : 'Sending through the Project Reika relay.' });
  onLifecycle?.('sent', { taskId: task.id, agent: decision.agent, device: decision.device, executeLocally: decision.executeLocally, reasons: decision.reasons });
  try {
    const context = compactTaskContext(decision, task.request);
    memoryMesh.updateRoutingTask(task.id, { status: 'accepted', progress: `${decision.agent.displayName} accepted the routed task.`, sharedContextRefs: context.memoryIds });
    onLifecycle?.('accepted', { taskId: task.id, targetAgentId: decision.agent.id, targetDeviceId: decision.device.id });
    if (controller.signal.aborted || memoryMesh.getRoutingTask(task.id)?.status === 'cancelled') return memoryMesh.getRoutingTask(task.id)!;
    memoryMesh.updateRoutingTask(task.id, { status: 'working', progress: `${decision.agent.displayName} is working on ${decision.project.name}.` });
    onLifecycle?.('working', { taskId: task.id, targetAgentId: decision.agent.id, targetDeviceId: decision.device.id });
    let result: string;
    if (decision.executeLocally) {
      const turn = await runChatTurn({
        sessionId: `mesh_${task.id}`,
        providerId: decision.providerId,
        agent: decision.agent.providerAgentId,
        message: context.prompt,
        title: `${decision.project.name}: routed task`,
        metadata: { memoryMeshTaskId: task.id, projectId: decision.project.id, skipMemoryMeshRouting: true }
      });
      result = turn.result.text;
    } else {
      result = (await sendRemoteMemoryMeshTask(decision, context.prompt, task.id, 600_000, controller.signal)).text;
    }
    if (controller.signal.aborted || memoryMesh.getRoutingTask(task.id)?.status === 'cancelled') return memoryMesh.getRoutingTask(task.id)!;
    const writeback = memoryMesh.addMemory({
      content: `Task: ${task.request}\nVerified result: ${result}`,
      scope: 'project',
      projectId: decision.project.id,
      createdBy: decision.agent.id,
      source: `routing-task:${task.id}`,
      tags: ['routed-task', 'completed'],
      confidence: 0.9,
      importance: 0.7,
      permissions: { visibility: 'project', access: 'read_write' },
      provenance: { sourceConversationId: task.originConversationId, sourceMessageId: task.originMessageId, sourceTaskId: task.id, sourceAgentId: decision.agent.id, sourceDeviceId: decision.device.id, verifiedAt: new Date().toISOString() }
    }, { isUser: true });
    const completed = memoryMesh.updateRoutingTask(task.id, { status: 'completed', result, progress: 'Correlated result returned and durable project memory written.', memoryWritebackIds: [writeback.id] })!;
    onLifecycle?.('memory_updated', { taskId: task.id, projectId: decision.project.id, memoryId: writeback.id });
    onLifecycle?.('completed', { taskId: task.id, result });
    return completed;
  } catch (error) {
    const cancelled = controller.signal.aborted || memoryMesh.getRoutingTask(task.id)?.status === 'cancelled';
    const timedOut = error instanceof Error && /timed out/i.test(error.message);
    const failed = cancelled
      ? memoryMesh.updateRoutingTask(task.id, { status: 'cancelled', error: 'Cancelled by request.' })!
      : memoryMesh.updateRoutingTask(task.id, { status: timedOut ? 'timed_out' : 'failed', error: error instanceof Error ? error.message : String(error) })!;
    onLifecycle?.(cancelled ? 'cancelled' : timedOut ? 'timed_out' : 'failed', { taskId: task.id, error: failed.error });
    return failed;
  } finally {
    activeMemoryMeshTasks.delete(task.id);
  }
}

async function resumeInterruptedMemoryMeshTasks() {
  const interrupted = memoryMesh.listRoutingTasks(200)
    .filter((task) => task.status === 'queued' && task.progress === 'Queued for restart recovery.');
  for (const task of interrupted) {
    try {
      const recovered = await runPersistedMemoryMeshTask(task.id);
      if (!recovered.originConversationId) continue;
      const session = sessions.get(recovered.originConversationId);
      if (!session || session.messages.some((message) => {
        const meta = message.meta?.memoryMesh;
        return Boolean(meta && typeof meta === 'object' && (meta as { taskId?: unknown }).taskId === recovered.id);
      })) continue;
      appendMessage(session, 'assistant', routeExplanation(recovered), {
        providerId: session.providerId,
        agent: session.agent,
        runtime: 'memory-mesh',
        memoryMesh: {
          taskId: recovered.id,
          status: recovered.status,
          projectId: recovered.projectId,
          targetAgentId: recovered.targetAgentId,
          targetDeviceId: recovered.targetDeviceId,
          result: recovered.result,
          error: recovered.error,
          memoryWritebackIds: recovered.memoryWritebackIds,
          lifecycle: recovered.lifecycle,
          recoveredAfterSourceRestart: true
        }
      });
    } catch (error) {
      console.error(`Could not resume Memory Mesh task ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function approveMemoryMeshTask(taskId: string) {
  const task = memoryMesh.getRoutingTask(taskId);
  if (!task) return undefined;
  if (task.status !== 'awaiting_approval') return task;
  memoryMesh.updateRoutingTask(task.id, { status: 'queued', progress: 'Approved by the user.' });
  return runPersistedMemoryMeshTask(task.id);
}

function cancelMemoryMeshTask(taskId: string) {
  activeMemoryMeshTasks.get(taskId)?.abort();
  return memoryMesh.cancelRoutingTask(taskId);
}

const memoryMeshTools = new ReikaMemoryToolRuntime(memoryMesh, { delegateTask: executeMemoryMeshTask, cancelTask: cancelMemoryMeshTask, approveTask: approveMemoryMeshTask });

function writeSse(res: http.ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function providerTone(kind: string) {
  if (kind === 'commandcenter') return 'blue';
  if (kind === 'openclaw') return 'purple';
  if (kind === 'hermes') return 'green';
  if (kind === 'mock') return 'gray';
  return 'blue';
}

async function artPayload(extra: Record<string, unknown> = {}) {
  return { ok: true, storage: art.snapshot(), oauth: await art.oauthStatus(), profiles: art.list(), ...extra };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${serverConfig.host}:${serverConfig.port}`}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, service: serverConfig.serviceName, status: 'ready', settings: settings.snapshot(), notifications: notifications.snapshot(), art: art.snapshot(), uplink: relayClient.snapshot() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      const html = pairingPage(state.device, relayClient.snapshot(), await getStartupStatus());
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/memory-mesh/overview') {
      sendJson(res, 200, {
        ok: true,
        storage: memoryMesh.snapshot(),
        agents: memoryMesh.listAgents(),
        devices: memoryMesh.listDevices(),
        projects: memoryMesh.listProjects(),
        memories: memoryMesh.searchMemory({ limit: 40 }, memoryActor(req)),
        routingTasks: memoryMesh.listRoutingTasks(40)
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/memory-mesh/discovery/sync') {
      const discovery = await syncMemoryMeshDiscovery();
      sendJson(res, 200, { ok: true, discovery, storage: memoryMesh.snapshot() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/memory-mesh/tools') {
      const format = url.searchParams.get('format') || 'canonical';
      const tools = format === 'openai'
        ? toOpenAiToolSchemas()
        : format === 'commandcenter'
          ? toCommandCenterToolSchemas()
          : format === 'hermes'
            ? toHermesToolManifest()
            : reikaMemoryToolDefinitions;
      sendJson(res, 200, { ok: true, format, tools });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/memory-mesh/tools/execute') {
      const body = await readJson(req);
      const name = String(body.name || '') as ReikaMemoryToolName;
      if (!reikaMemoryToolDefinitions.some((definition) => definition.name === name)) {
        sendJson(res, 400, { ok: false, error: `Unknown Memory Mesh tool: ${name || '(missing)'}` });
        return;
      }
      const actor = memoryActor(req);
      if (actor.isUser) {
        sendJson(res, 401, { ok: false, error: 'Direct Memory Mesh tool execution requires a registered Reika agent identity. User approvals must come through chat or task approval endpoints.' });
        return;
      }
      const result = await memoryMeshTools.execute(createReikaToolCall(name, body.arguments && typeof body.arguments === 'object' ? body.arguments as Record<string, unknown> : {}), {
        actor,
        sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
        currentAgentId: actor.agentId,
        currentDeviceId: actor.deviceId || state.device.id,
        conversationId: typeof body.conversationId === 'string' ? body.conversationId : undefined,
        messageId: typeof body.messageId === 'string' ? body.messageId : undefined,
        userApproved: actor.isUser && body.userApproved === true
      });
      sendJson(res, result.ok ? 200 : 403, result);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/memory-mesh/agents') {
      sendJson(res, 200, { ok: true, agents: memoryMesh.listAgents() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/memory-mesh/agents') {
      const body = await readJson(req);
      const agent = memoryMesh.registerAgent(body as unknown as Partial<MeshAgent> & Pick<MeshAgent, 'id' | 'displayName'>);
      sendJson(res, 201, { ok: true, agent });
      return;
    }

    const meshAgentMatch = url.pathname.match(/^\/memory-mesh\/agents\/([^/]+)$/u);
    if (req.method === 'PATCH' && meshAgentMatch) {
      const id = decodeURIComponent(meshAgentMatch[1]);
      const current = memoryMesh.getAgent(id);
      if (!current) { sendJson(res, 404, { ok: false, error: 'Memory Mesh agent not found.' }); return; }
      const body = await readJson(req);
      const agent = memoryMesh.registerAgent({ ...current, ...body, id, displayName: String(body.displayName || current.displayName) });
      sendJson(res, 200, { ok: true, agent });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/memory-mesh/devices') {
      sendJson(res, 200, { ok: true, devices: memoryMesh.listDevices() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/memory-mesh/devices') {
      const body = await readJson(req);
      const device = memoryMesh.registerDevice(body as unknown as Partial<MeshDevice> & Pick<MeshDevice, 'id' | 'name'>);
      sendJson(res, 201, { ok: true, device });
      return;
    }

    const meshDeviceMatch = url.pathname.match(/^\/memory-mesh\/devices\/([^/]+)$/u);
    if (req.method === 'PATCH' && meshDeviceMatch) {
      const id = decodeURIComponent(meshDeviceMatch[1]);
      const current = memoryMesh.getDevice(id);
      if (!current) { sendJson(res, 404, { ok: false, error: 'Memory Mesh device not found.' }); return; }
      const body = await readJson(req);
      const device = memoryMesh.registerDevice({ ...current, ...body, id, name: String(body.name || current.name) });
      sendJson(res, 200, { ok: true, device });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/memory-mesh/projects') {
      sendJson(res, 200, { ok: true, projects: memoryMesh.listProjects() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/memory-mesh/projects') {
      const body = await readJson(req);
      const project = memoryMesh.createProject(body as unknown as Partial<MeshProject> & Pick<MeshProject, 'name'>);
      sendJson(res, 201, { ok: true, project });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/memory-mesh/projects/resolve') {
      const resolution = memoryMesh.resolveProject(url.searchParams.get('q') || '', {
        agentId: url.searchParams.get('agentId') || undefined,
        recentProjectIds: (url.searchParams.get('recentProjectIds') || '').split(',').filter(Boolean)
      });
      sendJson(res, resolution.status === 'not_found' ? 404 : resolution.status === 'ambiguous' ? 409 : 200, { ok: resolution.status === 'resolved', resolution });
      return;
    }

    const meshProjectMatch = url.pathname.match(/^\/memory-mesh\/projects\/([^/]+)$/u);
    if (req.method === 'PATCH' && meshProjectMatch) {
      const id = decodeURIComponent(meshProjectMatch[1]);
      const body = await readJson(req);
      const project = memoryMesh.updateProject(id, body as Partial<MeshProject>);
      if (!project) { sendJson(res, 404, { ok: false, error: 'Memory Mesh project not found.' }); return; }
      sendJson(res, 200, { ok: true, project });
      return;
    }

    if (req.method === 'DELETE' && meshProjectMatch) {
      const deleted = memoryMesh.deleteProject(decodeURIComponent(meshProjectMatch[1]));
      sendJson(res, deleted ? 200 : 404, { ok: deleted });
      return;
    }

    const meshProjectAgentsMatch = url.pathname.match(/^\/memory-mesh\/projects\/([^/]+)\/agents$/u);
    if (req.method === 'POST' && meshProjectAgentsMatch) {
      const body = await readJson(req);
      const project = memoryMesh.assignAgentToProject(decodeURIComponent(meshProjectAgentsMatch[1]), String(body.agentId || ''), {
        role: body.role === 'primary' ? 'primary' : 'collaborator',
        access: body.access === 'read_only' ? 'read_only' : 'read_write'
      });
      sendJson(res, 200, { ok: true, project });
      return;
    }

    const meshProjectAgentMatch = url.pathname.match(/^\/memory-mesh\/projects\/([^/]+)\/agents\/([^/]+)$/u);
    if (req.method === 'DELETE' && meshProjectAgentMatch) {
      const project = memoryMesh.unassignAgentFromProject(decodeURIComponent(meshProjectAgentMatch[1]), decodeURIComponent(meshProjectAgentMatch[2]));
      sendJson(res, project ? 200 : 404, { ok: Boolean(project), project });
      return;
    }

    const meshProjectDevicesMatch = url.pathname.match(/^\/memory-mesh\/projects\/([^/]+)\/devices$/u);
    if (req.method === 'POST' && meshProjectDevicesMatch) {
      const body = await readJson(req);
      const project = memoryMesh.assignDeviceToProject(decodeURIComponent(meshProjectDevicesMatch[1]), String(body.deviceId || ''), {
        isPrimary: body.isPrimary === true,
        path: typeof body.path === 'string' ? body.path : undefined
      });
      sendJson(res, 200, { ok: true, project });
      return;
    }

    const meshProjectDeviceMatch = url.pathname.match(/^\/memory-mesh\/projects\/([^/]+)\/devices\/([^/]+)$/u);
    if (req.method === 'DELETE' && meshProjectDeviceMatch) {
      const project = memoryMesh.unassignDeviceFromProject(decodeURIComponent(meshProjectDeviceMatch[1]), decodeURIComponent(meshProjectDeviceMatch[2]));
      sendJson(res, project ? 200 : 404, { ok: Boolean(project), project });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/memory-mesh/memories') {
      const memories = memoryMesh.searchMemory({
        q: url.searchParams.get('q') || undefined,
        scope: (url.searchParams.get('scope') || undefined) as MemoryRecord['scope'] | undefined,
        projectId: url.searchParams.get('projectId') || undefined,
        agentId: url.searchParams.get('agentId') || undefined,
        deviceId: url.searchParams.get('deviceId') || undefined,
        sessionId: url.searchParams.get('sessionId') || undefined,
        tags: (url.searchParams.get('tags') || '').split(',').filter(Boolean),
        limit: Number(url.searchParams.get('limit') || 50)
      }, memoryActor(req));
      sendJson(res, 200, { ok: true, memories });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/memory-mesh/memories') {
      const body = await readJson(req);
      const actor = memoryActor(req);
      const memory = memoryMesh.addMemory(body as unknown as Partial<MemoryRecord> & Pick<MemoryRecord, 'content' | 'scope' | 'createdBy' | 'source'>, actor);
      sendJson(res, 201, { ok: true, memory });
      return;
    }

    const meshMemoryMatch = url.pathname.match(/^\/memory-mesh\/memories\/([^/]+)$/u);
    if (req.method === 'PATCH' && meshMemoryMatch) {
      const body = await readJson(req);
      const memory = memoryMesh.updateMemory(decodeURIComponent(meshMemoryMatch[1]), body as Partial<MemoryRecord>, memoryActor(req));
      if (!memory) { sendJson(res, 404, { ok: false, error: 'Memory not found or not visible to this actor.' }); return; }
      sendJson(res, 200, { ok: true, memory });
      return;
    }

    if (req.method === 'DELETE' && meshMemoryMatch) {
      const deleted = memoryMesh.deleteMemory(decodeURIComponent(meshMemoryMatch[1]), memoryActor(req));
      sendJson(res, deleted ? 200 : 404, { ok: deleted });
      return;
    }

    const promoteMemoryMatch = url.pathname.match(/^\/memory-mesh\/memories\/([^/]+)\/promote$/u);
    if (req.method === 'POST' && promoteMemoryMatch) {
      const body = await readJson(req);
      const memory = memoryMesh.promoteSessionMemory(decodeURIComponent(promoteMemoryMatch[1]), body as { scope: Exclude<MemoryRecord['scope'], 'session'>; agentId?: string; projectId?: string; deviceId?: string }, memoryActor(req));
      if (!memory) { sendJson(res, 404, { ok: false, error: 'Session memory not found or not visible.' }); return; }
      sendJson(res, 200, { ok: true, memory });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/memory-mesh/routing/preview') {
      const body = await readJson(req);
      const decision = memoryMesh.routeTask({
        projectQuery: String(body.projectQuery || ''),
        task: String(body.task || ''),
        requiredCapabilities: Array.isArray(body.requiredCapabilities) ? body.requiredCapabilities.map(String) : [],
        currentAgentId: typeof body.currentAgentId === 'string' ? body.currentAgentId : undefined,
        currentDeviceId: typeof body.currentDeviceId === 'string' ? body.currentDeviceId : state.device.id,
        recentProjectIds: Array.isArray(body.recentProjectIds) ? body.recentProjectIds.map(String) : []
      });
      sendJson(res, 200, { ok: true, routable: decision.status === 'selected', decision });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/memory-mesh/tasks') {
      sendJson(res, 200, { ok: true, tasks: memoryMesh.listRoutingTasks(Number(url.searchParams.get('limit') || 50)) });
      return;
    }

    const meshTaskMatch = url.pathname.match(/^\/memory-mesh\/tasks\/([^/]+)$/u);
    if (req.method === 'GET' && meshTaskMatch) {
      const task = memoryMesh.getRoutingTask(decodeURIComponent(meshTaskMatch[1]));
      sendJson(res, task ? 200 : 404, { ok: Boolean(task), task });
      return;
    }

    const meshTaskCancelMatch = url.pathname.match(/^\/memory-mesh\/tasks\/([^/]+)\/cancel$/u);
    if (req.method === 'POST' && meshTaskCancelMatch) {
      const task = cancelMemoryMeshTask(decodeURIComponent(meshTaskCancelMatch[1]));
      sendJson(res, task ? 200 : 404, { ok: Boolean(task), task });
      return;
    }

    const meshTaskApproveMatch = url.pathname.match(/^\/memory-mesh\/tasks\/([^/]+)\/approve$/u);
    if (req.method === 'POST' && meshTaskApproveMatch) {
      const task = await approveMemoryMeshTask(decodeURIComponent(meshTaskApproveMatch[1]));
      sendJson(res, task ? 200 : 404, { ok: Boolean(task), task });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/memory-mesh/tasks') {
      const body = await readJson(req);
      const task = await executeMemoryMeshTask({
        projectQuery: String(body.projectQuery || ''),
        task: String(body.task || ''),
        requiredCapabilities: Array.isArray(body.requiredCapabilities) ? body.requiredCapabilities.map(String) : [],
        currentAgentId: typeof body.currentAgentId === 'string' ? body.currentAgentId : undefined,
        currentDeviceId: typeof body.currentDeviceId === 'string' ? body.currentDeviceId : undefined,
        recentProjectIds: Array.isArray(body.recentProjectIds) ? body.recentProjectIds.map(String) : []
      });
      sendJson(res, 200, { ok: true, executed: task.status === 'completed', task });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/art') {
      sendJson(res, 200, await artPayload());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/art/oauth/status') {
      sendJson(res, 200, { ok: true, oauth: await art.oauthStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/art/oauth/connect') {
      const body = await readJson(req);
      const oauth = await art.connectImageAuth({ apiKey: body.apiKey });
      addNotification({
        kind: 'system',
        title: 'Image generation connected',
        body: oauth.message,
        source: 'art-studio',
        tone: 'green',
        data: { oauth: { provider: oauth.provider, source: oauth.source, connected: oauth.connected } }
      });
      sendJson(res, 200, { ok: true, oauth, message: oauth.message });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/art/oauth/disconnect') {
      const oauth = await art.disconnectImageAuth();
      addNotification({
        kind: 'system',
        title: 'Saved image key cleared',
        body: oauth.connected ? `Saved key cleared. ${oauth.message}` : 'Saved local OpenAI API key was cleared.',
        source: 'art-studio',
        tone: oauth.connected ? 'blue' : 'orange',
        data: { oauth: { provider: oauth.provider, source: oauth.source, connected: oauth.connected } }
      });
      sendJson(res, 200, { ok: true, oauth, message: oauth.connected ? oauth.message : 'Saved local OpenAI API key was cleared.' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/art/profiles') {
      const body = await readJson(req);
      const profile = art.createProfile({ name: body.name, subtitle: body.subtitle, scope: body.scope });
      addNotification({
        kind: 'system',
        title: 'Art profile created',
        body: `${profile.name} now has a Reika art profile.`,
        source: 'art-studio',
        tone: 'blue',
        data: { profileId: profile.id }
      });
      sendJson(res, 200, await artPayload({ profile }));
      return;
    }

    const artDuplicateMatch = url.pathname.match(/^\/art\/profiles\/([^/]+)\/duplicate$/);
    if (req.method === 'POST' && artDuplicateMatch) {
      const profile = art.duplicateProfile(decodeURIComponent(artDuplicateMatch[1] || ''));
      addNotification({
        kind: 'system',
        title: 'Art profile duplicated',
        body: `${profile.name} was created from an existing art profile.`,
        source: 'art-studio',
        tone: 'purple',
        data: { profileId: profile.id }
      });
      sendJson(res, 200, await artPayload({ profile }));
      return;
    }

    const artProfileDeleteMatch = url.pathname.match(/^\/art\/profiles\/([^/]+)$/);
    if (req.method === 'DELETE' && artProfileDeleteMatch) {
      const profile = art.deleteProfile(decodeURIComponent(artProfileDeleteMatch[1] || ''));
      addNotification({
        kind: 'warning',
        title: 'Art profile deleted',
        body: `${profile.name} was removed from Agent Art Studio.`,
        source: 'art-studio',
        tone: 'orange',
        data: { profileId: profile.id }
      });
      sendJson(res, 200, await artPayload({ profile }));
      return;
    }

    const artCategoryCreateMatch = url.pathname.match(/^\/art\/profiles\/([^/]+)\/categories$/);
    if (req.method === 'POST' && artCategoryCreateMatch) {
      const body = await readJson(req);
      const profileId = decodeURIComponent(artCategoryCreateMatch[1] || '');
      const category = art.addCategory(profileId, { name: body.name });
      sendJson(res, 200, await artPayload({ category }));
      return;
    }

    const artCategoryMatch = url.pathname.match(/^\/art\/profiles\/([^/]+)\/categories\/([^/]+)$/);
    if (req.method === 'PATCH' && artCategoryMatch) {
      const body = await readJson(req);
      const category = art.updateCategory(decodeURIComponent(artCategoryMatch[1] || ''), decodeURIComponent(artCategoryMatch[2] || ''), {
        selectionMode: body.selectionMode === 'single' || body.selectionMode === 'random' ? body.selectionMode : undefined,
        selectedAssetId: typeof body.selectedAssetId === 'string' ? body.selectedAssetId : undefined,
        prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
        systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
        referenceAssetIds: Array.isArray(body.referenceAssetIds) ? body.referenceAssetIds.filter((item): item is string => typeof item === 'string') : undefined
      });
      sendJson(res, 200, await artPayload({ category }));
      return;
    }

    if (req.method === 'DELETE' && artCategoryMatch) {
      const category = art.deleteCategory(decodeURIComponent(artCategoryMatch[1] || ''), decodeURIComponent(artCategoryMatch[2] || ''));
      addNotification({
        kind: 'warning',
        title: 'Art category deleted',
        body: `${category.name} was removed from Agent Art Studio.`,
        source: 'art-studio',
        tone: 'orange',
        data: { categoryId: category.id }
      });
      sendJson(res, 200, await artPayload({ category }));
      return;
    }

    const artAssetUploadMatch = url.pathname.match(/^\/art\/profiles\/([^/]+)\/categories\/([^/]+)\/assets\/upload$/);
    if (req.method === 'POST' && artAssetUploadMatch) {
      const body = await readJson(req);
      const assetRecord = await art.addUploadedAsset(decodeURIComponent(artAssetUploadMatch[1] || ''), decodeURIComponent(artAssetUploadMatch[2] || ''), {
        name: body.name,
        mimeType: body.mimeType,
        base64: body.base64,
        prompt: body.prompt
      });
      addNotification({
        kind: 'file',
        title: 'Art uploaded',
        body: `${assetRecord.name} was added to Agent Art Studio.`,
        source: 'art-studio',
        tone: 'purple',
        data: { assetId: assetRecord.id }
      });
      sendJson(res, 200, await artPayload({ asset: assetRecord }));
      return;
    }

    const artAssetLinkMatch = url.pathname.match(/^\/art\/profiles\/([^/]+)\/categories\/([^/]+)\/assets\/link$/);
    if (req.method === 'POST' && artAssetLinkMatch) {
      const body = await readJson(req);
      const assetRecord = art.addLinkedAsset(decodeURIComponent(artAssetLinkMatch[1] || ''), decodeURIComponent(artAssetLinkMatch[2] || ''), {
        name: body.name,
        url: body.url,
        prompt: body.prompt
      });
      sendJson(res, 200, await artPayload({ asset: assetRecord }));
      return;
    }

    const artGenerateMatch = url.pathname.match(/^\/art\/profiles\/([^/]+)\/categories\/([^/]+)\/generate$/);
    if (req.method === 'POST' && artGenerateMatch) {
      const generation = await art.requestGeneration(decodeURIComponent(artGenerateMatch[1] || ''), decodeURIComponent(artGenerateMatch[2] || ''));
      if (generation.status === 'completed') {
        addNotification({
          kind: 'file',
          title: 'Art generated',
          body: generation.message,
          source: 'art-studio',
          tone: 'green',
          data: { generation }
        });
      } else {
        addNotification({
          kind: 'warning',
          title: generation.status === 'blocked' ? 'Image generation needs auth' : 'Image generation failed',
          body: generation.message,
          source: 'art-studio',
          tone: 'orange',
          data: { generation }
        });
      }
      sendJson(res, 200, await artPayload({ generation }));
      return;
    }

    const artAssetDeleteMatch = url.pathname.match(/^\/art\/profiles\/([^/]+)\/categories\/([^/]+)\/assets\/([^/]+)$/);
    if (req.method === 'PATCH' && artAssetDeleteMatch) {
      const body = await readJson(req);
      const assetRecord = art.updateAsset(
        decodeURIComponent(artAssetDeleteMatch[1] || ''),
        decodeURIComponent(artAssetDeleteMatch[2] || ''),
        decodeURIComponent(artAssetDeleteMatch[3] || ''),
        { placement: Object.prototype.hasOwnProperty.call(body, 'placement') ? body.placement : undefined }
      );
      sendJson(res, 200, await artPayload({ asset: assetRecord }));
      return;
    }

    if (req.method === 'DELETE' && artAssetDeleteMatch) {
      const assetRecord = await art.deleteAsset(decodeURIComponent(artAssetDeleteMatch[1] || ''), decodeURIComponent(artAssetDeleteMatch[2] || ''), decodeURIComponent(artAssetDeleteMatch[3] || ''));
      sendJson(res, 200, await artPayload({ asset: assetRecord }));
      return;
    }

    const artContentMatch = url.pathname.match(/^\/art\/assets\/([^/]+)\/content$/);
    if (req.method === 'GET' && artContentMatch) {
      const content = art.resolveAssetContent(decodeURIComponent(artContentMatch[1] || ''));
      if (!content) {
        sendJson(res, 404, { ok: false, error: 'Art asset content not found', code: 'ART_ASSET_NOT_FOUND' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': content.mimeType,
        'Content-Disposition': `inline; filename="${content.name.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store'
      });
      content.stream.pipe(res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/providers/refresh') {
      await state.refreshProviders({ mockEnabled: settings.get().mockEnabled });
      events.emit('provider.state', state.snapshot().providers);
      const snapshot = state.snapshot();
      const activeProvider = snapshot.providers.find((provider) => provider.id === snapshot.activeProviderId);
      addNotification({
        kind: activeProvider ? 'provider' : 'warning',
        title: activeProvider ? `${activeProvider.name} is active` : 'No active provider found',
        body: activeProvider ? activeProvider.notes : settings.get().mockEnabled ? 'No provider was selected.' : 'Mock is disabled and no live provider is available.',
        source: activeProvider?.id ?? 'provider-refresh',
        tone: activeProvider ? providerTone(activeProvider.kind) : 'orange',
        data: { activeProviderId: snapshot.activeProviderId, providerCount: snapshot.providers.length }
      });
      relayClient.sendStateSnapshots();
      sendJson(res, 200, { ok: true, ...fullSnapshot() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/settings') {
      sendJson(res, 200, { ok: true, settings: settings.get(), storage: settings.snapshot() });
      return;
    }

    if (req.method === 'PATCH' && url.pathname === '/settings') {
      const body = await readJson(req);
      const before = settings.get();
      const next = settings.update({
        language: typeof body.language === 'string' ? body.language : undefined,
        startupView: typeof body.startupView === 'string' ? body.startupView as typeof before.startupView : undefined,
        relayUrl: typeof body.relayUrl === 'string' ? body.relayUrl : undefined,
        theme: typeof body.theme === 'string' ? body.theme as typeof before.theme : undefined,
        minimizeToTray: typeof body.minimizeToTray === 'boolean' ? body.minimizeToTray : undefined,
        mockEnabled: typeof body.mockEnabled === 'boolean' ? body.mockEnabled : undefined,
        notificationPreferences: typeof body.notificationPreferences === 'object' && body.notificationPreferences
          ? body.notificationPreferences as typeof before.notificationPreferences
          : undefined,
        agentSelector: typeof body.agentSelector === 'object' && body.agentSelector
          ? body.agentSelector as typeof before.agentSelector
          : undefined,
        projectDiscovery: typeof body.projectDiscovery === 'object' && body.projectDiscovery
          ? body.projectDiscovery as typeof before.projectDiscovery
          : undefined,
        voice: typeof body.voice === 'object' && body.voice ? body.voice as typeof before.voice : undefined,
        autoUpdateServer: typeof body.autoUpdateServer === 'boolean' ? body.autoUpdateServer : undefined,
        autoUpdateClient: typeof body.autoUpdateClient === 'boolean' ? body.autoUpdateClient : undefined,
        developerDiagnostics: typeof body.developerDiagnostics === 'boolean' ? body.developerDiagnostics : undefined
      });
      if (before.mockEnabled !== next.mockEnabled) {
        await state.refreshProviders({ mockEnabled: next.mockEnabled });
        events.emit('provider.state', state.snapshot().providers);
        relayClient.sendStateSnapshots();
        addNotification({
          kind: 'system',
          title: next.mockEnabled ? 'Mock provider enabled' : 'Mock provider disabled',
          body: next.mockEnabled ? 'Mock fallback is available again.' : 'Mock fallback is disabled across the local app.',
          source: 'settings',
          tone: next.mockEnabled ? 'green' : 'orange',
          data: { mockEnabled: next.mockEnabled }
        });
      }
      if (before.relayUrl !== next.relayUrl) {
        addNotification({
          kind: 'system',
          title: 'Relay URL updated',
          body: `Device pairing will now use ${next.relayUrl}.`,
          source: 'settings',
          tone: 'blue',
          data: { relayUrl: next.relayUrl }
        });
      }
      if (JSON.stringify(before.projectDiscovery) !== JSON.stringify(next.projectDiscovery)) {
        scheduleProjectDiscovery();
        void syncMemoryMeshDiscovery();
      }
      if ((!before.autoUpdateServer && next.autoUpdateServer) || (!before.autoUpdateClient && next.autoUpdateClient)) {
        void runConfiguredUpdateCheck();
      }
      events.emit('settings.updated', next);
      sendJson(res, 200, { ok: true, settings: next, state: fullSnapshot() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/cache') {
      sendJson(res, 200, {
        ok: true,
        cache: {
          events: { count: events.count() },
          sessions: sessions.snapshot(),
          files: files.snapshot(),
          art: art.snapshot(),
          notifications: notifications.snapshot()
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/cache/clear') {
      const clearedEvents = events.clear();
      const notice = addNotification({
        kind: 'system',
        title: 'Local cache cleared',
        body: `Cleared ${clearedEvents} transient event records. Persistent chat, files, art, and settings were preserved.`,
        source: 'settings',
        tone: 'green',
        data: { clearedEvents }
      });
      sendJson(res, 200, {
        ok: true,
        cleared: true,
        notification: notice,
        cache: {
          events: { count: events.count(), cleared: clearedEvents },
          sessions: sessions.snapshot(),
          files: files.snapshot(),
          art: art.snapshot(),
          notifications: notifications.snapshot()
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/security/sessions') {
      const activeSessions = sessions.list()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 12)
        .map(publicSession);
      sendJson(res, 200, {
        ok: true,
        security: {
          localOnly: true,
          relayAuth: 'Pairing approval now supports persisted devices, per-device public keys, signed challenges, revocation, and key rotation on the relay.',
          activeSessions,
          device: state.snapshot().device,
          uplink: relayClient.snapshot()
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/memory/reika') {
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit') || 12) || 12));
      const results = searchSessions({ agent: url.searchParams.get('agent') || 'reika', limit });
      sendJson(res, 200, { ok: true, agent: url.searchParams.get('agent') || 'reika', memories: results });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/updates/status') {
      const status = await getUpdateStatus(settings.get());
      if (status.available) notifyUpdateAvailable(status);
      sendJson(res, 200, status);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/updates/check') {
      const status = await getUpdateStatus(settings.get());
      events.emit('updates.checked', status);
      if (status.available) notifyUpdateAvailable(status);
      sendJson(res, 200, status);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/updates/apply') {
      const result = await applyGitHubUpdate(settings.get());
      events.emit('updates.applied', result);
      notifyUpdateApplied(result);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/notifications') {
      const unreadOnly = url.searchParams.get('unread') === 'true';
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 100) || 100));
      sendJson(res, 200, { ok: true, storage: notifications.snapshot(), notifications: notifications.list({ unreadOnly, limit }) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/notifications/read-all') {
      const count = notifications.markAllRead();
      sendJson(res, 200, { ok: true, count, storage: notifications.snapshot(), notifications: notifications.list() });
      return;
    }

    const notificationReadMatch = url.pathname.match(/^\/notifications\/([^/]+)\/read$/);
    if (req.method === 'POST' && notificationReadMatch) {
      const notification = notifications.markRead(decodeURIComponent(notificationReadMatch[1] || ''));
      if (!notification) {
        sendJson(res, 404, { ok: false, error: 'Notification not found', code: 'NOTIFICATION_NOT_FOUND' });
        return;
      }
      sendJson(res, 200, { ok: true, notification, storage: notifications.snapshot() });
      return;
    }

    const notificationDeleteMatch = url.pathname.match(/^\/notifications\/([^/]+)$/);
    if (req.method === 'DELETE' && notificationDeleteMatch) {
      const deleted = notifications.delete(decodeURIComponent(notificationDeleteMatch[1] || ''));
      if (!deleted) {
        sendJson(res, 404, { ok: false, error: 'Notification not found', code: 'NOTIFICATION_NOT_FOUND' });
        return;
      }
      sendJson(res, 200, { ok: true, storage: notifications.snapshot(), notifications: notifications.list() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/commands/simulate') {
      const body = await readJson(req);
      const type = String(body.type || '') as AgentHubMessageType;
      const envelope = createEnvelope({ type, source: appEndpoint, target: deviceEndpoint, payload: typeof body.payload === 'object' && body.payload ? body.payload : {} });
      const responses = await dispatcher.dispatch(envelope);
      sendJson(res, 200, { ok: true, request: envelope, responses });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/sessions') {
      const body = await readJson(req);
      const session = createSession({
        providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
        agent: typeof body.agent === 'string' ? body.agent : undefined,
        title: typeof body.title === 'string' ? body.title : undefined,
        metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata as Record<string, unknown> : undefined
      });
      sendJson(res, 200, { ok: true, session: publicSession(session) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/sessions') {
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 100) || 100));
      const agent = url.searchParams.get('agent') || undefined;
      const providerId = url.searchParams.get('providerId') || undefined;
      const list = searchSessions({ agent, providerId, limit });
      sendJson(res, 200, { ok: true, storage: sessions.snapshot(), sessions: list });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/sessions/search') {
      const q = url.searchParams.get('q') || '';
      if (!q.trim()) {
        sendJson(res, 400, { ok: false, error: 'Missing query', code: 'BAD_REQUEST' });
        return;
      }
      const results = searchSessions({ q, agent: url.searchParams.get('agent') || undefined, providerId: url.searchParams.get('providerId') || undefined, limit: Number(url.searchParams.get('limit') || 20) });
      sendJson(res, 200, { ok: true, query: q, results });
      return;
    }

    const sessionMetaMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
    if (req.method === 'GET' && sessionMetaMatch) {
      const session = sessions.get(decodeURIComponent(sessionMetaMatch[1] || ''));
      if (!session) {
        sendJson(res, 404, { ok: false, error: 'Session not found', code: 'SESSION_NOT_FOUND' });
        return;
      }
      sendJson(res, 200, { ok: true, session: publicSession(session) });
      return;
    }

    const messagesMatch = url.pathname.match(/^\/sessions\/([^/]+)\/messages$/);
    if (req.method === 'GET' && messagesMatch) {
      const session = sessions.get(decodeURIComponent(messagesMatch[1] || ''));
      if (!session) {
        sendJson(res, 404, { ok: false, error: 'Session not found' });
        return;
      }
      const limit = Math.max(0, Number(url.searchParams.get('limit') || 0) || 0);
      const messages = limit > 0 ? session.messages.slice(-limit) : session.messages;
      sendJson(res, 200, { ok: true, sessionId: session.id, messages });
      return;
    }

    if (req.method === 'POST' && messagesMatch) {
      const sessionId = decodeURIComponent(messagesMatch[1] || '');
      const body = await readJson(req);
      const message = String(body.message || body.text || '').trim();
      if (!message) {
        sendJson(res, 400, { ok: false, error: 'message is required' });
        return;
      }
      const result = await runChatTurn({ sessionId, message, model: typeof body.model === 'string' ? body.model : undefined, fileIds: body.fileIds });
      sendJson(res, 200, { ok: true, session: publicSession(result.session), message: result.assistantMessage, result: result.result });
      return;
    }

    const streamMatch = url.pathname.match(/^\/sessions\/([^/]+)\/messages\/stream$/);
    if (req.method === 'POST' && streamMatch) {
      const sessionId = decodeURIComponent(streamMatch[1] || '');
      const body = await readJson(req);
      const message = String(body.message || body.text || '').trim();
      if (!message) {
        sendJson(res, 400, { ok: false, error: 'message is required' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive'
      });
      try {
        const result = await runChatTurn({ sessionId, message, model: typeof body.model === 'string' ? body.model : undefined, fileIds: body.fileIds }, (event) => writeSse(res, event.type, event.data));
        writeSse(res, 'message', result.assistantMessage);
        writeSse(res, 'done', { ok: true, session: publicSession(result.session) });
      } catch (error) {
        writeSse(res, 'error', { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      res.end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/chat') {
      const body = await readJson(req);
      const message = String(body.message || body.text || '').trim();
      if (!message) {
        sendJson(res, 400, { ok: false, error: 'message is required' });
        return;
      }
      const result = await runChatTurn({
        sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
        providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
        agent: typeof body.agent === 'string' ? body.agent : undefined,
        title: typeof body.title === 'string' ? body.title : undefined,
        model: typeof body.model === 'string' ? body.model : undefined,
        metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata as Record<string, unknown> : undefined,
        fileIds: body.fileIds,
        message
      });
      sendJson(res, 200, { ok: true, session: publicSession(result.session), message: result.assistantMessage, text: result.result.text, result: result.result });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/chat/stream') {
      const body = await readJson(req);
      const message = String(body.message || body.text || '').trim();
      if (!message) {
        sendJson(res, 400, { ok: false, error: 'message is required' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive'
      });
      try {
        const result = await runChatTurn({
          sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
          providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
          agent: typeof body.agent === 'string' ? body.agent : undefined,
          title: typeof body.title === 'string' ? body.title : undefined,
          model: typeof body.model === 'string' ? body.model : undefined,
          metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata as Record<string, unknown> : undefined,
          fileIds: body.fileIds,
          message
        }, (event) => writeSse(res, event.type, event.data));
        writeSse(res, 'message', result.assistantMessage);
        writeSse(res, 'done', { ok: true, session: publicSession(result.session) });
      } catch (error) {
        writeSse(res, 'error', { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      res.end();
      return;
    }


    if (req.method === 'GET' && url.pathname === '/files') {
      sendJson(res, 200, { ok: true, storage: files.snapshot(), items: files.list().map(publicFile) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/files/link') {
      const body = await readJson(req);
      const sourceUrl = String(body.url || '').trim();
      if (!sourceUrl) {
        sendJson(res, 400, { ok: false, error: 'url is required', code: 'BAD_REQUEST' });
        return;
      }
      const item = await files.link({ url: sourceUrl, name: typeof body.name === 'string' ? body.name : undefined, notes: typeof body.notes === 'string' ? body.notes : undefined });
      events.emit('file.linked', publicFile(item));
      addNotification({ kind: 'file', title: 'Link attached', body: `${item.name} is available for Reika chat context.`, source: 'files', tone: 'purple', data: { fileId: item.id } });
      sendJson(res, 200, { ok: true, item: publicFile(item) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/files/upload') {
      const body = await readJson(req);
      const uploads = Array.isArray(body.files) ? body.files : [body];
      const items = [];
      for (const upload of uploads) {
        if (!upload || typeof upload !== 'object') continue;
        const entry = upload as Record<string, unknown>;
        const name = String(entry.name || entry.filename || 'upload').trim();
        const base64 = String(entry.base64 || entry.buffer || '').replace(/^data:[^;]+;base64,/, '');
        if (!base64) continue;
        const buffer = Buffer.from(base64, 'base64');
        const item = await files.upload({ name, buffer, mimeType: typeof entry.mimeType === 'string' ? entry.mimeType : typeof entry.contentType === 'string' ? entry.contentType : undefined });
        items.push(publicFile(item));
      }
      if (!items.length) {
        sendJson(res, 400, { ok: false, error: 'No files uploaded', code: 'BAD_REQUEST' });
        return;
      }
      events.emit('file.uploaded', { count: items.length });
      addNotification({ kind: 'file', title: 'File upload complete', body: `${items.length} ${items.length === 1 ? 'file is' : 'files are'} available for chat context.`, source: 'files', tone: 'purple', data: { count: items.length } });
      sendJson(res, 200, { ok: true, items });
      return;
    }

    const fileDownloadMatch = url.pathname.match(/^\/files\/([^/]+)\/download$/);
    if (req.method === 'GET' && fileDownloadMatch) {
      const item = files.get(decodeURIComponent(fileDownloadMatch[1] || ''));
      if (!item) {
        sendJson(res, 404, { ok: false, error: 'File not found', code: 'FILE_NOT_FOUND' });
        return;
      }
      if (item.kind === 'link' && item.sourceUrl) {
        res.writeHead(302, { Location: item.sourceUrl });
        res.end();
        return;
      }
      if (!item.path || !existsSync(item.path)) {
        sendJson(res, 404, { ok: false, error: 'Stored file missing', code: 'FILE_NOT_FOUND' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': item.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${item.originalName.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store'
      });
      files.stream(item).pipe(res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/state') {
      sendJson(res, 200, { ok: true, ...fullSnapshot() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/providers') {
      const snapshot = state.snapshot();
      sendJson(res, 200, { ok: true, activeProviderId: snapshot.activeProviderId, providers: snapshot.providers });
      return;
    }

    const providerHistoryImportMatch = url.pathname.match(/^\/providers\/([^/]+)\/history\/import$/);
    if (req.method === 'POST' && providerHistoryImportMatch) {
      const providerId = decodeURIComponent(providerHistoryImportMatch[1] || '');
      const body = await readJson(req);
      const limit = Math.max(1, Math.min(100, Number(body.limit || 25) || 25));
      const includeMessages = body.includeMessages !== false;
      const providerSessions = await listProviderHistorySessions(providerId, state.snapshot().providers, limit);
      const imported = [];
      for (const record of providerSessions) {
        const messages = includeMessages ? await getProviderHistoryMessages(record.providerId, record.providerSessionId, state.snapshot().providers) : [];
        const result = importProviderSession(record, messages);
        imported.push({ providerSessionId: record.providerSessionId, session: publicSession(result.session), created: result.created, messageCount: result.messageCount });
      }
      events.emit('chat.history.imported', { providerId, count: imported.length });
      addNotification({ kind: 'provider', title: 'Provider history imported', body: `${imported.length} sessions imported from ${providerId}.`, source: providerId, tone: 'green', data: { providerId, count: imported.length } });
      sendJson(res, 200, { ok: true, providerId, imported });
      return;
    }

    const providerHistoryMatch = url.pathname.match(/^\/providers\/([^/]+)\/history$/);
    if (req.method === 'GET' && providerHistoryMatch) {
      const providerId = decodeURIComponent(providerHistoryMatch[1] || '');
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 25) || 25));
      const providerSessions = await listProviderHistorySessions(providerId, state.snapshot().providers, limit);
      sendJson(res, 200, { ok: true, providerId, sessions: providerSessions });
      return;
    }

    const providerAgentsMatch = url.pathname.match(/^\/providers\/([^/]+)\/agents$/);
    if (req.method === 'GET' && providerAgentsMatch) {
      const providerId = decodeURIComponent(providerAgentsMatch[1] || '');
      const provider = state.snapshot().providers.find((item) => item.id === providerId || item.kind === providerId);
      if (!provider) {
        sendJson(res, 404, { ok: false, error: 'Provider not found' });
        return;
      }
      sendJson(res, 200, { ok: true, providerId: provider.id, agents: provider.agents });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/uplink') {
      sendJson(res, 200, { ok: true, uplink: relayClient.snapshot() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/startup') {
      sendJson(res, 200, { ok: true, startup: await getStartupStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/uplink/connect') {
      const body = await readJson(req);
      const relayUrl = typeof body.relayUrl === 'string' ? body.relayUrl.trim() : '';
      const pairingToken = typeof body.pairingToken === 'string' ? body.pairingToken.trim() : '';
      const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
      if (!relayUrl) {
        sendJson(res, 400, { ok: false, error: 'relayUrl is required' });
        return;
      }
      relayClient.connectWith({ relayUrl, pairingToken, deviceId: deviceId || undefined });
      addNotification({ kind: 'device', title: 'Relay uplink connecting', body: `Connecting this device to ${relayUrl}.`, source: 'uplink', tone: 'blue', data: { relayUrl, deviceId: deviceId || undefined } });
      sendJson(res, 200, { ok: true, uplink: relayClient.snapshot() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/startup/enable') {
      const body = await readJson(req);
      const uplink = relayClient.snapshot();
      const relayUrl = typeof body.relayUrl === 'string' && body.relayUrl.trim() ? body.relayUrl.trim() : uplink.enabled ? uplink.relayUrl : undefined;
      const deviceId = typeof body.deviceId === 'string' && body.deviceId.trim() ? body.deviceId.trim() : uplink.deviceId;
      const startup = await enableStartup({ relayUrl, deviceId });
      sendJson(res, startup.supported ? 200 : 400, { ok: startup.supported, startup });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/startup/disable') {
      const startup = await disableStartup();
      sendJson(res, startup.supported ? 200 : 400, { ok: startup.supported, startup });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/uplink/disconnect') {
      relayClient.stop();
      addNotification({ kind: 'device', title: 'Relay uplink disconnected', body: 'This device stopped its relay uplink.', source: 'uplink', tone: 'orange' });
      sendJson(res, 200, { ok: true, uplink: relayClient.snapshot() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      sendJson(res, 200, { ok: true, events: events.recent() });
      return;
    }

    sendJson(res, 404, {
      ok: false,
      error: 'Not found',
      endpoints: [
        'GET /health',
        'GET /state',
        'GET /settings',
        'PATCH /settings',
        'GET /cache',
        'POST /cache/clear',
        'GET /security/sessions',
        'GET /memory/reika',
        'GET /memory-mesh/overview',
        'POST /memory-mesh/discovery/sync',
        'GET|POST /memory-mesh/agents',
        'GET|POST /memory-mesh/devices',
        'GET|POST /memory-mesh/projects',
        'GET|POST /memory-mesh/memories',
        'POST /memory-mesh/routing/preview',
        'GET|POST /memory-mesh/tasks',
        'GET /updates/status',
        'POST /updates/check',
        'POST /updates/apply',
        'GET /art',
        'GET /art/oauth/status',
        'POST /art/oauth/connect',
        'POST /art/oauth/disconnect',
        'POST /art/profiles',
        'POST /art/profiles/:id/duplicate',
        'DELETE /art/profiles/:id',
        'POST /art/profiles/:id/categories',
        'PATCH /art/profiles/:id/categories/:categoryId',
        'DELETE /art/profiles/:id/categories/:categoryId',
        'POST /art/profiles/:id/categories/:categoryId/assets/upload',
        'POST /art/profiles/:id/categories/:categoryId/assets/link',
        'PATCH /art/profiles/:id/categories/:categoryId/assets/:assetId',
        'DELETE /art/profiles/:id/categories/:categoryId/assets/:assetId',
        'POST /art/profiles/:id/categories/:categoryId/generate',
        'GET /art/assets/:id/content',
        'GET /notifications',
        'POST /notifications/:id/read',
        'POST /notifications/read-all',
        'DELETE /notifications/:id',
        'GET /providers',
        'GET /providers/:id/agents',
        'GET /providers/:id/history',
        'POST /providers/:id/history/import',
        'GET /sessions',
        'GET /sessions/search',
        'GET /sessions/:id',
        'POST /sessions',
        'GET /sessions/:id/messages',
        'POST /sessions/:id/messages',
        'POST /sessions/:id/messages/stream',
        'POST /chat',
        'POST /chat/stream',
        'GET /files',
        'POST /files/upload',
        'POST /files/link',
        'GET /files/:id/download',
        'GET /uplink',
        'GET /startup',
        'POST /uplink/connect',
        'POST /uplink/disconnect',
        'POST /startup/enable',
        'POST /startup/disable',
        'POST /providers/refresh',
        'POST /commands/simulate',
        'GET /events'
      ]
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

async function startServer() {
  await boot();

  if (cli.mode === 'pair' && cli.noUi) {
    console.log(`Headless pairing requested for relay ${cli.relayUrl || serverConfig.uplink.relayUrl}. Approve this node in Reika.`);
    console.log('Local API/UI server disabled for this terminal pairing run.');
    return;
  }

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`${serverConfig.displayName} could not bind http://${serverConfig.host}:${serverConfig.port} because another Reika Node is already running there.`);
      console.error('For Linux terminal pairing, rerun with `--no-ui` or use the one-line installer again after updating.');
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    relayClient.stop();
    process.exit(1);
  });

  server.listen(serverConfig.port, serverConfig.host, () => {
    console.log(`${serverConfig.displayName} listening on http://${serverConfig.host}:${serverConfig.port}`);
    console.log(`Local provider detection enabled. External uplink ${serverConfig.uplink.enabled ? 'enabled' : 'disabled'}. Direct provider chat enabled for CommandCenter, OpenClaw, Hermes, and mock.`);
    if (process.platform === 'linux') {
      console.log(`Linux pairing: create a code in Reika, then run \`npm run dev -- pair --code <code> --relay ${serverConfig.uplink.relayUrl}\`.`);
    }
    if (cli.mode === 'pair') {
      console.log(`Pairing requested for relay ${cli.relayUrl || serverConfig.uplink.relayUrl}. Approve this node in Reika.`);
    } else if (!cli.noUi && shouldOpenPairingUi()) {
      const localUrl = `http://${serverConfig.host}:${serverConfig.port}/`;
      console.log(`Opening Windows pairing UI at ${localUrl}`);
      openLocalUrl(localUrl);
    }
  });
}

void startServer().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

process.on('SIGTERM', () => {
  relayClient.stop();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  relayClient.stop();
  server.close(() => process.exit(0));
});
}
