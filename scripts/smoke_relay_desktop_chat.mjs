import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const clientDir = join(root, "client");
const smokeId = `relay-smoke-${Date.now().toString(36)}`;
const stateDir = join(tmpdir(), `project-reika-${smokeId}`);
const relayPort = await freePort();
const agentPort = await freePort();
const vitePort = await freePort();
const debugPort = await freePort();
const relayDeviceUrl = `ws://127.0.0.1:${relayPort}/v1/device`;
const relayHttpUrl = `http://127.0.0.1:${relayPort}`;
const deviceId = `${smokeId}-device`;
const providerId = "smoke-provider";
const astraId = "astra-smoke";
const nyxieId = "nyxie-smoke";
const processes = [];
let deviceSocket;
let cdpSocket;
let cleanedUp = false;

removeOldSmokeTempDirs();
mkdirSync(stateDir, { recursive: true });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}

try {
  setTimeout(() => {
    void cleanup().finally(() => {
      console.error("desktop relay chat smoke timed out");
      process.exit(124);
    });
  }, 150000).unref();
  await main();
  console.log("desktop relay chat smoke ok");
} finally {
  await cleanup();
}

async function main() {
  log(`using relay:${relayPort} agent:${agentPort} vite:${vitePort} debug:${debugPort}`);
  log("building desktop main");
  await run("npm", ["run", "build:desktop:main"], { cwd: clientDir });

  const env = {
    ...process.env,
    BROWSER: "none",
    REIKA_RELAY_URL: relayDeviceUrl,
    VITE_REIKA_RELAY_URL: relayDeviceUrl,
    VITE_REIKA_RELAY_PROXY_TARGET: relayHttpUrl,
    AGENTHUB_RELAY_TARGET: relayHttpUrl,
    REIKA_RELAY_PORT: String(relayPort),
    REIKA_AGENT_PORT: String(agentPort),
    VITE_REIKA_AGENT_TARGET: `http://127.0.0.1:${agentPort}`,
    REIKA_RELAY_STORE_PATH: join(stateDir, "relay-store.json"),
    REIKA_SETTINGS_STORE_PATH: join(stateDir, "settings.json"),
    REIKA_SESSION_STORE_PATH: join(stateDir, "sessions.json"),
    REIKA_FILE_STORE_PATH: join(stateDir, "files.json"),
    REIKA_ART_STORE_PATH: join(stateDir, "art.json"),
    REIKA_NOTIFICATION_STORE_PATH: join(stateDir, "notifications.json")
  };

  log("starting relay");
  spawnManaged("npm", ["run", "dev:relay"], { cwd: root, env, label: "relay" });
  await waitForUrl(`${relayHttpUrl}/v1/health`);

  log("pairing mock device");
  const pairingCode = await pairDevice();
  deviceSocket = await connectMockRelayDevice(pairingCode);

  log("starting agent server");
  spawnManaged("npm", ["run", "dev:server"], { cwd: root, env, label: "agent" });
  await waitForUrl(`http://127.0.0.1:${agentPort}/health`);

  log("starting vite");
  spawnManaged("npm", ["run", "dev:ui", "--", "--port", String(vitePort)], { cwd: clientDir, env, label: "vite" });
  await waitForUrl(`http://127.0.0.1:${vitePort}`);

  log("launching electron");
  spawnManaged("npx", ["electron", ".", `--remote-debugging-port=${debugPort}`], {
    cwd: clientDir,
    env: {
      ...env,
      AGENTHUB_DESKTOP_DEV: "1",
      AGENTHUB_DESKTOP_DEV_URL: `http://127.0.0.1:${vitePort}`
    },
    label: "electron"
  });

  log("connecting CDP");
  const page = await connectCdp();
  await waitFor(page, () => document.body.innerText.includes("Welcome back"), 45000);
  await waitFor(page, () => document.body.innerText.includes("Astra Relay Smoke"), 45000).catch(async () => {
    await page.evaluate(() => document.querySelector('[data-testid="chat-refresh-providers"]')?.click());
    await waitFor(page, () => document.body.innerText.includes("Astra Relay Smoke"), 15000);
  });

  await page.evaluate((id) => document.querySelector(`[data-testid="agent-row-${id}"]`)?.click(), namespacedAgentId(astraId));
  await verifyLaptopChatDrawer(page);
  log("sending Astra relay chat");
  await sendAndAssert(page, "Astra", `smoke hello astra ${smokeId}`, `Astra Relay Smoke received: smoke hello astra ${smokeId}`);
  log("Astra relay chat verified");

  await selectRelayAgent(page, namespacedAgentId(nyxieId), nyxieId);
  log("sending Nyxie relay chat");
  await sendAndAssert(page, "Nyxie", `smoke hello nyxie ${smokeId}`, `Nyxie Relay Smoke received: smoke hello nyxie ${smokeId}`);
  log("Nyxie relay chat verified");

  log("checking persistence after leaving and returning");
  await page.evaluate(() => document.querySelector(".back-button")?.click());
  await waitFor(page, () => document.body.innerText.includes("Welcome back"), 10000);
  await page.evaluate((id) => document.querySelector(`[data-testid="agent-row-${id}"]`)?.click(), namespacedAgentId(astraId));
  await waitFor(page, () => document.body.innerText.includes("Astra Relay Smoke"), 10000);
  await selectRelayAgent(page, namespacedAgentId(nyxieId), nyxieId);
  await waitFor(page, (expected) => document.body.innerText.includes(expected), 15000, `Nyxie Relay Smoke received: smoke hello nyxie ${smokeId}`);
  log("persistence verified");
}

async function verifyLaptopChatDrawer(page) {
  await waitFor(page, () => {
    const toggle = document.querySelector('.chat-drawer-toggle');
    return Boolean(toggle && getComputedStyle(toggle).display !== 'none');
  }, 10000);
  await page.evaluate(() => document.querySelector('.chat-drawer-toggle')?.click());
  await waitFor(page, () => document.querySelector('.chat-profile')?.classList.contains('drawer-open'), 5000);
  await page.evaluate(() => document.querySelector('.chat-drawer-close')?.click());
  await waitFor(page, () => !document.querySelector('.chat-profile')?.classList.contains('drawer-open'), 5000);
  log("laptop chat drawer verified");
}

async function selectRelayAgent(page, optionAgentId, routeAgentId) {
  await page.evaluate((agentId) => {
    const select = document.querySelector('[data-testid="relay-agent-select"]');
    const option = Array.from(select.options).find((item) => item.value.endsWith(`::${agentId}`));
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, optionAgentId);
  await waitFor(page, (agentId) => {
    const select = document.querySelector('[data-testid="relay-agent-select"]');
    return Boolean(select?.value.endsWith(`::${agentId}`));
  }, 10000, optionAgentId);
}

async function sendAndAssert(page, agentName, message, expectedResponse) {
  await waitFor(page, () => Boolean(document.querySelector('[data-testid="chat-input"], .chat-composer input')), 15000);
  await page.evaluate((text) => {
    const input = document.querySelector('[data-testid="chat-input"], .chat-composer input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, message);
  await waitFor(page, () => !document.querySelector('[data-testid="chat-send"], .send-button')?.disabled, 15000);
  await page.evaluate(() => document.querySelector('[data-testid="chat-send"], .send-button')?.click());
  await waitFor(page, (text) => document.body.innerText.includes(text), 10000, message);
  await waitFor(page, () => Boolean(document.querySelector('[data-testid="thinking-row"], .typing-row')), 10000);
  await waitFor(page, (text) => document.body.innerText.includes(text), 30000, expectedResponse);
  await waitFor(page, () => !document.querySelector('[data-testid="thinking-row"]'), 10000);
  const state = await page.evaluate((input) => ({
    userVisible: Array.from(document.querySelectorAll('[data-testid="chat-message-user"]')).some((node) => node.textContent.includes(input.message)),
    assistantVisible: Array.from(document.querySelectorAll('[data-testid="chat-message-agent"]')).some((node) => node.textContent.includes(input.expectedResponse)),
    thinkingVisible: Boolean(document.querySelector('[data-testid="thinking-row"]')),
    body: document.body.innerText
  }), { message, expectedResponse });
  assert(state.userVisible, `${agentName} user bubble disappeared.`);
  assert(!state.thinkingVisible, `${agentName} thinking row did not clear.`);
  assert(state.assistantVisible, `${agentName} assistant response did not appear.`);
}

async function pairDevice() {
  const created = await jsonFetch(`${relayHttpUrl}/v1/pairing/create`, { method: "POST", body: "{}" });
  const code = created.pairing.code;
  await jsonFetch(`${relayHttpUrl}/v1/pairing/claim`, {
    method: "POST",
    body: JSON.stringify({
      code,
      device: {
        id: deviceId,
        name: "Relay Smoke Rig",
        type: "pc",
        location: "Local",
        agentVersion: "smoke",
        fingerprint: deviceId
      }
    })
  });
  await jsonFetch(`${relayHttpUrl}/v1/pairing/approve`, { method: "POST", body: JSON.stringify({ code }) });
  return code;
}

async function connectMockRelayDevice(pairingCode) {
  const socket = new WebSocket(`${relayDeviceUrl}?deviceId=${encodeURIComponent(deviceId)}&pairingToken=${encodeURIComponent(pairingCode)}`);
  await onceOpen(socket);
  sendEnvelope(socket, "device.hello", {
    deviceId,
    deviceName: "Relay Smoke Rig",
    name: "Relay Smoke Rig",
    platform: "win32",
    service: "desktop-smoke",
    fingerprint: deviceId
  });
  await delay(200);
  const providers = [{
    id: providerId,
    kind: "mock",
    name: "Relay Smoke Provider",
    status: "available",
    endpoint: "relay-smoke",
    capabilities: ["chat"],
    agents: [
      { id: astraId, name: "Astra Relay Smoke", role: "Smoke agent", status: "online", capabilities: ["chat"] },
      { id: nyxieId, name: "Nyxie Relay Smoke", role: "Smoke agent", status: "online", capabilities: ["chat"] }
    ]
  }];
  sendEnvelope(socket, "device.provider.snapshot", { deviceId, activeProviderId: providerId, providers });
  sendEnvelope(socket, "agent.roster.snapshot", { deviceId, providerId, agents: providers[0].agents.map((agent) => ({ ...agent, providerId, deviceId })) });
  socket.addEventListener("message", (event) => {
    void (async () => {
    const envelope = JSON.parse(await readSocketData(event.data));
    if (envelope.type !== "agent.chat.request") return;
    const payload = envelope.payload ?? {};
    const name = payload.agent === nyxieId ? "Nyxie Relay Smoke" : "Astra Relay Smoke";
    setTimeout(() => {
      sendEnvelope(socket, "agent.chat.response", {
        providerId: payload.providerId,
        agent: payload.agent,
        sessionId: payload.sessionId,
        text: `${name} received: ${payload.message}`,
        runtime: "relay-smoke"
      }, { replyTo: envelope.id, correlationId: envelope.id });
    }, 500);
    })();
  });
  return socket;
}

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

function sendEnvelope(socket, type, payload, options = {}) {
  socket.send(JSON.stringify({
    v: 1,
    id: `smoke_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
    type,
    timestamp: new Date().toISOString(),
    source: { kind: "device", id: deviceId },
    deviceId,
    payload,
    ...options
  }));
}

async function connectCdp() {
  const tabs = await waitForJson(`http://127.0.0.1:${debugPort}/json`, (items) => items.find((item) => item.type === "page" && item.webSocketDebuggerUrl), 45000);
  cdpSocket = new WebSocket(tabs.webSocketDebuggerUrl);
  await onceOpen(cdpSocket);
  let id = 0;
  const callbacks = new Map();
  cdpSocket.addEventListener("message", (event) => {
    void (async () => {
    const message = JSON.parse(await readSocketData(event.data));
    if (!message.id || !callbacks.has(message.id)) return;
    const { resolveCall, rejectCall } = callbacks.get(message.id);
    callbacks.delete(message.id);
    message.error ? rejectCall(new Error(message.error.message)) : resolveCall(message.result);
    })();
  });
  const send = (method, params = {}) => withTimeout(new Promise((resolveCall, rejectCall) => {
    const callId = ++id;
    callbacks.set(callId, { resolveCall, rejectCall });
    cdpSocket.send(JSON.stringify({ id: callId, method, params }));
  }), 8000, `CDP ${method} timed out`);
  await send("Runtime.enable");
  await send("Page.enable");
  return {
    async evaluate(fn, ...args) {
      const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    }
  };
}

async function waitFor(page, predicate, timeoutMs, ...args) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await page.evaluate(predicate, ...args).catch(() => undefined);
    if (result) return result;
    await delay(250);
  }
  const debug = page ? await page.evaluate(() => ({
    text: document.body.innerText.slice(0, 1200),
    conversation: document.querySelector(".conversation-panel")?.outerHTML.slice(0, 2000) ?? ""
  })).catch(() => ({ text: "", conversation: "" })) : { text: "", conversation: "" };
  throw new Error(`Timed out after ${timeoutMs}ms waiting for UI condition.${debug.text ? `\n\nUI text:\n${debug.text}` : ""}${debug.conversation ? `\n\nConversation HTML:\n${debug.conversation}` : ""}`);
}

async function waitForUrl(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(300);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForJson(url, select, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      const json = await response.json();
      const selected = select(json);
      if (selected) return selected;
    } catch {}
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error ?? `HTTP ${response.status} from ${url}`);
  return payload;
}

function spawnManaged(command, args, { cwd, env, label }) {
  const child = spawn(command, args, { cwd, env, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  child.on("exit", (code) => {
    if (code && code !== 143 && code !== 130) process.stderr.write(`[${label}] exited with ${code}\n`);
  });
  processes.push(child);
  return child;
}

function run(command, args, { cwd }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, shell: true, stdio: "inherit" });
    child.on("exit", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${command} ${args.join(" ")} exited ${code}`)));
  });
}

async function stopProcesses() {
  for (const child of processes.reverse()) {
    if (process.platform === "win32" && child.pid) {
      await new Promise((resolveStop) => {
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" }).once("exit", resolveStop);
      });
      continue;
    }
    child.kill();
  }
}

async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  cdpSocket?.close();
  deviceSocket?.close();
  await stopProcesses();
  await delay(300);
  rmSync(stateDir, { recursive: true, force: true });
  removeOldSmokeTempDirs();
}

function removeOldSmokeTempDirs() {
  const tempRoot = tmpdir();
  for (const entry of readdirSync(tempRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("project-reika-relay-smoke-")) continue;
    const target = join(tempRoot, entry.name);
    if (!target.startsWith(tempRoot)) continue;
    rmSync(target, { recursive: true, force: true });
  }
}

function onceOpen(socket) {
  return new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
}

async function readSocketData(data) {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data);
}

function namespacedAgentId(agentId) {
  return `relay:${deviceId}:${providerId}:${agentId}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function log(message) {
  console.error(`[smoke] ${message}`);
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]);
}
