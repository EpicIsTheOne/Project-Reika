import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { app } from "electron";

export interface LocalAgentRuntime {
  url: string;
  started: boolean;
  logPath?: string;
  stop: () => void;
}

interface LocalAgentOptions {
  target?: string;
  exePath?: string;
  host?: string;
  port?: number;
  waitMs?: number;
}

let child: ChildProcessWithoutNullStreams | undefined;

export async function ensureLocalAgent(options: LocalAgentOptions = {}): Promise<LocalAgentRuntime> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 47840;
  const url = options.target ?? `http://${host}:${port}`;

  if (await isAgentReady(url)) {
    return { url, started: false, stop: () => undefined };
  }

  const exePath = options.exePath ?? resolveBundledAgentPath();
  if (!exePath || !existsSync(exePath)) {
    return { url, started: false, stop: () => undefined };
  }

  const logPath = join(app.getPath("userData"), "logs", "reika-node.log");
  mkdirSync(dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath, { flags: "a" });
  log.write(`\n[${new Date().toISOString()}] starting ${exePath}\n`);
  const userDataPath = app.getPath("userData");

  child = spawn(exePath, [], {
    cwd: userDataPath,
    env: {
      ...process.env,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME || join(userDataPath, "data"),
      REIKA_AGENT_HOST: host,
      REIKA_AGENT_PORT: String(port),
      REIKA_PAIRING_UI_OPEN: "false"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once("exit", (code, signal) => {
    log.write(`[${new Date().toISOString()}] exited code=${code ?? "null"} signal=${signal ?? "null"}\n`);
  });

  const ready = await waitForAgent(url, options.waitMs ?? 8000);
  if (!ready) {
    log.write(`[${new Date().toISOString()}] startup timed out waiting for ${url}\n`);
  }
  return { url, started: true, logPath, stop: stopLocalAgent };
}

export function stopLocalAgent() {
  if (!child || child.killed) return;
  child.kill();
  child = undefined;
}

export async function stopLocalAgentAndWait(timeoutMs = 5000) {
  const activeChild = child;
  child = undefined;
  if (!activeChild || activeChild.exitCode !== null) return;
  activeChild.kill();
  await Promise.race([
    new Promise<void>((resolveExit) => activeChild.once("exit", () => resolveExit())),
    sleep(timeoutMs)
  ]);
  if (activeChild.exitCode === null) throw new Error("Local Reika agent did not stop within five seconds.");
}

export function getLocalAgentExecutablePath(): string {
  const executablePath = resolveBundledAgentPath();
  if (!executablePath) throw new Error("Local Reika agent executable path is not configured.");
  return executablePath;
}

function resolveBundledAgentPath() {
  if (process.env.REIKA_NODE_EXE || process.env.AGENTHUB_AGENT_EXE) return process.env.REIKA_NODE_EXE ?? process.env.AGENTHUB_AGENT_EXE;
  if (app.isPackaged) return join(process.resourcesPath, "reika-node", "reika-node.exe");
  return resolve(__dirname, "../../../server/release/reika-node.exe");
}

async function waitForAgent(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isAgentReady(url)) return true;
    await sleep(250);
  }
  return false;
}

async function isAgentReady(url: string) {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(800) });
    if (!response.ok) return false;
    const body = (await response.json()) as { ok?: boolean; service?: string };
    return body.ok === true && (body.service === "project-reika-node" || body.service === "project-reika-agent-server");
  } catch {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
