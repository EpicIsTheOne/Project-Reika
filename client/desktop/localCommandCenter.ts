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
  let relayUrl = String(process.env.REIKA_RELAY_TARGET || process.env.AGENTHUB_RELAY_TARGET || "").trim();
  try {
    const response = await fetch(`${agentUrl}/state`, { signal: AbortSignal.timeout(2500) });
    const state = await response.json() as { settings?: { relayUrl?: string }; uplink?: { relayUrl?: string } };
    relayUrl = String(state.settings?.relayUrl || state.uplink?.relayUrl || relayUrl).trim();
  } catch {}
  if (!relayUrl) relayUrl = "https://relay.techexplore.us/v1/app";
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
