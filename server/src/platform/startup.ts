import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const WINDOWS_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const WINDOWS_RUN_VALUE = 'ProjectReikaAgentServer';
const LINUX_SERVICE_NAME = 'reika-agent-server.service';

export type StartupMethod = 'windows-run-key' | 'linux-systemd-user' | 'unsupported';

export interface StartupCommandOptions {
  relayUrl?: string;
  deviceId?: string;
}

export interface StartupStatus {
  supported: boolean;
  enabled: boolean;
  method: StartupMethod;
  command?: string;
  configPath?: string;
  message?: string;
}

export async function getStartupStatus(): Promise<StartupStatus> {
  if (process.platform === 'win32') return getWindowsStartupStatus();
  if (process.platform === 'linux') return getLinuxStartupStatus();
  return {
    supported: false,
    enabled: false,
    method: 'unsupported',
    message: 'Startup management is only implemented for Windows and Linux in Phase 1.'
  };
}

export async function enableStartup(options: StartupCommandOptions = {}): Promise<StartupStatus> {
  const command = buildStartupCommand(options);
  if (process.platform === 'win32') return enableWindowsStartup(command);
  if (process.platform === 'linux') return enableLinuxStartup(command);
  return {
    supported: false,
    enabled: false,
    method: 'unsupported',
    command,
    message: 'Startup management is only implemented for Windows and Linux in Phase 1.'
  };
}

export async function disableStartup(): Promise<StartupStatus> {
  if (process.platform === 'win32') return disableWindowsStartup();
  if (process.platform === 'linux') return disableLinuxStartup();
  return {
    supported: false,
    enabled: false,
    method: 'unsupported',
    message: 'Startup management is only implemented for Windows and Linux in Phase 1.'
  };
}

export function buildStartupCommand(options: StartupCommandOptions = {}) {
  const args: string[] = [];
  if (options.relayUrl) {
    args.push('pair', '--relay', options.relayUrl);
    if (options.deviceId) args.push('--device-id', options.deviceId);
  }
  args.push('--no-ui');
  return startupCommandParts(args).map(quoteArg).join(' ');
}

export function formatStartupStatus(status: StartupStatus) {
  return [
    `Startup: ${status.enabled ? 'enabled' : 'disabled'}`,
    `Supported: ${status.supported ? 'yes' : 'no'}`,
    `Method: ${status.method}`,
    status.configPath ? `Config: ${status.configPath}` : undefined,
    status.command ? `Command: ${status.command}` : undefined,
    status.message ? `Note: ${status.message}` : undefined
  ]
    .filter(Boolean)
    .join('\n');
}

function startupCommandParts(extraArgs: string[]) {
  const executable = process.execPath;
  const script = process.argv[1];
  const executableName = path.basename(executable).toLowerCase();
  const scriptLooksRunnable = Boolean(script && /\.(c|m)?js$/i.test(script));
  const parts = executableName.startsWith('node') && scriptLooksRunnable ? [executable, script as string] : [executable];
  return [...parts, ...extraArgs];
}

function quoteArg(value: string) {
  if (process.platform === 'win32') return quoteWindowsArg(value);
  return quotePosixArg(value);
}

function quoteWindowsArg(value: string) {
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function quotePosixArg(value: string) {
  if (/^[a-zA-Z0-9_/:=.,@%+-]+$/u.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function getWindowsStartupStatus(): Promise<StartupStatus> {
  const command = await queryWindowsRunValue();
  return {
    supported: true,
    enabled: Boolean(command),
    method: 'windows-run-key',
    command,
    configPath: `${WINDOWS_RUN_KEY}\\${WINDOWS_RUN_VALUE}`
  };
}

async function enableWindowsStartup(command: string): Promise<StartupStatus> {
  await execFileAsync('reg', ['add', WINDOWS_RUN_KEY, '/v', WINDOWS_RUN_VALUE, '/t', 'REG_SZ', '/d', command, '/f']);
  return {
    supported: true,
    enabled: true,
    method: 'windows-run-key',
    command,
    configPath: `${WINDOWS_RUN_KEY}\\${WINDOWS_RUN_VALUE}`
  };
}

async function disableWindowsStartup(): Promise<StartupStatus> {
  await execFileAsync('reg', ['delete', WINDOWS_RUN_KEY, '/v', WINDOWS_RUN_VALUE, '/f']).catch(() => undefined);
  return {
    supported: true,
    enabled: false,
    method: 'windows-run-key',
    configPath: `${WINDOWS_RUN_KEY}\\${WINDOWS_RUN_VALUE}`
  };
}

async function queryWindowsRunValue() {
  try {
    const { stdout } = await execFileAsync('reg', ['query', WINDOWS_RUN_KEY, '/v', WINDOWS_RUN_VALUE]);
    const line = stdout
      .split(/\r?\n/u)
      .map((item) => item.trim())
      .find((item) => item.startsWith(WINDOWS_RUN_VALUE));
    if (!line) return undefined;
    const match = line.match(/^ProjectReikaAgentServer\s+REG_SZ\s+(.+)$/u);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

async function getLinuxStartupStatus(): Promise<StartupStatus> {
  const servicePath = linuxServicePath();
  const command = existsSync(servicePath) ? await readExecStart(servicePath) : undefined;
  const systemdEnabled = await isSystemdUserServiceEnabled();
  return {
    supported: true,
    enabled: systemdEnabled ?? existsSync(servicePath),
    method: 'linux-systemd-user',
    command,
    configPath: servicePath,
    message:
      systemdEnabled === null
        ? 'systemctl --user is unavailable; service file status is reported from disk only.'
        : undefined
  };
}

async function enableLinuxStartup(command: string): Promise<StartupStatus> {
  const servicePath = linuxServicePath();
  await mkdir(path.dirname(servicePath), { recursive: true });
  await writeFile(servicePath, linuxServiceFile(command), 'utf8');

  const systemdMessage = await reloadAndEnableSystemdUserService();
  const status = await getLinuxStartupStatus();
  return {
    ...status,
    enabled: status.enabled && !systemdMessage,
    command,
    message: systemdMessage ?? status.message
  };
}

async function disableLinuxStartup(): Promise<StartupStatus> {
  const servicePath = linuxServicePath();
  await execFileAsync('systemctl', ['--user', 'stop', LINUX_SERVICE_NAME]).catch(() => undefined);
  await execFileAsync('systemctl', ['--user', 'disable', LINUX_SERVICE_NAME]).catch(() => undefined);
  await rm(servicePath, { force: true }).catch(() => undefined);
  await execFileAsync('systemctl', ['--user', 'daemon-reload']).catch(() => undefined);
  return {
    supported: true,
    enabled: false,
    method: 'linux-systemd-user',
    configPath: servicePath
  };
}

function linuxServicePath() {
  return path.join(os.homedir(), '.config', 'systemd', 'user', LINUX_SERVICE_NAME);
}

function linuxServiceFile(command: string) {
  return [
    '[Unit]',
    'Description=Project Reika Agent Server',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${command}`,
    'Restart=always',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=default.target',
    ''
  ].join('\n');
}

async function readExecStart(servicePath: string) {
  try {
    const content = await readFile(servicePath, 'utf8');
    return content
      .split(/\r?\n/u)
      .find((line) => line.startsWith('ExecStart='))
      ?.replace(/^ExecStart=/u, '');
  } catch {
    return undefined;
  }
}

async function isSystemdUserServiceEnabled() {
  try {
    await execFileAsync('systemctl', ['--user', 'is-enabled', LINUX_SERVICE_NAME]);
    return true;
  } catch (error) {
    const candidate = error as { code?: number; stderr?: string };
    if (candidate.code === 1) return false;
    return null;
  }
}

async function reloadAndEnableSystemdUserService() {
  try {
    await execFileAsync('systemctl', ['--user', 'daemon-reload']);
    await execFileAsync('systemctl', ['--user', 'enable', LINUX_SERVICE_NAME]);
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Service file was written, but systemctl --user could not enable it: ${message}`;
  }
}
