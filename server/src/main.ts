import http from 'node:http';
import { parseCliArgs, helpText, type CliOptions } from './cli/args.js';
import { serverConfig } from './config/defaults.js';
import { EventBus } from './core/eventBus.js';
import { StateStore } from './core/stateStore.js';
import { CommandDispatcher } from './modules/commands/dispatcher.js';
import { RelayClient } from './modules/uplink/relayClient.js';
import { openLocalUrl } from './platform/openBrowser.js';
import { shouldOpenPairingUi } from './platform/runtime.js';
import { disableStartup, enableStartup, formatStartupStatus, getStartupStatus } from './platform/startup.js';
import { pairingPage } from './ui/pairingPage.js';
import { createEnvelope, type AgentHubMessageType } from './shared/protocol/envelope.js';

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
const deviceEndpoint = { kind: 'device' as const, id: serverConfig.uplink.deviceId };
const appEndpoint = { kind: 'app' as const, id: 'local-simulator' };
const dispatcher = new CommandDispatcher(state, deviceEndpoint);
const relayClient = new RelayClient(state, events);

events.emit('server.boot', { serviceName: serverConfig.serviceName });
void boot();

async function boot() {
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${serverConfig.host}:${serverConfig.port}`}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, service: serverConfig.serviceName, status: 'ready', uplink: relayClient.snapshot() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      const html = pairingPage(state.device, relayClient.snapshot(), await getStartupStatus());
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
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
      const envelope = createEnvelope({
        type,
        source: appEndpoint,
        target: deviceEndpoint,
        payload: typeof body.payload === 'object' && body.payload ? body.payload : {}
      });
      const responses = await dispatcher.dispatch(envelope);
      sendJson(res, 200, { ok: true, request: envelope, responses });
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

      relayClient.connectWith({
        relayUrl,
        pairingToken,
        deviceId: deviceId || undefined
      });
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
    sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(serverConfig.port, serverConfig.host, () => {
  console.log(`${serverConfig.displayName} listening on http://${serverConfig.host}:${serverConfig.port}`);
  console.log(`Local provider detection enabled. External uplink ${serverConfig.uplink.enabled ? 'enabled' : 'disabled'}. Chat transport disabled.`);
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

process.on('SIGTERM', () => {
  relayClient.stop();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  relayClient.stop();
  server.close(() => process.exit(0));
});
}
