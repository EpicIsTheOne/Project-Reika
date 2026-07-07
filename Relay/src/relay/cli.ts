#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type RelayAction = "status" | "start" | "stop" | "restart" | "update" | "help";
type ServiceMode = "system" | "user";

interface CliOptions {
  action: RelayAction;
  service: string;
  mode: ServiceMode;
  repo: string;
  healthUrl: string;
  noRestart: boolean;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

const defaultService = process.env.REIKA_RELAY_SERVICE || "reika-relay";
const defaultHealthUrl = process.env.REIKA_RELAY_HEALTH_URL || `http://127.0.0.1:${process.env.REIKA_RELAY_PORT || "8790"}/v1/health`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.action === "help") {
    console.log(helpText());
    return;
  }

  if (options.action === "status") {
    await printStatus(options);
    return;
  }

  if (options.action === "update") {
    await updateRelay(options);
    return;
  }

  await runServiceAction(options.action, options);
  await printStatus(options);
}

function parseArgs(argv: string[]): CliOptions {
  const first = argv[0] || "status";
  const action = normalizeAction(first);
  let index = first === action ? 1 : 0;
  const options: CliOptions = {
    action,
    service: defaultService,
    mode: process.env.REIKA_RELAY_SYSTEMD_MODE === "user" ? "user" : "system",
    repo: findRepoRoot(),
    healthUrl: defaultHealthUrl,
    noRestart: false
  };

  while (index < argv.length) {
    const arg = argv[index];
    switch (arg) {
      case "--service":
        options.service = readValue(argv, index, arg);
        index += 2;
        break;
      case "--user":
        options.mode = "user";
        index += 1;
        break;
      case "--system":
        options.mode = "system";
        index += 1;
        break;
      case "--repo":
        options.repo = resolve(readValue(argv, index, arg));
        index += 2;
        break;
      case "--url":
      case "--health-url":
        options.healthUrl = readValue(argv, index, arg);
        index += 2;
        break;
      case "--no-restart":
        options.noRestart = true;
        index += 1;
        break;
      case "--help":
      case "-h":
        options.action = "help";
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${helpText()}`);
    }
  }

  return options;
}

function normalizeAction(value: string): RelayAction {
  if (value === "status" || value === "start" || value === "stop" || value === "restart" || value === "update" || value === "help" || value === "--help" || value === "-h") {
    return value === "--help" || value === "-h" ? "help" : value;
  }
  throw new Error(`Unknown relay action: ${value}\n\n${helpText()}`);
}

function readValue(args: string[], index: number, name: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${name} requires a value.`);
  return value;
}

async function updateRelay(options: CliOptions) {
  if (!existsSync(resolve(options.repo, ".git"))) {
    throw new Error(`Relay update requires a git checkout. Could not find .git at ${options.repo}.`);
  }

  const before = await serviceIsActive(options).catch(() => false);
  console.log(`Repo: ${options.repo}`);
  console.log(`Service: ${options.service} (${options.mode})`);
  console.log("Fetching relay update...");
  await run("git", ["fetch", "origin"], options.repo);
  const branch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], options.repo)).stdout.trim();
  if (!branch || branch === "HEAD") throw new Error("Refusing relay update from a detached HEAD checkout.");
  console.log(`Branch: ${branch}`);
  console.log("Pulling fast-forward changes...");
  const pull = await run("git", ["pull", "--ff-only", "origin", branch], options.repo);
  if (pull.stdout.trim() || pull.stderr.trim()) console.log(cleanOutput(pull));

  console.log("Installing dependencies...");
  await run("npm", ["install"], options.repo);

  console.log("Building relay...");
  await run("npm", ["run", "build", "--workspace", "project-reika-relay"], options.repo);

  if (!options.noRestart && before) {
    console.log("Restarting relay service...");
    await runServiceAction("restart", options, false);
  } else if (options.noRestart) {
    console.log("Relay service restart skipped by --no-restart.");
  } else {
    console.log("Relay service was not active before update; leaving it stopped.");
  }

  await printStatus(options);
}

async function printStatus(options: CliOptions) {
  console.log(`Service: ${options.service} (${options.mode})`);
  const systemd = await systemctl(["is-active", options.service], options).catch((error) => ({ stdout: "", stderr: error instanceof Error ? error.message : String(error) }));
  const active = systemd.stdout.trim() || systemd.stderr.trim() || "unknown";
  console.log(`Systemd: ${active}`);

  const health = await getHealth(options.healthUrl).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  if (health.ok) {
    const summary = health as Record<string, unknown>;
    console.log(`Health: ok (${options.healthUrl})`);
    console.log(`Devices: ${String(summary.deviceCount ?? "unknown")}`);
    console.log(`App sockets: ${String(summary.appSocketCount ?? "unknown")}`);
    console.log(`Store: ${String(summary.storePath ?? "unknown")}`);
  } else {
    console.log(`Health: offline (${options.healthUrl})`);
    console.log(`Reason: ${String((health as { error?: string }).error || "unknown")}`);
  }
}

async function runServiceAction(action: Exclude<RelayAction, "status" | "update" | "help">, options: CliOptions, echo = true) {
  if (echo) console.log(`${capitalize(action)} relay service ${options.service} (${options.mode})...`);
  await systemctl([action, options.service], options);
}

async function serviceIsActive(options: CliOptions) {
  const result = await systemctl(["is-active", options.service], options);
  return result.stdout.trim() === "active";
}

async function systemctl(args: string[], options: CliOptions) {
  const fullArgs = options.mode === "user" ? ["--user", ...args] : args;
  return run("systemctl", fullArgs, options.repo);
}

async function run(command: string, args: string[], cwd: string): Promise<CommandResult> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 16
  });
  return { stdout: stdout || "", stderr: stderr || "" };
}

function getHealth(url: string) {
  return new Promise<Record<string, unknown>>((resolveHealth, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const request = client.get(parsed, { timeout: 5000 }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`HTTP ${response.statusCode || "unknown"} ${raw}`.trim()));
          return;
        }
        try {
          resolveHealth(JSON.parse(raw) as Record<string, unknown>);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error("Relay health request timed out."));
    });
    request.on("error", reject);
  });
}

function findRepoRoot(start = process.cwd()) {
  let current = resolve(start);
  for (;;) {
    if (existsSync(resolve(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

function cleanOutput(result: CommandResult) {
  return `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`.trim();
}

function capitalize(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function helpText() {
  return [
    "Project Reika Relay CLI",
    "",
    "Usage:",
    "  reika-relay status                 Show systemd and /v1/health status",
    "  reika-relay update                 Pull, install, build, and restart if active",
    "  reika-relay start                  Start the relay systemd service",
    "  reika-relay stop                   Stop the relay systemd service",
    "  reika-relay restart                Restart the relay systemd service",
    "",
    "Options:",
    "  --service <name>      systemd service name. Default: reika-relay",
    "  --user                Use systemctl --user",
    "  --system              Use system systemctl. Default",
    "  --repo <path>         Project Reika checkout. Default: nearest git root",
    "  --url <url>           Relay health URL. Default: http://127.0.0.1:8790/v1/health",
    "  --no-restart          Update without restarting the service",
    "",
    "Environment:",
    "  REIKA_RELAY_SERVICE       Default service name",
    "  REIKA_RELAY_SYSTEMD_MODE  system or user",
    "  REIKA_RELAY_HEALTH_URL    Default health URL",
    "  REIKA_RELAY_PORT          Health port fallback",
    "",
    "Examples:",
    "  reika-relay status --url https://relay.example.com/v1/health",
    "  reika-relay update --service reika-relay",
    "  reika-relay restart --user --service reika-relay"
  ].join("\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
