import http from 'node:http';
import { parseCliArgs, helpText, type CliOptions } from './cli/args.js';
import { serverConfig } from './config/defaults.js';
import { EventBus } from './core/eventBus.js';
import { StateStore } from './core/stateStore.js';
import { CommandDispatcher } from './modules/commands/dispatcher.js';
import { runProviderChat, type ProviderChatEvent, type ProviderChatMessage } from './modules/provider/providerRuntime.js';
import { SessionStore, type ChatMessageRecord, type ChatSessionRecord } from './modules/session/sessionStore.js';
import { RelayClient } from './modules/uplink/relayClient.js';
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

if (cli.mode === 'startup') {
  void runStartupCli(cli);
}

if (cli.mode !== 'startup') {
const events = new EventBus();
const state = new StateStore();
const sessions = new SessionStore();
const deviceEndpoint = { kind: 'device' as const, id: serverConfig.uplink.deviceId };
const appEndpoint = { kind: 'app' as const, id: 'local-simulator' };
const dispatcher = new CommandDispatcher(state, deviceEndpoint, async (payload) => {
  const result = await runChatTurn({
    sessionId: payload.sessionId,
    providerId: payload.providerId,
    agent: payload.agent,
    message: payload.message,
    model: payload.model
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
    model: payload.model
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
  await sessions.load();
  events.emit('session.store.loaded', sessions.snapshot());
  await state.refreshProviders();
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
}

function fullSnapshot() {
  return {
    ...state.snapshot(),
    sessionStore: sessions.snapshot(),
    uplink: relayClient.snapshot()
  };
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

async function runChatTurn(input: { sessionId?: string; providerId?: string; agent?: string; message: string; model?: string; title?: string; metadata?: Record<string, unknown> }, onEvent?: (event: ProviderChatEvent) => void) {
  const session = getOrCreateSession(input);
  const userMessage = appendMessage(session, 'user', input.message, { providerId: session.providerId, agent: session.agent });
  const providers = state.snapshot().providers;
  const handler = (event: ProviderChatEvent) => {
    emitChatEvent(event, session);
    onEvent?.(event);
  };
  try {
    const result = await runProviderChat({
      providerId: input.providerId || session.providerId,
      agentId: input.agent || session.agent,
      sessionId: session.id,
      message: input.message,
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
    const providerSessionIds = typeof session.metadata.providerSessionIds === 'object' && session.metadata.providerSessionIds
      ? session.metadata.providerSessionIds as Record<string, string>
      : {};
    providerSessionIds[result.providerId] = result.sessionId;
    session.metadata.providerSessionIds = providerSessionIds;
    if (result.runtime === 'hermes') session.metadata.hermesSessionId = result.sessionId;
    const assistantMessage = appendMessage(session, 'assistant', result.text, { providerId: result.providerId, agent: result.agentId, runtime: result.runtime });
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${serverConfig.host}:${serverConfig.port}`}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, service: serverConfig.serviceName, status: 'ready', uplink: relayClient.snapshot() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      const html = pairingPage(state.device, relayClient.snapshot(), await getStartupStatus());
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/providers/refresh') {
      await state.refreshProviders();
      events.emit('provider.state', state.snapshot().providers);
      relayClient.sendStateSnapshots();
      sendJson(res, 200, { ok: true, ...fullSnapshot() });
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
      sendJson(res, 200, { ok: true, storage: sessions.snapshot(), sessions: sessions.list().map(publicSession).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
      return;
    }

    const messagesMatch = url.pathname.match(/^\/sessions\/([^/]+)\/messages$/);
    if (req.method === 'GET' && messagesMatch) {
      const session = sessions.get(decodeURIComponent(messagesMatch[1] || ''));
      if (!session) {
        sendJson(res, 404, { ok: false, error: 'Session not found' });
        return;
      }
      sendJson(res, 200, { ok: true, sessionId: session.id, messages: session.messages });
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
      const result = await runChatTurn({ sessionId, message, model: typeof body.model === 'string' ? body.model : undefined });
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
        const result = await runChatTurn({ sessionId, message, model: typeof body.model === 'string' ? body.model : undefined }, (event) => writeSse(res, event.type, event.data));
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

    if (req.method === 'GET' && url.pathname === '/state') {
      sendJson(res, 200, { ok: true, ...fullSnapshot() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/providers') {
      const snapshot = state.snapshot();
      sendJson(res, 200, { ok: true, activeProviderId: snapshot.activeProviderId, providers: snapshot.providers });
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
        'GET /providers',
        'GET /providers/:id/agents',
        'GET /sessions',
        'POST /sessions',
        'GET /sessions/:id/messages',
        'POST /sessions/:id/messages',
        'POST /sessions/:id/messages/stream',
        'POST /chat',
        'POST /chat/stream',
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

await boot();

server.listen(serverConfig.port, serverConfig.host, () => {
  console.log(`${serverConfig.displayName} listening on http://${serverConfig.host}:${serverConfig.port}`);
  console.log(`Local provider detection enabled. External uplink ${serverConfig.uplink.enabled ? 'enabled' : 'disabled'}. Direct provider chat enabled for CommandCenter, OpenClaw, Hermes, and mock.`);
  if (process.platform === 'linux') {
    console.log('Linux pairing: create a code in AgentHub, then run `npm run dev -- pair --code <code> --relay ws://127.0.0.1:8790/v1/device`.');
  }
  if (cli.mode === 'pair') {
    console.log(`Pairing requested for relay ${cli.relayUrl || serverConfig.uplink.relayUrl}. Approve this device in AgentHub.`);
  } else if (!cli.noUi && shouldOpenPairingUi()) {
    const localUrl = `http://${serverConfig.host}:${serverConfig.port}/`;
    console.log(`Opening Windows pairing UI at ${localUrl}`);
    openLocalUrl(localUrl);
  }
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
