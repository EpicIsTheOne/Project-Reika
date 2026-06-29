import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { ProviderRecord } from './types.js';

const execFileAsync = promisify(execFile);

export interface ProviderChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp?: string;
}

export interface ProviderChatRequest {
  providerId: string;
  agentId: string;
  sessionId?: string;
  message: string;
  history?: ProviderChatMessage[];
  model?: string;
  providerSessionId?: string;
}

export interface ProviderChatEvent {
  type: 'accepted' | 'thinking' | 'response' | 'error' | 'done';
  data: Record<string, unknown>;
}

export interface ProviderChatResult {
  providerId: string;
  agentId: string;
  sessionId: string;
  runtime: 'commandcenter' | 'openclaw' | 'hermes' | 'mock';
  text: string;
  raw?: string;
  metadata?: Record<string, unknown>;
}

const commandCenterBaseUrl = process.env.COMMANDCENTER_LOCAL_API_BASE || 'http://127.0.0.1:3002/commandcenter/api/v1';
const openClawBin = process.env.OPENCLAW_BIN || 'openclaw';
const hermesBin = process.env.HERMES_BIN || 'hermes';

function envWithLocalBin() {
  return { ...process.env, PATH: `${process.env.HOME || ''}/.local/bin:${process.env.PATH || ''}` };
}

function compactHistory(history: ProviderChatMessage[] = []) {
  return history.slice(-30).map((message) => {
    const role = message.role === 'assistant' ? 'Assistant' : message.role === 'system' ? 'System' : 'User';
    return `${role}: ${String(message.text || '').replace(/\s+/g, ' ').trim()}`;
  }).filter(Boolean).join('\n');
}

export function buildDirectPrompt(request: ProviderChatRequest) {
  const history = compactHistory(request.history || []);
  return [
    'You are replying inside Project Reika Agent Server direct-provider chat.',
    `Provider: ${request.providerId}`,
    `Agent: ${request.agentId}`,
    request.sessionId ? `Project Reika session id: ${request.sessionId}` : '',
    history ? `Conversation so far:\n${history}` : '',
    `Latest user message:\n${request.message}`,
    'Reply naturally and directly to the latest user message.',
    'Do not assume unrelated external session history unless it appears above.'
  ].filter(Boolean).join('\n\n');
}

async function runCommand(command: string, args: string[], timeout = 120000) {
  try {
    return await execFileAsync(command, args, {
      timeout,
      env: envWithLocalBin(),
      maxBuffer: 1024 * 1024 * 8
    });
  } catch (error) {
    const maybe = error as { stdout?: string; stderr?: string; message?: string };
    const text = String(maybe.stderr || maybe.stdout || maybe.message || error || '').trim();
    throw new Error(text || `${command} failed`);
  }
}

function parseHermesOutput(stdout = '', stderr = '') {
  const raw = `${stdout || ''}\n${stderr || ''}`;
  const lines = raw.split(/\r?\n/);
  let hermesSessionId = '';
  const kept: string[] = [];
  for (const line of lines) {
    const match = line.match(/^session_id:\s*(.+?)\s*$/i);
    if (match) {
      hermesSessionId = String(match[1] || '').trim();
      continue;
    }
    if (/^↻\s+Resumed session\b/i.test(line.trim())) continue;
    kept.push(line);
  }
  return { text: kept.join('\n').trim(), hermesSessionId, raw };
}

export function findProvider(providers: ProviderRecord[], providerId?: string) {
  const requested = String(providerId || '').trim();
  if (requested) return providers.find((provider) => provider.id === requested || provider.kind === requested);
  return providers.find((provider) => provider.status === 'preferred') || providers.find((provider) => provider.status === 'available') || providers[0];
}

export function findAgent(provider: ProviderRecord | undefined, agentId?: string) {
  if (!provider) return undefined;
  const requested = String(agentId || '').trim().toLowerCase();
  if (!requested) return provider.agents[0];
  return provider.agents.find((agent) => [agent.id, agent.name, agent.label, agent.source].filter(Boolean).some((value) => String(value).toLowerCase() === requested))
    || provider.agents.find((agent) => [agent.id, agent.name, agent.label].filter(Boolean).some((value) => String(value).toLowerCase().includes(requested)));
}

export async function runProviderChat(request: ProviderChatRequest, providers: ProviderRecord[], onEvent?: (event: ProviderChatEvent) => void): Promise<ProviderChatResult> {
  const provider = findProvider(providers, request.providerId);
  if (!provider) throw new Error(`Provider not found: ${request.providerId}`);
  if (provider.status === 'offline' || provider.status === 'error') throw new Error(`${provider.name} is ${provider.status}: ${provider.error || provider.notes}`);
  const agent = findAgent(provider, request.agentId) || { id: request.agentId || 'reika', name: request.agentId || 'Reika', model: request.model };
  const agentId = String(agent.id || request.agentId || '').trim();
  if (!agentId) throw new Error('Missing agent id');
  const sessionId = request.sessionId || `reika_${provider.id}_${Date.now().toString(36)}`;

  onEvent?.({ type: 'accepted', data: { providerId: provider.id, agent: agentId, sessionId } });
  onEvent?.({ type: 'thinking', data: { providerId: provider.id, agent: agentId, status: `Routing to ${provider.name}...` } });

  if (provider.kind === 'commandcenter') {
    const response = await fetch(`${commandCenterBaseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: agentId, sessionId, message: request.message })
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || body.ok === false) throw new Error(String(body.error || `CommandCenter HTTP ${response.status}`));
    const text = String(body.text || body.reply || body.message || body.response || '').trim();
    onEvent?.({ type: 'response', data: { providerId: provider.id, agent: agentId, text } });
    onEvent?.({ type: 'done', data: { providerId: provider.id, agent: agentId, sessionId } });
    return { providerId: provider.id, agentId, sessionId, runtime: 'commandcenter', text, metadata: body };
  }

  if (provider.kind === 'openclaw') {
    const prompt = buildDirectPrompt(request);
    const args = [
      'agent', '--agent', agentId,
      '--session-id', `project_reika_${sessionId}`,
      '--thinking', agentId === 'orchestrator' || agentId === 'main' ? 'low' : 'off',
      '--message', prompt
    ];
    const { stdout, stderr } = await runCommand(openClawBin, args);
    const text = String(stdout || stderr || '').trim();
    onEvent?.({ type: 'response', data: { providerId: provider.id, agent: agentId, text } });
    onEvent?.({ type: 'done', data: { providerId: provider.id, agent: agentId, sessionId } });
    return { providerId: provider.id, agentId, sessionId, runtime: 'openclaw', text, raw: `${stdout || ''}\n${stderr || ''}`.trim() };
  }

  if (provider.kind === 'hermes') {
    const prompt = buildDirectPrompt(request);
    const profile = String((agent as { hermesProfile?: string; profile?: string }).hermesProfile || (agent as { profile?: string }).profile || (agentId.startsWith('hermes:') ? agentId.slice('hermes:'.length) : agentId === 'hermes' ? 'default' : agentId)).trim();
    const model = String(request.model || agent.model || process.env.HERMES_AGENT_MODEL || '').trim();
    const args = [
      ...(profile ? ['--profile', profile] : []),
      'chat', '-q', prompt,
      '-Q',
      '--source', 'project-reika',
      ...(request.providerSessionId ? ['--resume', request.providerSessionId] : []),
      ...(model ? ['--model', model] : [])
    ];
    const { stdout, stderr } = await runCommand(hermesBin, args);
    const parsed = parseHermesOutput(stdout, stderr);
    onEvent?.({ type: 'response', data: { providerId: provider.id, agent: agentId, text: parsed.text } });
    onEvent?.({ type: 'done', data: { providerId: provider.id, agent: agentId, sessionId: parsed.hermesSessionId || sessionId } });
    return { providerId: provider.id, agentId, sessionId: parsed.hermesSessionId || sessionId, runtime: 'hermes', text: parsed.text, raw: parsed.raw, metadata: { hermesProfile: profile } };
  }

  const text = `Mock ${agent.name || agentId}: ${request.message}`;
  onEvent?.({ type: 'response', data: { providerId: provider.id, agent: agentId, text } });
  onEvent?.({ type: 'done', data: { providerId: provider.id, agent: agentId, sessionId } });
  return { providerId: provider.id, agentId, sessionId, runtime: 'mock', text };
}

export async function readOpenClawConfigAgents() {
  const path = `${process.env.HOME || ''}/.openclaw/openclaw.json`;
  const raw = await readFile(path, 'utf8');
  const json = JSON.parse(raw);
  return { path, agents: Array.isArray(json?.agents?.list) ? json.agents.list : [] };
}
