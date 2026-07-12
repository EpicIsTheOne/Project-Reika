import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const smokeId = `memory-mesh-relay-${Date.now().toString(36)}`;
const stateDir = join(tmpdir(), `project-reika-${smokeId}`);
const relayPort = await freePort();
const agentPort = await freePort();
const relayDeviceUrl = `ws://127.0.0.1:${relayPort}/v1/device`;
const relayHttpUrl = `http://127.0.0.1:${relayPort}`;
const agentHttpUrl = `http://127.0.0.1:${agentPort}`;
const deviceId = `${smokeId}-server`;
const providerId = `${smokeId}-provider`;
const astraId = `${smokeId}-astra`;
const processes = [];
let deviceSocket;

await cleanupOldStateDirs();
mkdirSync(stateDir, { recursive: true });

try {
  await main();
  console.log("Memory Mesh relay smoke passed: natural chat resolution, remote selection, websocket execution, lifecycle metadata, correlated result, and project-memory writeback.");
} finally {
  deviceSocket?.close();
  await stopProcesses();
  await delay(700);
  await removeStateDir(stateDir, false);
  if (existsSync(stateDir)) scheduleDeferredCleanup(stateDir);
}

async function main() {
  const env = {
    ...process.env,
    BROWSER: "none",
    REIKA_RELAY_URL: relayDeviceUrl,
    REIKA_RELAY_PORT: String(relayPort),
    REIKA_AGENT_PORT: String(agentPort),
    REIKA_AUTO_PAIR_LOCAL_RELAY: "false",
    REIKA_PAIRING_UI: "false",
    REIKA_PAIRING_UI_OPEN: "false",
    REIKA_RELAY_STORE_PATH: join(stateDir, "relay-store.json"),
    REIKA_MEMORY_MESH_PATH: join(stateDir, "memory-mesh.sqlite"),
    REIKA_SETTINGS_STORE_PATH: join(stateDir, "settings.json"),
    REIKA_SESSION_STORE_PATH: join(stateDir, "sessions.json"),
    REIKA_FILE_STORE_DIR: join(stateDir, "files"),
    REIKA_ART_STORE_PATH: join(stateDir, "art.json"),
    REIKA_NOTIFICATION_STORE_PATH: join(stateDir, "notifications.json")
  };

  spawnManaged(process.execPath, ["Relay/dist/relay/server.js"], { env, label: "relay" });
  await waitForUrl(`${relayHttpUrl}/v1/health`, 30_000);
  const pairingCode = await pairDevice();
  deviceSocket = await connectMockDevice(pairingCode);

  spawnManaged(process.execPath, ["server/dist/main.js", "--no-ui"], { env, label: "agent" });
  await waitForUrl(`${agentHttpUrl}/health`, 60_000);

  const discovery = await jsonFetch(`${agentHttpUrl}/memory-mesh/discovery/sync`, { method: "POST", body: "{}" });
  assert(discovery.discovery.syncedRelayDevices >= 1, "Remote relay device was not discovered.");
  const overview = await jsonFetch(`${agentHttpUrl}/memory-mesh/overview`);
  const remoteAgent = overview.agents.find((agent) => agent.providerAgentId === astraId && agent.deviceId === deviceId);
  const remoteDevice = overview.devices.find((device) => device.id === deviceId);
  const localDevice = overview.devices.find((device) => device.id !== deviceId);
  assert(remoteAgent, "Remote Astra registry record is missing.");
  assert(remoteDevice?.status === "online", "Remote device is not online in Memory Mesh.");
  assert(localDevice, "Local source device is missing.");

  const project = (await jsonFetch(`${agentHttpUrl}/memory-mesh/projects`, {
    method: "POST",
    body: JSON.stringify({ id: `${smokeId}-project`, name: "Remote Mesh Project", aliases: ["RMP"], description: "Relay smoke project." })
  })).project;
  await jsonFetch(`${agentHttpUrl}/memory-mesh/projects/${project.id}/agents`, {
    method: "POST",
    body: JSON.stringify({ agentId: remoteAgent.id, role: "primary", access: "read_write" })
  });
  await jsonFetch(`${agentHttpUrl}/memory-mesh/projects/${project.id}/devices`, {
    method: "POST",
    body: JSON.stringify({ deviceId, isPrimary: true, path: "/srv/remote-mesh-project" })
  });
  await jsonFetch(`${agentHttpUrl}/memory-mesh/memories`, {
    method: "POST",
    body: JSON.stringify({
      content: "Remote validation context 5821.",
      scope: "project",
      projectId: project.id,
      createdBy: "user",
      source: "relay-smoke",
      permissions: { visibility: "project", access: "read_write" }
    })
  });

  const response = await jsonFetch(`${agentHttpUrl}/memory-mesh/tasks`, {
    method: "POST",
    body: JSON.stringify({
      projectQuery: "RMP",
      task: "Confirm remote Memory Mesh execution marker 5821.",
      requiredCapabilities: ["chat"],
      currentDeviceId: localDevice.id
    })
  });
  assert(response.task.status === "completed", `Remote task did not complete: ${response.task.error || response.task.status}`);
  assert(response.task.decision.agent?.id === remoteAgent.id, "Memory Mesh selected the wrong remote agent.");
  assert(response.task.decision.executeLocally === false, "Remote route was incorrectly marked local.");
  assert(response.task.result.includes("Astra Relay Mesh received"), "Remote Astra result did not return to the source request.");
  assert(response.task.result.includes("Remote validation context 5821"), "Permission-filtered project context was not delivered.");

  const naturalChat = await jsonFetch(`${agentHttpUrl}/chat`, {
    method: "POST",
    body: JSON.stringify({
      providerId: "mock-local",
      agent: "reika",
      message: "Can you check Remote Mesh Project and confirm natural delegation marker 7331?"
    })
  });
  assert(naturalChat.result.runtime === "memory-mesh", "Natural project request did not enter the Memory Mesh chat path.");
  assert(naturalChat.text.includes("Astra Relay Mesh received"), "Natural chat did not return the remote Astra result.");
  assert(naturalChat.message.meta?.memoryMesh?.status === "completed", "Natural chat did not persist completed delegation metadata.");
  assert(naturalChat.message.meta.memoryMesh.targetAgentId === remoteAgent.id, "Natural chat selected the wrong agent.");
  const stages = naturalChat.message.meta.memoryMesh.lifecycle.map((item) => item.stage);
  for (const stage of ["resolving", "route_planned", "delegating", "working", "memory_updated", "completed"]) {
    assert(stages.includes(stage), `Natural chat lifecycle is missing ${stage}.`);
  }

  const failedChat = await jsonFetch(`${agentHttpUrl}/chat`, {
    method: "POST",
    body: JSON.stringify({ providerId: "mock-local", agent: "reika", message: "Please check Remote Mesh Project with FAIL_REMOTE_9902." })
  });
  assert(failedChat.result.runtime === "memory-mesh", "Failed remote work escaped the Memory Mesh path.");
  assert(failedChat.message.meta.memoryMesh.status === "failed", "Remote failure was not returned to the original conversation.");
  assert(failedChat.text.includes("failed"), "Remote failure did not produce an explanatory assistant result.");

  const readOnlyProject = (await jsonFetch(`${agentHttpUrl}/memory-mesh/projects`, {
    method: "POST",
    body: JSON.stringify({ name: "Read Only Mesh", description: "Permission denial smoke project." })
  })).project;
  await jsonFetch(`${agentHttpUrl}/memory-mesh/projects/${readOnlyProject.id}/agents`, { method: "POST", body: JSON.stringify({ agentId: remoteAgent.id, role: "primary", access: "read_only" }) });
  await jsonFetch(`${agentHttpUrl}/memory-mesh/projects/${readOnlyProject.id}/devices`, { method: "POST", body: JSON.stringify({ deviceId, isPrimary: true, path: "/srv/read-only" }) });
  const readOnlyChat = await jsonFetch(`${agentHttpUrl}/chat`, { method: "POST", body: JSON.stringify({ providerId: "mock-local", agent: "reika", message: "Please update Read Only Mesh." }) });
  assert(readOnlyChat.message.meta.memoryMesh.status === "unavailable", "Read-only project assignment did not fail closed.");

  for (const name of ["Ambiguous Alpha", "Ambiguous Beta"]) {
    await jsonFetch(`${agentHttpUrl}/memory-mesh/projects`, { method: "POST", body: JSON.stringify({ name, aliases: ["Shared Mesh Alias"] }) });
  }
  const ambiguousChat = await jsonFetch(`${agentHttpUrl}/chat`, { method: "POST", body: JSON.stringify({ providerId: "mock-local", agent: "reika", message: "Please update Shared Mesh Alias." }) });
  assert(ambiguousChat.message.meta.memoryMesh.status === "ambiguous", "Ambiguous project reference did not request clarification.");
  assert(ambiguousChat.text.includes("Which one"), "Ambiguous project response is missing clarification text.");

  const missingChat = await jsonFetch(`${agentHttpUrl}/chat`, { method: "POST", body: JSON.stringify({ providerId: "mock-local", agent: "reika", message: "Please update Totally Unknown Nebula Project." }) });
  assert(missingChat.result.runtime === "mock", "Unknown project reference should fall back to ordinary provider chat.");

  const pendingCancellation = fetch(`${agentHttpUrl}/memory-mesh/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectQuery: "RMP", task: "HOLD_REMOTE_7714 then confirm cancellation.", currentDeviceId: localDevice.id })
  });
  const pendingTask = await waitForRoutingTask(agentHttpUrl, "HOLD_REMOTE_7714");
  const cancelledTask = await jsonFetch(`${agentHttpUrl}/memory-mesh/tasks/${pendingTask.id}/cancel`, { method: "POST", body: "{}" });
  assert(cancelledTask.task.status === "cancelled", "Running remote task did not accept cancellation.");
  const cancelledResponse = await (await pendingCancellation).json();
  assert(cancelledResponse.task.status === "cancelled", "Cancelled status did not return to the originating task request.");

  deviceSocket.close();
  await delay(350);
  await jsonFetch(`${agentHttpUrl}/memory-mesh/discovery/sync`, { method: "POST", body: "{}" });
  const offlineChat = await jsonFetch(`${agentHttpUrl}/chat`, { method: "POST", body: JSON.stringify({ providerId: "mock-local", agent: "reika", message: "Please check Remote Mesh Project after the server went offline." }) });
  assert(offlineChat.message.meta.memoryMesh.status === "unavailable", "Offline remote ownership did not fail closed in chat.");

  const memories = await jsonFetch(`${agentHttpUrl}/memory-mesh/memories?projectId=${encodeURIComponent(project.id)}&limit=20`);
  assert(memories.memories.some((memory) => memory.source === `routing-task:${response.task.id}`), "Completed remote result was not written to project memory.");
}

async function pairDevice() {
  const created = await jsonFetch(`${relayHttpUrl}/v1/pairing/create`, { method: "POST", body: "{}" });
  const code = created.pairing.code;
  await jsonFetch(`${relayHttpUrl}/v1/pairing/claim`, {
    method: "POST",
    body: JSON.stringify({ code, device: { id: deviceId, name: "Remote Mesh Server", type: "server", location: "remote", agentVersion: "memory-mesh-smoke", fingerprint: deviceId } })
  });
  await jsonFetch(`${relayHttpUrl}/v1/pairing/approve`, { method: "POST", body: JSON.stringify({ code }) });
  return code;
}

async function connectMockDevice(pairingCode) {
  const socket = new WebSocket(`${relayDeviceUrl}?deviceId=${encodeURIComponent(deviceId)}&pairingToken=${encodeURIComponent(pairingCode)}`);
  await onceOpen(socket);
  sendEnvelope(socket, "device.hello", { deviceId, deviceName: "Remote Mesh Server", name: "Remote Mesh Server", platform: "linux", service: "memory-mesh-smoke", fingerprint: deviceId });
  await delay(150);
  const providers = [{
    id: providerId,
    kind: "mock",
    name: "Remote Mesh Provider",
    status: "available",
    endpoint: "relay-smoke",
    capabilities: ["chat"],
    agents: [{ id: astraId, name: "Astra Relay Mesh", role: "Remote project owner", status: "online", capabilities: ["chat"] }]
  }];
  sendEnvelope(socket, "device.provider.snapshot", { deviceId, activeProviderId: providerId, providers });
  sendEnvelope(socket, "agent.roster.snapshot", { deviceId, providerId, agents: providers[0].agents.map((agent) => ({ ...agent, providerId, deviceId })) });
  socket.addEventListener("message", (event) => {
    void (async () => {
    const envelope = JSON.parse(await readSocketData(event.data));
    if (envelope.type !== "agent.chat.request") return;
    const message = String(envelope.payload.message || "");
    if (message.includes("FAIL_REMOTE_9902")) {
      sendEnvelope(socket, "command.failed", { message: "Simulated Astra failure 9902." }, { replyTo: envelope.id, correlationId: envelope.id });
      return;
    }
    if (message.includes("HOLD_REMOTE_7714")) await delay(2_000);
    sendEnvelope(socket, "agent.chat.response", {
      providerId: envelope.payload.providerId,
      agent: envelope.payload.agent,
      sessionId: envelope.payload.sessionId,
      text: `Astra Relay Mesh received: ${envelope.payload.message}`,
      runtime: "relay-smoke"
    }, { replyTo: envelope.id, correlationId: envelope.id });
    })();
  });
  return socket;
}

async function waitForRoutingTask(baseUrl, marker, timeoutMs = 5_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await jsonFetch(`${baseUrl}/memory-mesh/tasks?limit=50`);
    const task = response.tasks.find((item) => item.request.includes(marker));
    if (task) return task;
    await delay(50);
  }
  throw new Error(`Timed out waiting for routing task ${marker}.`);
}

function sendEnvelope(socket, type, payload, options = {}) {
  socket.send(JSON.stringify({
    v: 1,
    id: `mesh_smoke_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
    type,
    timestamp: new Date().toISOString(),
    source: { kind: "device", id: deviceId },
    deviceId,
    payload,
    ...options
  }));
}

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status} from ${url}`);
  return payload;
}

async function waitForUrl(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
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

function spawnManaged(command, args, { env, label }) {
  const child = spawn(command, args, { cwd: root, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  processes.push(child);
}

async function stopProcesses() {
  for (const child of processes.reverse()) {
    if (child.exitCode !== null || child.signalCode) continue;
    const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
    child.kill();
    await Promise.race([exited, delay(3_000)]);
  }
}

async function cleanupOldStateDirs() {
  const tempRoot = tmpdir();
  for (const entry of readdirSync(tempRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("project-reika-memory-mesh-relay-")) continue;
    const target = join(tempRoot, entry.name);
    if (!target.startsWith(tempRoot)) continue;
    await removeStateDir(target, false);
  }
}

async function removeStateDir(target, strict = true) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      rmSync(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  if (strict) throw lastError;
}

function scheduleDeferredCleanup(target) {
  const code = `const fs=require("fs");const target=process.argv[1];let tries=0;const run=()=>{try{fs.rmSync(target,{recursive:true,force:true});process.exit(0)}catch{if(++tries>120)process.exit(1);setTimeout(run,250)}};setTimeout(run,250);`;
  spawn(process.execPath, ["-e", code, target], { detached: true, stdio: "ignore", windowsHide: true }).unref();
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

function assert(value, message) {
  if (!value) throw new Error(message);
}
