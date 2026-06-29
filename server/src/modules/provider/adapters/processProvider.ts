import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import type { ProviderAdapter, ProviderRecord } from '../types.js';

const execFileAsync = promisify(execFile);
const DEFAULT_COLORS = ['#FFD700', '#00DDFF', '#AA66FF', '#FF7A59', '#7CFF6B', '#FF66C4', '#66FFD9', '#FFA726'];

async function run(command: string, args: string[], timeout = 8000): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(command, args, {
      timeout,
      env: { ...process.env, PATH: `${process.env.HOME || ''}/.local/bin:${process.env.PATH || ''}` },
      maxBuffer: 1024 * 1024 * 4
    });
  } catch (error) {
    const maybe = error as { stdout?: string; stderr?: string; message?: string };
    if (maybe.stdout || maybe.stderr) return { stdout: maybe.stdout || '', stderr: maybe.stderr || '' };
    throw new Error(String(maybe.message || error));
  }
}

function titleize(s = '') {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()).trim();
}

function shortName(agent: Record<string, unknown>, index: number) {
  const fromName = String(agent.name || '').split('/')[0]?.trim();
  if (fromName) return fromName;
  if (agent.id === 'main') return 'Main';
  return titleize(String(agent.id || `Agent ${index + 1}`));
}

function readOpenClawAgents() {
  const configPath = `${process.env.HOME || ''}/.openclaw/openclaw.json`;
  const raw = readFileSync(configPath, 'utf8');
  const json = JSON.parse(raw);
  const list = Array.isArray(json?.agents?.list) ? json.agents.list : [];
  return {
    configPath,
    agents: list.map((agent: Record<string, unknown>, index: number) => {
      const id = String(agent.id || '').trim();
      const label = shortName(agent, index);
      return {
        id,
        name: String(agent.name || label).trim() || label,
        label,
        model: typeof agent.model === 'string' ? agent.model : (agent.model as { primary?: string } | undefined)?.primary,
        source: 'openclaw',
        workspace: typeof agent.workspace === 'string' ? agent.workspace : undefined,
        aliases: [id, label, String(agent.name || '')].filter(Boolean)
      };
    }).filter((agent: { id: string }) => agent.id)
  };
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
      return { profile, model };
    });
}

async function showHermesProfile(profile: string) {
  try {
    const { stdout } = await run(process.env.HERMES_BIN || 'hermes', ['profile', 'show', profile], 12000);
    const details: Record<string, string> = {};
    for (const line of String(stdout || '').split(/\r?\n/)) {
      const match = line.match(/^([^:]+):\s+(.*)$/);
      if (!match) continue;
      details[String(match[1] || '').trim().toLowerCase()] = String(match[2] || '').trim();
    }
    return { path: details.path || '', model: details.model || '', gateway: details.gateway || '' };
  } catch {
    return { path: '', model: '', gateway: '' };
  }
}

function parseAssistantNameFromSoul(path = '') {
  if (!path) return '';
  try {
    const soul = readFileSync(`${path.replace(/\/$/, '')}/SOUL.md`, 'utf8');
    const match = soul.match(/(?:You are|Name:|#\s*)([^,\n.]{2,80})/i);
    return String(match?.[1] || '').trim();
  } catch {
    return '';
  }
}

export const openClawProvider: ProviderAdapter = {
  id: 'openclaw-direct',
  kind: 'openclaw',
  priority: 20,
  async detect(): Promise<ProviderRecord> {
    try {
      const [{ stdout, stderr }, roster] = await Promise.all([
        run(process.env.OPENCLAW_BIN || 'openclaw', ['--version']),
        Promise.resolve().then(readOpenClawAgents)
      ]);
      const version = (stdout || stderr).trim();
      return {
        id: this.id,
        kind: this.kind,
        name: 'OpenClaw Direct',
        status: roster.agents.length ? 'available' : 'offline',
        priority: this.priority,
        endpointLabel: `${process.env.OPENCLAW_BIN || 'openclaw'} CLI + ${roster.configPath}`,
        capabilities: [
          { id: 'roster', label: 'Roster discovery' },
          { id: 'sessions', label: 'CLI-backed sessions' },
          { id: 'chat', label: 'Direct chat transport' },
          { id: 'events', label: 'Turn lifecycle events' },
          { id: 'history', label: 'Project Reika session history' }
        ],
        agents: roster.agents,
        notes: roster.agents.length
          ? `Detected OpenClaw via local CLI (${version || 'version unknown'}) and loaded ${roster.agents.length} agents.`
          : `Detected OpenClaw CLI (${version || 'version unknown'}), but no agents were listed in ${roster.configPath}.`
      };
    } catch (error) {
      return offline('openclaw-direct', 'openclaw', 20, 'OpenClaw Direct', 'openclaw CLI/config', error);
    }
  }
};

export const hermesProvider: ProviderAdapter = {
  id: 'hermes-direct',
  kind: 'hermes',
  priority: 30,
  async detect(): Promise<ProviderRecord> {
    try {
      const { stdout } = await run(process.env.HERMES_BIN || 'hermes', ['profile', 'list'], 12000);
      const profiles = parseHermesProfiles(stdout);
      const agents = await Promise.all(profiles.map(async (record, index) => {
        const details = await showHermesProfile(record.profile);
        const profileTitle = titleize(record.profile);
        const isDefault = index === 0 || record.profile === 'default';
        const soulName = parseAssistantNameFromSoul(details.path);
        const id = isDefault ? String(process.env.HERMES_AGENT_ID || 'hermes') : `hermes:${record.profile}`;
        const label = isDefault ? String(process.env.HERMES_AGENT_LABEL || soulName || profileTitle || 'Hermes') : (soulName || profileTitle || record.profile);
        return {
          id,
          name: isDefault ? String(process.env.HERMES_AGENT_NAME || label) : label,
          label,
          model: record.model || details.model || process.env.HERMES_AGENT_MODEL || undefined,
          source: 'hermes',
          profile: record.profile,
          hermesProfile: record.profile,
          workspace: details.path || undefined,
          aliases: [id, record.profile, profileTitle, label, soulName, isDefault ? 'hermes' : '', isDefault ? 'Nyxie' : ''].filter(Boolean),
          color: DEFAULT_COLORS[index % DEFAULT_COLORS.length]
        };
      }));
      return {
        id: this.id,
        kind: this.kind,
        name: 'Hermes Direct',
        status: agents.length ? 'available' : 'offline',
        priority: this.priority,
        endpointLabel: `${process.env.HERMES_BIN || 'hermes'} CLI`,
        capabilities: [
          { id: 'roster', label: 'Profile/agent discovery' },
          { id: 'sessions', label: 'Hermes resume sessions' },
          { id: 'chat', label: 'Direct chat transport' },
          { id: 'events', label: 'Turn lifecycle events' },
          { id: 'history', label: 'Project Reika session history' }
        ],
        agents,
        notes: agents.length
          ? `Detected ${agents.length} Hermes profiles. Chat may fail if upstream ChatGPT OAuth/session is expired.`
          : 'Hermes CLI responded, but no profiles were listed.'
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
    capabilities: [
      { id: 'roster', label: 'Roster discovery', planned: true },
      { id: 'chat', label: 'Direct chat transport', planned: true },
      { id: 'events', label: 'Turn lifecycle events', planned: true }
    ],
    agents: [],
    notes: `${name} was not reachable during detection.`,
    error: error instanceof Error ? error.message : String(error)
  };
}
