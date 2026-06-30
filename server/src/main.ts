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
import { getProviderHistoryMessages, listProviderHistorySessions, runProviderChat, type ProviderChatEvent, type ProviderChatMessage, type ProviderHistoryMessage, type ProviderHistorySession } from './modules/provider/providerRuntime.js';
import { SettingsStore } from './modules/settings/settingsStore.js';
import { SessionStore, type ChatMessageRecord, type ChatSessionRecord } from './modules/session/sessionStore.js';
import { RelayClient } from './modules/uplink/relayClient.js';
import { applyGitHubUpdate, getUpdateStatus, updateTargetsEnabled } from './modules/update/updateService.js';
import { openLocalUrl } from './platform/openBrowser.js';
import { shouldOpenPairingUi } from './platform/runtime.js';
import { disableStartup, enableStartup, formatStartupStatus, getStartupStatus } from './platform/startup.js';
import { pairingPage } from './ui/pairingPage.js';
import { createEnvelope, type AgentHubMessageType } from './shared/protocol/envelope.js';

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

if (cli.mode === 'startup') {
  void runStartupCli(cli);
}

if (cli.mode === 'updates') {
  void runUpdatesCli(cli);
}

if (cli.mode !== 'startup' && cli.mode !== 'updates') {
const events = new EventBus();
const state = new StateStore();
const sessions = new SessionStore();
const files = new FileStore();
const art = new ArtStore();
const settings = new SettingsStore();
const notifications = new NotificationStore();
const deviceEndpoint = { kind: 'device' as const, id: serverConfig.uplink.deviceId };
const appEndpoint = { kind: 'app' as const, id: 'local-simulator' };
const dispatcher = new CommandDispatcher(state, deviceEndpoint, async (payload) => {
  const result = await runChatTurn({
    sessionId: payload.sessionId,
    providerId: payload.providerId,
    agent: payload.agent,
    message: payload.message,
    model: payload.model,
    fileIds: payload.fileIds
  });
  return {
    providerId: result.result.providerId,
    agent: result.result.agentId,
    sessionId: result.session.id,
    text: result.result.text,
    runtime: result.result.runtime
  };
});
const relayClient = new RelayClient(state, events, async (payload) => {
  const result = await runChatTurn({
    sessionId: payload.sessionId,
    providerId: payload.providerId,
    agent: payload.agent,
    message: payload.message,
    model: payload.model,
    fileIds: payload.fileIds
  });
  return {
    providerId: result.result.providerId,
    agent: result.result.agentId,
    sessionId: result.session.id,
    text: result.result.text,
    runtime: result.result.runtime
  };
});

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
  events.emit('provider.state', state.snapshot().providers);
  relayClient.start();
  if (cli.mode === 'pair') {
    relayClient.connectWith({
      relayUrl: cli.relayUrl,
      pairingToken: cli.code,
      deviceId: cli.deviceId
    });
  }
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
    uplink: relayClient.snapshot()
  };
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

function notifyUpdateAvailable(status: Awaited<ReturnType<typeof getUpdateStatus>>) {
  if (!status.available) return;
  const alreadyUnread = notifications.list({ unreadOnly: true, limit: 200 }).some((item) => {
    const update = typeof item.data?.update === 'object' && item.data.update ? item.data.update as { remoteSha?: unknown } : undefined;
    return item.source === 'github' && item.title === 'AgentHub update available' && update?.remoteSha === status.remoteSha;
  });
  if (alreadyUnread) return;
  notifications.add({
    kind: 'system',
    title: 'AgentHub update available',
    body: `${status.message} Changed files: ${summarizeUpdateFiles(status.files)}. ${updateDescriptionText(status.descriptions)}`,
    source: 'github',
    tone: 'blue',
    data: { update: status }
  });
}

function notifyUpdateApplied(result: Awaited<ReturnType<typeof applyGitHubUpdate>>) {
  notifications.add({
    kind: 'system',
    title: result.applied ? 'AgentHub updated from GitHub' : 'AgentHub update checked',
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
    notifications.add({
      kind: 'warning',
      title: 'AgentHub update check failed',
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

async function runChatTurn(input: { sessionId?: string; providerId?: string; agent?: string; message: string; model?: string; title?: string; metadata?: Record<string, unknown>; fileIds?: unknown }, onEvent?: (event: ProviderChatEvent) => void) {
  const session = getOrCreateSession(input);
  const attachedFiles = filesPayload(input.fileIds);
  const context = attachmentContext(input.fileIds);
  const userMessage = appendMessage(session, 'user', input.message, { providerId: session.providerId, agent: session.agent, files: attachedFiles });
  const providers = state.snapshot().providers;
  if (input.providerId === 'mock-local' && !settings.get().mockEnabled) throw new Error('Mock provider is disabled in AgentHub settings.');
  const handler = (event: ProviderChatEvent) => {
    emitChatEvent(event, session);
    onEvent?.(event);
  };
  try {
    const result = await runProviderChat({
      providerId: input.providerId || session.providerId,
      agentId: input.agent || session.agent,
      sessionId: session.id,
      message: context ? `${input.message}\n\nAttached files/links:\n${context}` : input.message,
      history: sessionHistory(session).slice(0, -1),
      model: input.model,
      providerSessionId: typeof session.metadata.hermesSessionId === 'string'
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
    providerSessionIds[result.providerId] = result.sessionId;
    session.metadata.providerSessionIds = providerSessionIds;
    if (result.runtime === 'hermes') session.metadata.hermesSessionId = typeof result.metadata?.hermesSessionId === 'string' ? result.metadata.hermesSessionId : result.sessionId;
    const assistantMessage = appendMessage(session, 'assistant', result.text, { providerId: result.providerId, agent: result.agentId, runtime: result.runtime, files: [] });
    notifications.add({
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

function artPayload(extra: Record<string, unknown> = {}) {
  return { ok: true, storage: art.snapshot(), oauth: art.oauthStatus(), profiles: art.list(), ...extra };
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

    if (req.method === 'GET' && url.pathname === '/art') {
      sendJson(res, 200, artPayload());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/art/oauth/status') {
      sendJson(res, 200, { ok: true, oauth: art.oauthStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/art/oauth/connect') {
      const oauth = art.oauthStatus();
      sendJson(res, 200, { ok: true, oauth, message: oauth.message });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/art/oauth/disconnect') {
      const oauth = art.oauthStatus();
      sendJson(res, 200, { ok: true, oauth, message: 'Codex/ChatGPT OAuth is disconnected.' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/art/profiles') {
      const body = await readJson(req);
      const profile = art.createProfile({ name: body.name, subtitle: body.subtitle, scope: body.scope });
      notifications.add({
        kind: 'system',
        title: 'Art profile created',
        body: `${profile.name} now has an AgentHub art profile.`,
        source: 'art-studio',
        tone: 'blue',
        data: { profileId: profile.id }
      });
      sendJson(res, 200, artPayload({ profile }));
      return;
    }

    const artDuplicateMatch = url.pathname.match(/^\/art\/profiles\/([^/]+)\/duplicate$/);
    if (req.method === 'POST' && artDuplicateMatch) {
      const profile = art.duplicateProfile(decodeURIComponent(artDuplicateMatch[1] || ''));
      notifications.add({
        kind: 'system',
        title: 'Art profile duplicated',
        body: `${profile.name} was created from an existing art profile.`,
        source: 'art-studio',
        tone: 'purple',
        data: { profileId: profile.id }
      });
      sendJson(res, 200, artPayload({ profile }));
      return;
    }

    const artProfileDeleteMatch = url.pathname.match(/^\/art\/profiles\/([^/]+)$/);
    if (req.method === 'DELETE' && artProfileDeleteMatch) {
      const profile = art.deleteProfile(decodeURIComponent(artProfileDeleteMatch[1] || ''));
      notifications.add({
        kind: 'warning',
        title: 'Art profile deleted',
        body: `${profile.name} was removed from Agent Art Studio.`,
        source: 'art-studio',
        tone: 'orange',
        data: { profileId: profile.id }
      });
      sendJson(res, 200, artPayload({ profile }));
      return;
    }

    const artCategoryCreateMatch = url.pathname.match(/^\/art\/profiles\/([^/]+)\/categories$/);
    if (req.method === 'POST' && artCategoryCreateMatch) {
      const body = await readJson(req);
      const profileId = decodeURIComponent(artCategoryCreateMatch[1] || '');
      const category = art.addCategory(profileId, { name: body.name });
      sendJson(res, 200, artPayload({ category }));
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
      sendJson(res, 200, artPayload({ category }));
      return;
    }

    if (req.method === 'DELETE' && artCategoryMatch) {
      const category = art.deleteCategory(decodeURIComponent(artCategoryMatch[1] || ''), decodeURIComponent(artCategoryMatch[2] || ''));
      notifications.add({
        kind: 'warning',
        title: 'Art category deleted',
        body: `${category.name} was removed from Agent Art Studio.`,
        source: 'art-studio',
        tone: 'orange',
        data: { categoryId: category.id }
      });
      sendJson(res, 200, artPayload({ category }));
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
      notifications.add({
        kind: 'file',
        title: 'Art uploaded',
        body: `${assetRecord.name} was added to Agent Art Studio.`,
        source: 'art-studio',
        tone: 'purple',
        data: { assetId: assetRecord.id }
      });
      sendJson(res, 200, artPayload({ asset: assetRecord }));
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
      sendJson(res, 200, artPayload({ asset: assetRecord }));
      return;
    }

    const artGenerateMatch = url.pathname.match(/^\/art\/profiles\/([^/]+)\/categories\/([^/]+)\/generate$/);
    if (req.method === 'POST' && artGenerateMatch) {
      const generation = art.requestGeneration(decodeURIComponent(artGenerateMatch[1] || ''), decodeURIComponent(artGenerateMatch[2] || ''));
      notifications.add({
        kind: 'warning',
        title: 'Image generation waiting on OAuth',
        body: generation.message,
        source: 'art-studio',
        tone: 'orange',
        data: { generation }
      });
      sendJson(res, 200, artPayload({ generation }));
      return;
    }

    const artAssetDeleteMatch = url.pathname.match(/^\/art\/profiles\/([^/]+)\/categories\/([^/]+)\/assets\/([^/]+)$/);
    if (req.method === 'DELETE' && artAssetDeleteMatch) {
      const assetRecord = art.deleteAsset(decodeURIComponent(artAssetDeleteMatch[1] || ''), decodeURIComponent(artAssetDeleteMatch[2] || ''), decodeURIComponent(artAssetDeleteMatch[3] || ''));
      sendJson(res, 200, artPayload({ asset: assetRecord }));
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
      notifications.add({
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
        minimizeToTray: typeof body.minimizeToTray === 'boolean' ? body.minimizeToTray : undefined,
        mockEnabled: typeof body.mockEnabled === 'boolean' ? body.mockEnabled : undefined,
        autoUpdateServer: typeof body.autoUpdateServer === 'boolean' ? body.autoUpdateServer : undefined,
        autoUpdateClient: typeof body.autoUpdateClient === 'boolean' ? body.autoUpdateClient : undefined,
        developerDiagnostics: typeof body.developerDiagnostics === 'boolean' ? body.developerDiagnostics : undefined
      });
      if (before.mockEnabled !== next.mockEnabled) {
        await state.refreshProviders({ mockEnabled: next.mockEnabled });
        events.emit('provider.state', state.snapshot().providers);
        relayClient.sendStateSnapshots();
        notifications.add({
          kind: 'system',
          title: next.mockEnabled ? 'Mock provider enabled' : 'Mock provider disabled',
          body: next.mockEnabled ? 'Mock fallback is available again.' : 'Mock fallback is disabled across the local app.',
          source: 'settings',
          tone: next.mockEnabled ? 'green' : 'orange',
          data: { mockEnabled: next.mockEnabled }
        });
      }
      if (before.relayUrl !== next.relayUrl) {
        notifications.add({
          kind: 'system',
          title: 'Relay URL updated',
          body: `Device pairing will now use ${next.relayUrl}.`,
          source: 'settings',
          tone: 'blue',
          data: { relayUrl: next.relayUrl }
        });
      }
      if ((!before.autoUpdateServer && next.autoUpdateServer) || (!before.autoUpdateClient && next.autoUpdateClient)) {
        void runConfiguredUpdateCheck();
      }
      events.emit('settings.updated', next);
      sendJson(res, 200, { ok: true, settings: next, state: fullSnapshot() });
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
      notifications.add({ kind: 'file', title: 'Link attached', body: `${item.name} is available for Reika chat context.`, source: 'files', tone: 'purple', data: { fileId: item.id } });
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
      notifications.add({ kind: 'file', title: 'File upload complete', body: `${items.length} ${items.length === 1 ? 'file is' : 'files are'} available for chat context.`, source: 'files', tone: 'purple', data: { count: items.length } });
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
      notifications.add({ kind: 'provider', title: 'Provider history imported', body: `${imported.length} sessions imported from ${providerId}.`, source: providerId, tone: 'green', data: { providerId, count: imported.length } });
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
      notifications.add({ kind: 'device', title: 'Relay uplink connecting', body: `Connecting this device to ${relayUrl}.`, source: 'uplink', tone: 'blue', data: { relayUrl, deviceId: deviceId || undefined } });
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
      notifications.add({ kind: 'device', title: 'Relay uplink disconnected', body: 'This device stopped its relay uplink.', source: 'uplink', tone: 'orange' });
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

  server.listen(serverConfig.port, serverConfig.host, () => {
    console.log(`${serverConfig.displayName} listening on http://${serverConfig.host}:${serverConfig.port}`);
    console.log(`Local provider detection enabled. External uplink ${serverConfig.uplink.enabled ? 'enabled' : 'disabled'}. Direct provider chat enabled for CommandCenter, OpenClaw, Hermes, and mock.`);
    if (process.platform === 'linux') {
      console.log(`Linux pairing: create a code in AgentHub, then run \`npm run dev -- pair --code <code> --relay ${serverConfig.uplink.relayUrl}\`.`);
    }
    if (cli.mode === 'pair') {
      console.log(`Pairing requested for relay ${cli.relayUrl || serverConfig.uplink.relayUrl}. Approve this device in AgentHub.`);
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
