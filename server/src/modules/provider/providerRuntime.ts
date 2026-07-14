import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve, sep } from 'node:path';
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
  tools?: ProviderToolDefinition[];
  requireToolCall?: boolean;
  executeTool?: (call: ProviderToolCall) => Promise<unknown>;
}

export interface ProviderToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ProviderChatEvent {
  type: 'accepted' | 'thinking' | 'response' | 'tool' | 'delegation' | 'error' | 'done';
  data: Record<string, unknown>;
}

export interface ProviderChatResult {
  providerId: string;
  agentId: string;
  sessionId: string;
  runtime: 'commandcenter' | 'openclaw' | 'hermes' | 'mock' | 'memory-mesh';
  text: string;
  raw?: string;
  metadata?: Record<string, unknown>;
}

const commandCenterBaseUrl = process.env.COMMANDCENTER_LOCAL_API_BASE || 'http://127.0.0.1:3002/commandcenter/api/v1';
const openClawBin = process.env.OPENCLAW_BIN || 'openclaw';
const openClawGatewayBaseUrl = process.env.OPENCLAW_GATEWAY_BASE_URL || `http://127.0.0.1:${process.env.OPENCLAW_GATEWAY_PORT || '18789'}`;
const hermesBin = process.env.HERMES_BIN || 'hermes';
const hermesSessionSource = process.env.HERMES_SESSION_SOURCE || 'cli';

function envWithLocalBin() {
  return { ...process.env, PATH: [join(homedir(), '.local', 'bin'), process.env.PATH || ''].filter(Boolean).join(delimiter) };
}

const providerHttpTimeoutMs = Math.max(1000, Number(process.env.REIKA_PROVIDER_HTTP_TIMEOUT_MS || 120000));

function providerFetch(input: string | URL, init: RequestInit = {}) {
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(providerHttpTimeoutMs) });
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

function cleanProviderSessionSegment(value = '') {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
}

function providerSessionId(prefix: string, sessionId?: string) {
  const base = cleanProviderSessionSegment(sessionId || '');
  if (!base) return `${prefix}_${Date.now().toString(36)}`;
  const digest = createHash('sha256').update(base).digest('hex').slice(0, 24);
  return `${prefix}_${digest}`;
}

async function renameHermesSession(sessionId: string, title: string) {
  if (!sessionId) return;
  try {
    await runCommand(hermesBin, ['sessions', 'rename', sessionId, title], 30000);
  } catch {
    // Cosmetic only. Chat success should not depend on Hermes accepting a title.
  }
}

interface OpenClawGatewayConfig {
  baseUrl: string;
  authHeader?: string;
}

async function readOpenClawGatewayConfig(): Promise<OpenClawGatewayConfig> {
  const baseUrl = String(openClawGatewayBaseUrl || '').trim().replace(/\/+$/g, '');
  const explicitToken = String(process.env.OPENCLAW_GATEWAY_TOKEN || '').trim();
  const explicitPassword = String(process.env.OPENCLAW_GATEWAY_PASSWORD || '').trim();
  if (explicitToken) return { baseUrl, authHeader: `Bearer ${explicitToken}` };
  if (explicitPassword) return { baseUrl, authHeader: `Bearer ${explicitPassword}` };
  try {
    const raw = await readFile(join(homedir(), '.openclaw', 'openclaw.json'), 'utf8');
    const config = JSON.parse(raw) as { gateway?: { auth?: { mode?: string; token?: string; password?: string } } };
    const auth = config.gateway?.auth;
    const secret = String(auth?.token || auth?.password || '').trim();
    return secret ? { baseUrl, authHeader: `Bearer ${secret}` } : { baseUrl };
  } catch {
    return { baseUrl };
  }
}

function openClawSessionKey(agentId: string, providerSessionId: string) {
  const safeAgent = cleanProviderSessionSegment(agentId) || 'main';
  const safeSession = cleanProviderSessionSegment(providerSessionId) || `prs_${Date.now().toString(36)}`;
  return `agent:${safeAgent}:reika:${safeSession}`;
}

export function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        const part = item as { type?: string; text?: string };
        return part.type === 'text' && typeof part.text === 'string' ? part.text : '';
      })
      .join('')
      .trim();
  }
  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>;
    for (const key of ['text', 'content', 'message', 'reply', 'response']) {
      const candidate = record[key];
      if (candidate === content) continue;
      const text: string = extractMessageText(candidate);
      if (text) return text;
    }
  }
  return '';
}

export function extractCommandCenterResponseText(body: Record<string, unknown>): string {
  for (const candidate of [body.response, body.reply, body.text]) {
    const text = extractMessageText(candidate);
    if (text) return text;
  }
  return '';
}

export function extractCommandCenterSessionId(body: Record<string, unknown>, fallback = ''): string {
  const session = body.session && typeof body.session === 'object' ? body.session as Record<string, unknown> : undefined;
  return String(body.sessionId || session?.id || fallback).trim();
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function runOpenClawGatewayChat(input: { agentId: string; providerSessionId: string; message: string; model?: string; tools?: ProviderToolDefinition[]; requireToolCall?: boolean; executeTool?: (call: ProviderToolCall) => Promise<unknown>; onEvent?: (event: ProviderChatEvent) => void }) {
  const gateway = await readOpenClawGatewayConfig();
  const sessionKey = openClawSessionKey(input.agentId, input.providerSessionId);
  const messages: Array<Record<string, unknown>> = [{ role: 'user', content: input.message }];
  const executedToolCalls: Array<ProviderToolCall & { ok: boolean }> = [];
  for (let round = 0; round < 6; round += 1) {
    const response = await providerFetch(`${gateway.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(gateway.authHeader ? { Authorization: gateway.authHeader } : {}),
        'x-openclaw-agent-id': input.agentId,
        'x-openclaw-session-key': sessionKey
      },
      body: JSON.stringify({
        model: `openclaw:${input.agentId}`,
        user: sessionKey,
        messages,
        ...(input.tools?.length ? {
          tools: input.tools.map((tool) => ({ type: 'function', function: { name: tool.name.replace(/\./g, '__'), description: tool.description, parameters: tool.inputSchema } })),
          tool_choice: round === 0 && input.requireToolCall ? 'required' : 'auto'
        } : {})
      })
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const errorBody = body.error && typeof body.error === 'object' ? body.error as { message?: unknown } : undefined;
      const message = String(errorBody?.message || body.error || `OpenClaw HTTP ${response.status}`).trim();
      throw new Error(message || `OpenClaw HTTP ${response.status}`);
    }
    const choice = (body.choices as Array<{ message?: Record<string, unknown> }> | undefined)?.[0];
    const assistant = choice?.message || {};
    const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls as Array<Record<string, unknown>> : [];
    if (!calls.length) {
      const text = extractMessageText(assistant.content);
      if (!text) throw new Error('OpenClaw returned no chat response.');
      return { text, sessionKey, raw: JSON.stringify(body), toolCalls: executedToolCalls };
    }
    if (!input.executeTool) throw new Error('OpenClaw requested a Reika tool but no trusted executor was provided.');
    messages.push({ role: 'assistant', content: assistant.content ?? null, tool_calls: calls });
    for (const rawCall of calls) {
      const fn = rawCall.function && typeof rawCall.function === 'object' ? rawCall.function as Record<string, unknown> : {};
      const call: ProviderToolCall = {
        id: String(rawCall.id || `tool_${Date.now().toString(36)}`),
        name: String(fn.name || '').replace(/__/g, '.'),
        arguments: parseToolArguments(fn.arguments)
      };
      input.onEvent?.({ type: 'tool', data: { stage: 'requested', toolCallId: call.id, name: call.name } });
      const result = await input.executeTool(call);
      const ok = !(result && typeof result === 'object' && 'ok' in result && (result as { ok?: unknown }).ok === false);
      executedToolCalls.push({ ...call, ok });
      input.onEvent?.({ type: 'tool', data: { stage: 'completed', toolCallId: call.id, name: call.name, ok } });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  throw new Error('OpenClaw exceeded the bounded Reika tool-call loop.');
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
    let message = request.message;
    let commandCenterSessionId = String(request.providerSessionId || '').trim();
    const executedToolCalls: Array<ProviderToolCall & { ok: boolean }> = [];
    for (let round = 0; round < 5; round += 1) {
      const response = await providerFetch(`${commandCenterBaseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agentId, ...(commandCenterSessionId ? { sessionId: commandCenterSessionId } : {}), message, ...(request.tools?.length ? { tools: request.tools, toolChoice: round === 0 && request.requireToolCall ? 'required' : 'auto' } : {}) })
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok || body.ok === false) throw new Error(String(body.error || `CommandCenter HTTP ${response.status}`));
      commandCenterSessionId = extractCommandCenterSessionId(body, commandCenterSessionId);
      const rawCalls = Array.isArray(body.toolCalls) ? body.toolCalls : Array.isArray(body.tool_calls) ? body.tool_calls : [];
      if (!rawCalls.length) {
        const text = extractCommandCenterResponseText(body);
        if (!text) throw new Error('Command Center returned no chat response.');
        onEvent?.({ type: 'response', data: { providerId: provider.id, agent: agentId, text } });
        onEvent?.({ type: 'done', data: { providerId: provider.id, agent: agentId, sessionId: commandCenterSessionId } });
        return { providerId: provider.id, agentId, sessionId: commandCenterSessionId, runtime: 'commandcenter', text, metadata: { ...body, providerSessionId: commandCenterSessionId, commandCenterSessionId, toolCalls: executedToolCalls } };
      }
      if (!request.executeTool) throw new Error('Command Center requested a Reika tool but no trusted executor was provided.');
      const results: unknown[] = [];
      for (const raw of rawCalls as Array<Record<string, unknown>>) {
        const fn = raw.function && typeof raw.function === 'object' ? raw.function as Record<string, unknown> : raw;
        const call: ProviderToolCall = { id: String(raw.id || `tool_${Date.now().toString(36)}`), name: String(fn.name || '').replace(/__/g, '.'), arguments: parseToolArguments(fn.arguments) };
        onEvent?.({ type: 'tool', data: { stage: 'requested', toolCallId: call.id, name: call.name } });
        const result = await request.executeTool(call);
        const ok = !(result && typeof result === 'object' && 'ok' in result && (result as { ok?: unknown }).ok === false);
        executedToolCalls.push({ ...call, ok });
        results.push({ toolCallId: call.id, name: call.name, result });
        onEvent?.({ type: 'tool', data: { stage: 'completed', toolCallId: call.id, name: call.name, ok } });
      }
      message = `Reika tool results:\n${JSON.stringify(results)}\nContinue the same request using these results.`;
    }
    throw new Error('Command Center exceeded the bounded Reika tool-call loop.');
  }

  if (provider.kind === 'openclaw') {
    const openClawSessionId = request.providerSessionId || providerSessionId('project_reika', sessionId);
    const gatewayResult = await runOpenClawGatewayChat({
      agentId,
      providerSessionId: openClawSessionId,
      message: request.message,
      model: request.model,
      tools: request.tools,
      requireToolCall: request.requireToolCall,
      executeTool: request.executeTool,
      onEvent
    });
    onEvent?.({ type: 'response', data: { providerId: provider.id, agent: agentId, text: gatewayResult.text } });
    onEvent?.({ type: 'done', data: { providerId: provider.id, agent: agentId, sessionId: openClawSessionId } });
    return {
      providerId: provider.id,
      agentId,
      sessionId: openClawSessionId,
      runtime: 'openclaw',
      text: gatewayResult.text,
      raw: gatewayResult.raw,
      metadata: {
        providerSessionId: openClawSessionId,
        openClawSessionId,
        openClawSessionKey: gatewayResult.sessionKey,
        localSessionId: sessionId,
        transport: 'gateway-chat-completions',
        toolCalls: gatewayResult.toolCalls
      }
    };
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
    const hermesSessionId = parsed.hermesSessionId || request.providerSessionId || '';
    if (!request.providerSessionId && parsed.hermesSessionId) {
      await renameHermesSession(parsed.hermesSessionId, `Reika - ${String(agent.name || agentId || 'Reika').trim()}`);
    }
    onEvent?.({ type: 'response', data: { providerId: provider.id, agent: agentId, text: parsed.text } });
    onEvent?.({ type: 'done', data: { providerId: provider.id, agent: agentId, sessionId: hermesSessionId || sessionId } });
    return {
      providerId: provider.id,
      agentId,
      sessionId: hermesSessionId || sessionId,
      runtime: 'hermes',
      text: parsed.text,
      raw: parsed.raw,
      metadata: {
        hermesProfile: profile,
        hermesSource: hermesSessionSource,
        ...(hermesSessionId ? { providerSessionId: hermesSessionId, hermesSessionId } : {}),
        localSessionId: sessionId
      }
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

function parseOpenClawSessionsList(output: string, providerId: string): ProviderHistorySession[] {
  try {
    const parsed = JSON.parse(output) as { sessions?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    const sessions = Array.isArray(parsed) ? parsed : parsed.sessions || [];
    return sessions.map((session) => {
      const key = String(session.key || '');
      const marker = ':reika:';
      const providerSessionId = key.includes(marker) ? key.slice(key.indexOf(marker) + marker.length) : String(session.id || session.sessionId || '');
      const updatedAt = typeof session.updatedAt === 'number'
        ? new Date(session.updatedAt).toISOString()
        : typeof session.updatedAt === 'string' ? session.updatedAt : undefined;
      return ({
      providerId,
      providerSessionId,
      agentId: String(session.agent || session.agentId || 'openclaw'),
      title: String(session.title || session.preview || providerSessionId || 'OpenClaw session'),
      createdAt: typeof session.createdAt === 'string' ? session.createdAt : undefined,
      updatedAt,
      messageCount: typeof session.messageCount === 'number' ? session.messageCount : undefined,
      lastMessagePreview: typeof session.lastMessagePreview === 'string' ? session.lastMessagePreview : typeof session.preview === 'string' ? session.preview : undefined,
      metadata: { openClawSessionId: String(session.sessionId || session.id || ''), openClawSessionKey: key }
    });
    }).filter((session) => session.providerSessionId);
  } catch {
    return output.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^[-=\s]+$/.test(line) && !/^id\s+/i.test(line))
      .map((line) => {
        const parts = line.split(/\s{2,}|\t+/).filter(Boolean);
        const id = parts.find((part) => /^[A-Za-z0-9_-]{6,}$/.test(part)) || parts[0] || '';
        return {
          providerId,
          providerSessionId: id,
          agentId: 'openclaw',
          title: parts[1] || parts[0] || `OpenClaw ${id}`,
          lastMessagePreview: parts.slice(2).join(' '),
          metadata: { openClawSessionId: id, raw: line }
        };
      })
      .filter((session) => session.providerSessionId);
  }
}

function normalizeOpenClawMessages(output: string): ProviderHistoryMessage[] {
  try {
    const parsed = JSON.parse(output) as { messages?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    const messages = Array.isArray(parsed) ? parsed : parsed.messages || [];
    return messages.map((message) => {
      const role: ProviderHistoryMessage['role'] = message.role === 'assistant' || message.role === 'system' ? message.role : 'user';
      return {
        id: typeof message.id === 'string' ? message.id : undefined,
        role,
        text: String(message.text || message.content || message.message || ''),
        timestamp: typeof message.timestamp === 'string' ? message.timestamp : typeof message.createdAt === 'string' ? message.createdAt : undefined,
        meta: typeof message.meta === 'object' && message.meta ? message.meta as Record<string, unknown> : undefined
      };
    }).filter((message) => message.text);
  } catch {
    const jsonl = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const raw = entry.message && typeof entry.message === 'object' ? entry.message as Record<string, unknown> : entry;
        const rawRole = String(raw.role || '').toLowerCase();
        if (rawRole !== 'user' && rawRole !== 'assistant' && rawRole !== 'system') return undefined;
        const text = extractMessageText(raw.content ?? raw.text ?? raw.message);
        if (!text) return undefined;
        return {
          id: typeof entry.id === 'string' ? entry.id : typeof raw.id === 'string' ? raw.id : undefined,
          role: rawRole as ProviderHistoryMessage['role'],
          text,
          timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : typeof raw.timestamp === 'string' ? raw.timestamp : undefined
        } satisfies ProviderHistoryMessage;
      } catch {
        return undefined;
      }
    }).filter(Boolean) as ProviderHistoryMessage[];
    if (jsonl.length) return jsonl;
    return output.split(/\r?\n/).map((line, index) => {
      const match = line.match(/^(user|assistant|system|you|openclaw|agent)\s*:\s*(.+)$/i);
      if (!match) return undefined;
      const rawRole = String(match[1] || '').toLowerCase();
      const role: ProviderHistoryMessage['role'] = rawRole === 'assistant' || rawRole === 'openclaw' || rawRole === 'agent' ? 'assistant' : rawRole === 'system' ? 'system' : 'user';
      return {
        id: `openclaw_text_${index}`,
        role,
        text: String(match[2] || '').trim()
      };
    }).filter(Boolean) as ProviderHistoryMessage[];
  }
}

interface OpenClawSessionIndex {
  stores?: Array<{ agentId?: string; path?: string }>;
  sessions?: Array<{ key?: string; sessionId?: string; agentId?: string }>;
}

async function readOpenClawSessionIndex() {
  const { stdout } = await runCommand(openClawBin, ['sessions', '--all-agents', '--json'], 30000);
  return JSON.parse(stdout) as OpenClawSessionIndex;
}

async function readOpenClawSessionTranscript(providerSessionId: string) {
  const index = await readOpenClawSessionIndex();
  const marker = `:reika:${providerSessionId}`;
  const session = (index.sessions || []).find((candidate) => String(candidate.key || '').endsWith(marker))
    || (index.sessions || []).find((candidate) => candidate.sessionId === providerSessionId || candidate.key === providerSessionId);
  if (!session?.key || !session.agentId) throw new Error(`OpenClaw session not found: ${providerSessionId}`);
  const store = (index.stores || []).find((candidate) => candidate.agentId === session.agentId);
  if (!store?.path) throw new Error(`OpenClaw session store not found for agent: ${session.agentId}`);
  const records = JSON.parse(await readFile(store.path, 'utf8')) as Record<string, { sessionFile?: string; sessionId?: string }>;
  const record = records[session.key];
  const transcriptPath = record?.sessionFile || (record?.sessionId ? join(dirname(store.path), `${record.sessionId}.jsonl`) : '');
  if (!transcriptPath) throw new Error(`OpenClaw transcript not found: ${providerSessionId}`);
  const allowedRoot = resolve(join(homedir(), '.openclaw', 'agents'));
  const safePath = resolve(transcriptPath);
  if (safePath !== allowedRoot && !safePath.startsWith(`${allowedRoot}${sep}`)) throw new Error('OpenClaw transcript path escaped the configured agent store.');
  return readFile(safePath, 'utf8');
}

export async function listProviderHistorySessions(providerId: string, providers: ProviderRecord[], limit = 25): Promise<ProviderHistorySession[]> {
  const provider = findProvider(providers, providerId);
  if (!provider) throw new Error(`Provider not found: ${providerId}`);

  if (provider.kind === 'commandcenter') {
    const response = await providerFetch(`${commandCenterBaseUrl}/sessions`);
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

  if (provider.kind === 'openclaw') {
    const { stdout, stderr } = await runCommand(openClawBin, ['sessions', '--all-agents', '--json'], 30000)
      .catch(() => runCommand(openClawBin, ['sessions', 'list', '--json', '--limit', String(limit)], 30000));
    return parseOpenClawSessionsList(stdout || stderr, provider.id).slice(0, limit);
  }

  return [];
}

export async function getProviderHistoryMessages(providerId: string, providerSessionId: string, providers: ProviderRecord[]): Promise<ProviderHistoryMessage[]> {
  const provider = findProvider(providers, providerId);
  if (!provider) throw new Error(`Provider not found: ${providerId}`);
  if (provider.kind === 'openclaw') {
    const transcript = await readOpenClawSessionTranscript(providerSessionId)
      .catch(async () => {
        const { stdout, stderr } = await runCommand(openClawBin, ['sessions', 'export', providerSessionId, '--json'], 30000)
          .catch(() => runCommand(openClawBin, ['sessions', 'show', providerSessionId], 30000));
        return stdout || stderr;
      });
    return normalizeOpenClawMessages(transcript);
  }
  if (provider.kind !== 'commandcenter') return [];
  const response = await providerFetch(`${commandCenterBaseUrl}/sessions/${encodeURIComponent(providerSessionId)}/messages`);
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
  const path = join(homedir(), '.openclaw', 'openclaw.json');
  const raw = await readFile(path, 'utf8');
  const json = JSON.parse(raw);
  return { path, agents: Array.isArray(json?.agents?.list) ? json.agents.list : [] };
}
