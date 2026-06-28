import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProviderAdapter, ProviderRecord } from '../types.js';

const execFileAsync = promisify(execFile);

async function run(command: string, args: string[], timeout = 4000): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(command, args, { timeout, maxBuffer: 1024 * 1024 });
  } catch (error) {
    const maybe = error as { stdout?: string; stderr?: string };
    if (maybe.stdout || maybe.stderr) {
      return { stdout: maybe.stdout || '', stderr: maybe.stderr || '' };
    }
    throw error;
  }
}

function parseOpenClawAgents(output: string) {
  const match = output.match(/Agents\s+│\s+(\d+)/);
  const count = match ? Number(match[1]) : undefined;
  return Number.isFinite(count) ? Array.from({ length: count || 0 }, (_, index) => ({
    id: `openclaw-agent-${index + 1}`,
    name: `OpenClaw agent ${index + 1}`,
    source: 'openclaw-status'
  })) : [];
}

function parseHermesProfiles(output: string) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('Profile') && !line.startsWith('─'))
    .map((line) => line.replace(/^◆\s*/, ''))
    .map((line) => {
      const parts = line.split(/\s{2,}/).filter(Boolean);
      const profile = parts[0] || 'default';
      const model = parts[1] || '';
      return { id: profile, name: `Hermes ${profile}`, label: profile, model, source: 'hermes-profile' };
    });
}

export const openClawProvider: ProviderAdapter = {
  id: 'openclaw-direct',
  kind: 'openclaw',
  priority: 20,
  async detect(): Promise<ProviderRecord> {
    try {
      const { stdout, stderr } = await run('openclaw', ['--version']);
      const version = (stdout || stderr).trim();
      return {
        id: this.id,
        kind: this.kind,
        name: 'OpenClaw Direct',
        status: 'available',
        priority: this.priority,
        endpointLabel: 'openclaw CLI / local gateway',
        capabilities: [
          { id: 'cli', label: 'CLI detection' },
          { id: 'status', label: 'Gateway/status detection', planned: true },
          { id: 'agents', label: 'Agent roster discovery', planned: true },
          { id: 'sessions', label: 'Direct sessions', planned: true },
          { id: 'chat', label: 'Direct chat', planned: true }
        ],
        agents: [],
        notes: `Detected OpenClaw via local CLI (${version || 'version unknown'}). Direct roster/chat/session transport is intentionally not implemented yet.`
      };
    } catch (error) {
      return offline('openclaw-direct', 'openclaw', 20, 'OpenClaw Direct', 'openclaw CLI', error);
    }
  }
};

export const hermesProvider: ProviderAdapter = {
  id: 'hermes-direct',
  kind: 'hermes',
  priority: 30,
  async detect(): Promise<ProviderRecord> {
    try {
      const { stdout } = await run('hermes', ['profile', 'list']);
      return {
        id: this.id,
        kind: this.kind,
        name: 'Hermes Direct',
        status: 'available',
        priority: this.priority,
        endpointLabel: 'hermes CLI',
        capabilities: [
          { id: 'profiles', label: 'Profile discovery' },
          { id: 'chat', label: 'Direct chat', planned: true }
        ],
        agents: parseHermesProfiles(stdout),
        notes: 'Detected Hermes profiles via CLI. Chat may fail if upstream ChatGPT OAuth/session is expired; this server does not depend on chat success yet.'
      };
    } catch (error) {
      return offline('hermes-direct', 'hermes', 30, 'Hermes Direct', 'hermes CLI', error);
    }
  }
};

function offline(id: string, kind: 'openclaw' | 'hermes', priority: number, name: string, endpointLabel: string, error: unknown): ProviderRecord {
  return {
    id,
    kind,
    name,
    status: 'offline',
    priority,
    endpointLabel,
    capabilities: [],
    agents: [],
    notes: `${name} was not reachable during detection.`,
    error: error instanceof Error ? error.message : String(error)
  };
}
