import http from 'node:http';
import { serverConfig } from './config/defaults.js';
import { EventBus } from './core/eventBus.js';
import { StateStore } from './core/stateStore.js';
import { plannedUplink } from './modules/uplink/plannedUplink.js';

const events = new EventBus();
const state = new StateStore();

events.emit('server.boot', { serviceName: serverConfig.serviceName });
events.emit('uplink.planned', plannedUplink);
events.emit('server.ready', state.snapshot());

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(json);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${serverConfig.host}:${serverConfig.port}`}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true, service: serverConfig.serviceName, status: 'ready' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/state') {
    sendJson(res, 200, { ok: true, ...state.snapshot() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    sendJson(res, 200, { ok: true, events: events.recent() });
    return;
  }

  sendJson(res, 404, {
    ok: false,
    error: 'Not found',
    endpoints: ['GET /health', 'GET /state', 'GET /events']
  });
});

server.listen(serverConfig.port, serverConfig.host, () => {
  console.log(`${serverConfig.displayName} listening on http://${serverConfig.host}:${serverConfig.port}`);
  console.log('External uplink disabled. Provider connections disabled. Mock local state only.');
});
