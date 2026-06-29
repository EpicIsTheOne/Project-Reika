import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { ProviderRecord } from './types.js';

const execFileAsync = promisify(execFile);


export interface ProviderHistoryMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp?: string;
  meta?: Record<string, unknown>;
}

export interface ProviderHistorySession {
  providerId: string;
  providerSessionId: string;
  agentId: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
  lastMessagePreview?: string;
  metadata?: Record<string, unknown>;
  messages?: ProviderHistoryMessage[];
}

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
const hermesSessionSource = process.env.HERMES_SESSION_SOURCE || 'cli';

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
    const stdout = String(maybe.stdout || '');
    const stderr = String(maybe.stderr || '');
    if (stdout.trim()) return { stdout, stderr };
    const text = String(stderr || maybe.message || error || '').trim();
    throw new Error(text || `${command} failed`);
  }
}

function parseHermesOutput(stdout = '', stderr = '') {
  const raw = `${stdout || ''}\n${stderr || ''}`;
  const lines = raw.split(/\r?\n/);
  let hermesSessionId = '';
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const sessionMatch = trimmed.match(/^session(?:_id|\s+id)?:\s*(.+?)\s*$/i);
    if (sessionMatch) {
      hermesSessionId = String(sessionMatch[1] || '').trim();
      continue;
    }
    const resumedMatch = trimmed.match(/^.*?\bResumed session\s+([A-Za-z0-9_-]+)/i);
    if (resumedMatch) {
      hermesSessionId ||= String(resumedMatch[1] || '').trim();
      continue;
    }
    if (/\bWorking directory:/i.test(trimmed)) continue;
    kept.push(line);
  }
  return { text: kept.join('\n').trim(), hermesSessionId, raw };
}

async function renameHermesSession(sessionId: string, title: string) {
  if (!sessionId) return;
  try {
    await runCommand(hermesBin, ['sessions', 'rename', sessionId, title], 30000);
  } catch {
    // Cosmetic only. Chat success should not depend on Hermes accepting a title.
  }
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
    const profile = String((agent as { hermesProfile?: string; profile?: string }).hermesProfile || (agent as { profile?: string }).profile || (agentId.startsWith('hermes:') ? agentId.slice('hermes:'.length) : agentId === 'hermes' ? 'default' : agentId)).trim();
    const model = String(request.model || agent.model || process.env.HERMES_AGENT_MODEL || '').trim();
    const args = [
      ...(profile ? ['--profile', profile] : []),
      'chat', '--cli', '-q', request.message,
      '-Q',
      '--source', hermesSessionSource,
      ...(request.providerSessionId ? ['--resume', request.providerSessionId] : []),
      ...(model ? ['--model', model] : [])
    ];
    const { stdout, stderr } = await runCommand(hermesBin, args);
    const parsed = parseHermesOutput(stdout, stderr);
    if (!parsed.text) throw new Error('Hermes returned no chat response.');
    const hermesSessionId = parsed.hermesSessionId || request.providerSessionId || sessionId;
    if (!request.providerSessionId && parsed.hermesSessionId) {
      await renameHermesSession(parsed.hermesSessionId, `AgentHub - ${String(agent.name || agentId || 'Reika').trim()}`);
    }
    onEvent?.({ type: 'response', data: { providerId: provider.id, agent: agentId, text: parsed.text } });
    onEvent?.({ type: 'done', data: { providerId: provider.id, agent: agentId, sessionId: hermesSessionId } });
    return {
      providerId: provider.id,
      agentId,
      sessionId: hermesSessionId,
      runtime: 'hermes',
      text: parsed.text,
      raw: parsed.raw,
      metadata: { hermesProfile: profile, hermesSource: hermesSessionSource, hermesSessionId }
    };
  }

  const text = `Mock ${agent.name || agentId}: ${request.message}`;
  onEvent?.({ type: 'response', data: { providerId: provider.id, agent: agentId, text } });
  onEvent?.({ type: 'done', data: { providerId: provider.id, agent: agentId, sessionId } });
  return { providerId: provider.id, agentId, sessionId, runtime: 'mock', text };
}

function parseHermesSessionsList(output: string, providerId: string): ProviderHistorySession[] {
  const lines = output.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  const sessions: ProviderHistorySession[] = [];
  for (const line of lines) {
    if (/^Preview\s+Last Active\s+Src\s+ID\b/i.test(line) || /^(?:[-=]|\u2500)+$/.test(line.trim()) || /^No sessions found\.?$/i.test(line.trim())) continue;
    const match = line.match(/^(.*?)\s{2,}(.+?)\s{2,}(\S+)\s{2,}(\d{8}_\d{6}_[A-Za-z0-9]+)\s*$/);
    if (!match) continue;
    const preview = String(match[1] || '').trim();
    const lastActive = String(match[2] || '').trim();
    const source = String(match[3] || '').trim();
    const id = String(match[4] || '').trim();
    sessions.push({
      providerId,
      providerSessionId: id,
      agentId: 'hermes',
      title: preview || `Hermes ${id}`,
      updatedAt: /^\d{4}-\d{2}-\d{2}/.test(lastActive) ? new Date(`${lastActive}T00:00:00.000Z`).toISOString() : undefined,
      messageCount: undefined,
      lastMessagePreview: preview,
      metadata: { source, lastActiveLabel: lastActive, hermesSessionId: id, hermesProfile: 'default' }
    });
  }
  return sessions;
}

export async function listProviderHistorySessions(providerId: string, providers: ProviderRecord[], limit = 25): Promise<ProviderHistorySession[]> {
  const provider = findProvider(providers, providerId);
  if (!provider) throw new Error(`Provider not found: ${providerId}`);

  if (provider.kind === 'commandcenter') {
    const response = await fetch(`${commandCenterBaseUrl}/sessions`);
    const body = await response.json().catch(() => ({})) as { ok?: boolean; sessions?: Array<Record<string, unknown>>; error?: unknown };
    if (!response.ok || body.ok === false) throw new Error(String(body.error || `CommandCenter HTTP ${response.status}`));
    return (body.sessions || []).slice(0, limit).map((session) => ({
      providerId: provider.id,
      providerSessionId: String(session.id || ''),
      agentId: String(session.agent || 'unknown'),
      title: String(session.title || session.lastMessagePreview || session.id || 'CommandCenter session'),
      createdAt: typeof session.createdAt === 'string' ? session.createdAt : undefined,
      updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : undefined,
      messageCount: typeof session.messageCount === 'number' ? session.messageCount : undefined,
      lastMessagePreview: typeof session.lastMessagePreview === 'string' ? session.lastMessagePreview : undefined,
      metadata: { ...(typeof session.metadata === 'object' && session.metadata ? session.metadata as Record<string, unknown> : {}), commandCenterSessionId: String(session.id || '') }
    })).filter((session) => session.providerSessionId);
  }

  if (provider.kind === 'hermes') {
    const { stdout } = await runCommand(hermesBin, ['sessions', 'list', '--limit', String(limit)], 30000);
    return parseHermesSessionsList(stdout, provider.id).slice(0, limit);
  }

  return [];
}

export async function getProviderHistoryMessages(providerId: string, providerSessionId: string, providers: ProviderRecord[]): Promise<ProviderHistoryMessage[]> {
  const provider = findProvider(providers, providerId);
  if (!provider) throw new Error(`Provider not found: ${providerId}`);
  if (provider.kind !== 'commandcenter') return [];
  const response = await fetch(`${commandCenterBaseUrl}/sessions/${encodeURIComponent(providerSessionId)}/messages`);
  const body = await response.json().catch(() => ({})) as { ok?: boolean; messages?: Array<Record<string, unknown>>; error?: unknown };
  if (!response.ok || body.ok === false) throw new Error(String(body.error || `CommandCenter HTTP ${response.status}`));
  return (body.messages || []).map((message) => {
    const role: ProviderHistoryMessage['role'] = message.role === 'assistant' || message.role === 'system' ? message.role : 'user';
    return {
      id: typeof message.id === 'string' ? message.id : undefined,
      role,
      text: String(message.text || ''),
      timestamp: typeof message.timestamp === 'string' ? message.timestamp : undefined,
      meta: typeof message.meta === 'object' && message.meta ? message.meta as Record<string, unknown> : undefined
    };
  }).filter((message) => message.text);
}

export async function readOpenClawConfigAgents() {
  const path = `${process.env.HOME || ''}/.openclaw/openclaw.json`;
  const raw = await readFile(path, 'utf8');
  const json = JSON.parse(raw);
  return { path, agents: Array.isArray(json?.agents?.list) ? json.agents.list : [] };
}
