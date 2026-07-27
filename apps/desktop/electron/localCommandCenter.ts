import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { app } from "electron";

export interface LocalCommandCenterRuntime {
  url: string;
  embedToken: string;
  stop: () => void;
}

let child: ChildProcessWithoutNullStreams | undefined;

export async function ensureLocalCommandCenter(agentUrl: string): Promise<LocalCommandCenterRuntime> {
  const host = "127.0.0.1";
  const port = await reservePort(host);
  const url = `http://${host}:${port}/`;
  const embedToken = randomBytes(32).toString("hex");
  const runtimeDir = join(app.getPath("userData"), "command-center");
  const dataDir = join(runtimeDir, "data");
  const logsDir = join(app.getPath("userData"), "logs");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  provisionEmbeddedAuth(dataDir);
  await provisionRelaySettings(dataDir, agentUrl);

  const entry = join(app.getAppPath(), "node_modules", "openclaw-command-center", "server", "index.js");
  const log = createWriteStream(join(logsDir, "command-center.log"), { flags: "a" });
  child = spawn(process.execPath, [entry], {
    cwd: runtimeDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HOST: host,
      PORT: String(port),
      BASE_PATH: "",
      LOCAL_API_ENABLED: "false",
      DEMO_MODE: "false",
      COMMANDCENTER_RELAY_ONLY: "true",
      NODE_ENV: "reika-embedded",
      REIKA_EMBED_TOKEN: embedToken,
      COMMANDCENTER_DATA_DIR: dataDir
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });

  if (!await waitForReady(url, 12_000)) {
    stopLocalCommandCenter();
    throw new Error("Local Command Center did not become ready.");
  }
  return { url, embedToken, stop: stopLocalCommandCenter };
}

export function stopLocalCommandCenter() {
  if (!child || child.killed) return;
  child.kill();
  child = undefined;
}

function provisionEmbeddedAuth(dataDir: string) {
  const salt = randomBytes(16).toString("hex");
  const passwordHash = `${salt}:${scryptSync(randomBytes(32), salt, 64).toString("hex")}`;
  writeFileSync(join(dataDir, "ui-auth.json"), JSON.stringify({ passwordHash }, null, 2) + "\n", { mode: 0o600 });
}

async function provisionRelaySettings(dataDir: string, agentUrl: string) {
  const configuredRelayTarget = String(process.env.REIKA_RELAY_TARGET || process.env.AGENTHUB_RELAY_TARGET || "").trim();
  let discoveredRelayUrl = "";
  try {
    const response = await fetch(`${agentUrl}/state`, { signal: AbortSignal.timeout(2500) });
    const state = await response.json() as { settings?: { relayUrl?: string }; uplink?: { relayUrl?: string } };
    discoveredRelayUrl = String(state.settings?.relayUrl || state.uplink?.relayUrl || "").trim();
  } catch {}
  const relayUrl = resolveEmbeddedRelayUrl({ configuredRelayTarget, discoveredRelayUrl }) || "wss://relay.techexplore.us/v1/app";
  writeFileSync(join(dataDir, "direct-chat-settings.json"), JSON.stringify({
    relayEnabled: true,
    relayUrl,
    relayShowDeviceLabels: true
  }, null, 2) + "\n", { mode: 0o600 });
}

async function reservePort(host: string): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForReady(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}api/auth/status`, { signal: AbortSignal.timeout(800) });
      if (response.ok) return true;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  return false;
}


function resolveEmbeddedRelayUrl(input: { configuredRelayTarget?: string; discoveredRelayUrl?: string }) {
  const configured = normalizeCommandCenterRelayUrl(input.configuredRelayTarget);
  const discovered = normalizeCommandCenterRelayUrl(input.discoveredRelayUrl);
  if (configured && !isLocalLoopbackUrl(configured)) return configured;
  if (discovered && !isLocalLoopbackUrl(discovered)) return discovered;
  if (configured) return configured;
  return discovered;
}

function normalizeCommandCenterRelayUrl(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol === "ws:") url.protocol = "http:";
    else if (url.protocol === "wss:") url.protocol = "https:";
    else if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/v1/app";
    } else if (/\/v1\/device\/?$/iu.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/v1\/device\/?$/iu, "/v1/app");
    } else if (!/\/v1\/app\/?$/iu.test(url.pathname)) {
      url.pathname = `${url.pathname.replace(/\/+$/u, "")}/v1/app`;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function isLocalLoopbackUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}
