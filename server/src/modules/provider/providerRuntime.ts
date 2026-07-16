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
  mode?: 'agent' | 'roleplay';
  model?: string;
  providerSessionId?: string;
  tools?: ProviderToolDefinition[];
  requireToolCall?: boolean;
  executeTool?: (call: ProviderToolCall) => Promise<unknown>;
  fileIds?: string[];
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
  mode?: 'agent' | 'roleplay';
  model?: string;
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

function commandCenterHeaders(extra: Record<string, string> = {}) {
  const token = String(process.env.COMMANDCENTER_API_KEY || process.env.COMMANDCENTER_LOCAL_API_KEY || process.env.COMMANDCENTER_PASSWORD || '').trim();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra
  };
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

function summarizeToolValue(value: unknown) {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 497)}...` : value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function summarizeEventMessage(data: Record<string, unknown>, fallback = '') {
  for (const key of ['status', 'message', 'error', 'reason']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  if (fallback) return fallback;
  return '';
}

function parseCommandCenterToolCalls(data: Record<string, unknown>): ProviderToolCall[] {
  const candidates = [data.toolCalls, data.tool_calls, data.calls];
  const raw = candidates.find((value) => Array.isArray(value));
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, index) => {
    const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const fn = record.function && typeof record.function === 'object' ? record.function as Record<string, unknown> : record;
    return {
      id: String(record.id || `tool_${index + 1}`),
      name: String(fn.name || '').replace(/__/g, '.'),
      arguments: parseToolArguments(fn.arguments)
    };
  }).filter((call) => call.name);
}

async function streamCommandCenterTurn(input: { sessionId: string; agentId: string; message: string; mode: 'agent' | 'roleplay'; model?: string; fileIds?: string[]; onEvent?: (event: ProviderChatEvent) => void }) {
  const response = await providerFetch(`${commandCenterBaseUrl}/sessions/${encodeURIComponent(input.sessionId)}/messages/stream`, {
    method: 'POST',
    headers: commandCenterHeaders({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
    body: JSON.stringify({ message: input.message, ...(input.fileIds?.length ? { fileIds: input.fileIds } : {}) })
  });
  if (!response.ok || !response.body) {
    let message = `CommandCenter HTTP ${response.status}`;
    try {
      const body = await response.json() as Record<string, unknown>;
      message = String(body.error || body.message || message);
    } catch {
      // ignore non-json errors
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalText = '';
  let donePayload: Record<string, unknown> | undefined;
  let lastResponseText = '';
  const metadata: Record<string, unknown> = {
    commandCenterSessionId: input.sessionId,
    providerSessionId: input.sessionId,
    mode: input.mode,
    model: input.model
  };

  const emitChunk = async (chunk: string) => {
    let type = 'message';
    const dataLines: string[] = [];
    for (const rawLine of chunk.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (line.startsWith('event:')) type = line.slice('event:'.length).trim() || 'message';
      if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
    }
    if (!dataLines.length) return;
    const rawData = dataLines.join('\n');
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(rawData) as Record<string, unknown>;
    } catch {
      data = { raw: rawData };
    }

    const eventSessionId = extractCommandCenterSessionId(data, input.sessionId) || input.sessionId;
    metadata.commandCenterSessionId = eventSessionId;
    metadata.providerSessionId = eventSessionId;
    if (typeof data.model === 'string' && data.model.trim()) metadata.model = data.model.trim();

    if (type === 'accepted') {
      input.onEvent?.({ type: 'accepted', data: { providerId: 'commandcenter-local', agent: input.agentId, sessionId: eventSessionId, messageId: data.messageId, files: data.files } });
      return;
    }
    if (type === 'thinking') {
      const toolCalls = parseCommandCenterToolCalls(data);
      if (toolCalls.length) {
        for (const call of toolCalls) {
          input.onEvent?.({ type: 'tool', data: { providerId: 'commandcenter-local', agent: input.agentId, stage: 'requested', toolCallId: call.id, name: call.name, arguments: summarizeToolValue(call.arguments), sessionId: eventSessionId, providerSessionId: eventSessionId, sourceEvent: type } });
        }
      }
      input.onEvent?.({ type: 'thinking', data: { providerId: 'commandcenter-local', agent: input.agentId, status: summarizeEventMessage(data, 'Processing...'), sessionId: eventSessionId, providerSessionId: eventSessionId, sourceEvent: type } });
      return;
    }
    if (type === 'response') {
      const text = extractMessageText(data.text ?? data.response ?? data.reply ?? data.message);
      if (text) {
        lastResponseText = text;
        finalText = text;
        input.onEvent?.({ type: 'response', data: { providerId: 'commandcenter-local', agent: input.agentId, text, sessionId: eventSessionId, providerSessionId: eventSessionId, sourceEvent: type } });
      }
      return;
    }
    if (type === 'error') {
      throw new Error(String(data.error || data.message || 'CommandCenter stream failed'));
    }
    if (type === 'done') {
      donePayload = data;
      return;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) await emitChunk(chunk);
  }
  if (buffer.trim()) await emitChunk(buffer);

  const resultText = finalText || lastResponseText;
  if (!resultText) throw new Error('Command Center returned no chat response.');
  input.onEvent?.({ type: 'done', data: { providerId: 'commandcenter-local', agent: input.agentId, sessionId: String(donePayload?.sessionId || input.sessionId), providerSessionId: String(donePayload?.sessionId || input.sessionId), responseId: donePayload?.responseId, attachmentStatuses: donePayload?.attachmentStatuses } });
  return { text: resultText, metadata: { ...metadata, done: donePayload } };
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
      input.onEvent?.({ type: 'tool', data: { stage: 'requested', toolCallId: call.id, name: call.name, arguments: summarizeToolValue(call.arguments) } });
      const result = await input.executeTool(call);
      const ok = !(result && typeof result === 'object' && 'ok' in result && (result as { ok?: unknown }).ok === false);
      executedToolCalls.push({ ...call, ok });
      input.onEvent?.({ type: 'tool', data: { stage: 'completed', toolCallId: call.id, name: call.name, ok, result: summarizeToolValue(result) } });
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
    const requestedMode = request.mode === 'roleplay' ? 'roleplay' : 'agent';
    const createCommandCenterSession = async () => {
      const createResponse = await providerFetch(`${commandCenterBaseUrl}/sessions`, {
        method: 'POST',
        headers: commandCenterHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          agent: agentId,
          title: `Reika · ${String(agent.name || agentId).trim()}`,
          mode: requestedMode,
          ...(request.model ? { model: request.model } : {}),
          metadata: { source: 'project-reika', localSessionId: sessionId }
        })
      });
      const createBody = await createResponse.json().catch(() => ({})) as Record<string, unknown>;
      if (!createResponse.ok || createBody.ok === false) throw new Error(String(createBody.error || `CommandCenter HTTP ${createResponse.status}`));
      const createdSessionId = extractCommandCenterSessionId(createBody);
      if (!createdSessionId) throw new Error('Command Center did not return a session id.');
      return createdSessionId;
    };

    let commandCenterSessionId = String(request.providerSessionId || '').trim();
    const resumedExistingSession = Boolean(commandCenterSessionId);
    if (!commandCenterSessionId) commandCenterSessionId = await createCommandCenterSession();

    let streamed;
    try {
      streamed = await streamCommandCenterTurn({ sessionId: commandCenterSessionId, agentId, message: request.message, mode: requestedMode, model: request.model, fileIds: request.fileIds, onEvent });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      if (!resumedExistingSession || !/session\s+not\s+found/i.test(message)) throw error;
      onEvent?.({ type: 'thinking', data: { providerId: provider.id, agent: agentId, status: 'Recovering expired CommandCenter session...' } });
      commandCenterSessionId = await createCommandCenterSession();
      streamed = await streamCommandCenterTurn({ sessionId: commandCenterSessionId, agentId, message: request.message, mode: requestedMode, model: request.model, fileIds: request.fileIds, onEvent });
    }
    return {
      providerId: provider.id,
      agentId,
      sessionId: commandCenterSessionId,
      runtime: 'commandcenter',
      text: streamed.text,
      mode: requestedMode,
      model: typeof (streamed.metadata as Record<string, unknown>).model === 'string' ? String((streamed.metadata as Record<string, unknown>).model) : request.model,
      metadata: {
        ...streamed.metadata,
        mode: requestedMode,
        providerSessionId: commandCenterSessionId,
        commandCenterSessionId: commandCenterSessionId,
        transport: 'commandcenter-sse'
      }
    };
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
      mode: request.mode === 'roleplay' ? 'roleplay' : 'agent',
      model: request.model,
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
    const buildArgs = (resumeSessionId = '') => [
      ...(profile ? ['--profile', profile] : []),
      'chat', '--cli', '-q', request.message,
      '-Q',
      '--source', hermesSessionSource,
      ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
      ...(model ? ['--model', model] : [])
    ];

    const requestedHermesSessionId = String(request.providerSessionId || '').trim();
    let recoveredStaleSession = false;
    let commandResult;
    try {
      commandResult = await runCommand(hermesBin, buildArgs(requestedHermesSessionId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      if (!requestedHermesSessionId || !/session\s+not\s+found/i.test(message)) throw error;
      recoveredStaleSession = true;
      onEvent?.({ type: 'thinking', data: { providerId: provider.id, agent: agentId, status: 'Recovering expired Hermes session...' } });
      commandResult = await runCommand(hermesBin, buildArgs());
    }

    const parsed = parseHermesOutput(commandResult.stdout, commandResult.stderr);
    if (!parsed.text) throw new Error('Hermes returned no chat response.');
    const hermesSessionId = parsed.hermesSessionId || (recoveredStaleSession ? '' : requestedHermesSessionId);
    if ((!requestedHermesSessionId || recoveredStaleSession) && parsed.hermesSessionId) {
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
      mode: request.mode === 'roleplay' ? 'roleplay' : 'agent',
      model,
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
  return { providerId: provider.id, agentId, sessionId, runtime: 'mock', text, mode: request.mode === 'roleplay' ? 'roleplay' : 'agent', model: request.model };
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

function parseOpenClawSessions(output: string, providerId: string) {
  const body = JSON.parse(output || '{}') as { sessions?: Array<Record<string, unknown>> };
  return (body.sessions || []).map((session) => {
    const key = String(session.key || '');
    const marker = ':reika:';
    const providerSessionId = key.includes(marker) ? key.slice(key.indexOf(marker) + marker.length) : String(session.id || session.sessionId || '');
    return {
      providerId,
      providerSessionId,
      agentId: String(session.agentId || session.agent || 'main'),
      title: String(session.title || session.preview || providerSessionId || 'OpenClaw session'),
      createdAt: typeof session.createdAt === 'string' ? session.createdAt : undefined,
      updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : undefined,
      messageCount: typeof session.messageCount === 'number' ? session.messageCount : undefined,
      lastMessagePreview: typeof session.preview === 'string' ? session.preview : undefined,
      metadata: { openClawKey: key }
    };
  }).filter((session) => session.providerSessionId);
}

async function listCommandCenterHistory(providerId: string) {
  const response = await providerFetch(`${commandCenterBaseUrl}/sessions`, { headers: commandCenterHeaders() });
  const body = await response.json().catch(() => ({})) as { ok?: boolean; sessions?: Array<Record<string, unknown>>; error?: string };
  if (!response.ok || body.ok === false) throw new Error(String(body.error || `CommandCenter HTTP ${response.status}`));
  return (body.sessions || []).map((session) => ({
    providerId,
    providerSessionId: String(session.id || session.sessionId || ''),
    agentId: String(session.agent || 'reika'),
    title: String(session.title || session.preview || session.id || 'CommandCenter session'),
    createdAt: typeof session.createdAt === 'string' ? session.createdAt : undefined,
    updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : undefined,
    messageCount: typeof session.messageCount === 'number' ? session.messageCount : undefined,
    lastMessagePreview: typeof session.lastMessagePreview === 'string' ? session.lastMessagePreview : typeof session.preview === 'string' ? session.preview : undefined,
    metadata: { commandCenterSessionId: String(session.id || session.sessionId || '') }
  })).filter((session) => session.providerSessionId);
}

async function readOpenClawSessionTranscript(providerSessionId: string) {
  const raw = await readFile(join(homedir(), '.openclaw', 'sessions', 'index.json'), 'utf8');
  const index = JSON.parse(raw) as { sessions?: Array<Record<string, unknown>> };
  const marker = `:reika:${providerSessionId}`;
  const session = (index.sessions || []).find((candidate) => String(candidate.key || '').includes(marker))
    || (index.sessions || []).find((candidate) => candidate.sessionId === providerSessionId || candidate.key === providerSessionId);
  if (!session?.key || !session.agentId) throw new Error(`OpenClaw session not found: ${providerSessionId}`);
  const candidatePaths = [
    join(homedir(), '.openclaw', 'sessions', String(session.agentId), `${String(session.key)}.jsonl`),
    join(homedir(), '.openclaw', 'sessions', `${String(session.key)}.jsonl`)
  ];
  const transcriptPath = candidatePaths.find((path) => path && !path.includes(`..${sep}`));
  if (!transcriptPath) throw new Error(`OpenClaw transcript not found: ${providerSessionId}`);
  return readFile(transcriptPath, 'utf8');
}

function parseOpenClawTranscript(content: string): ProviderHistoryMessage[] {
  return content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      const role = String(record.role || '').toLowerCase();
      const text = extractMessageText(record.content || record.text || record.message);
      if (!text) return [];
      return [{
        id: typeof record.id === 'string' ? record.id : undefined,
        role: role === 'assistant' ? 'assistant' : role === 'system' ? 'system' : 'user',
        text,
        timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined,
        meta: record.meta && typeof record.meta === 'object' ? record.meta as Record<string, unknown> : undefined
      } satisfies ProviderHistoryMessage];
    } catch {
      return [];
    }
  });
}

export async function listProviderHistorySessions(providerId: string, providers: ProviderRecord[], _limit = 25): Promise<ProviderHistorySession[]> {
  const provider = findProvider(providers, providerId);
  if (!provider) throw new Error(`Provider not found: ${providerId}`);
  if (provider.kind === 'commandcenter') return listCommandCenterHistory(provider.id);
  if (provider.kind === 'openclaw') {
    const { stdout } = await runCommand(openClawBin, ['sessions', 'list', '--json'], 30000);
    return parseOpenClawSessions(stdout, provider.id);
  }
  if (provider.kind === 'hermes') {
    const { stdout, stderr } = await runCommand(hermesBin, ['sessions'], 30000);
    return parseHermesSessionsList(stdout || stderr, provider.id);
  }
  return [{
    providerId: provider.id,
    providerSessionId: 'mock_session',
    agentId: provider.agents[0]?.id || 'reika',
    title: `${provider.name} mock session`,
    updatedAt: new Date().toISOString(),
    lastMessagePreview: 'Mock provider does not keep historical sessions.'
  }];
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
    return parseOpenClawTranscript(transcript);
  }
  if (provider.kind === 'commandcenter') {
    const response = await providerFetch(`${commandCenterBaseUrl}/sessions/${encodeURIComponent(providerSessionId)}/messages`, { headers: commandCenterHeaders() });
    const body = await response.json().catch(() => ({})) as { ok?: boolean; messages?: Array<Record<string, unknown>>; error?: string };
    if (!response.ok || body.ok === false) throw new Error(String(body.error || `CommandCenter HTTP ${response.status}`));
    return (body.messages || []).map((message) => {
      const role = String(message.role || 'user') === 'assistant' ? 'assistant' : String(message.role || 'user') === 'system' ? 'system' : 'user';
      return {
        id: typeof message.id === 'string' ? message.id : undefined,
        role: role as ProviderHistoryMessage['role'],
        text: extractMessageText(message.text || message.content || message.message),
        timestamp: typeof message.timestamp === 'string' ? message.timestamp : undefined,
        meta: message.meta && typeof message.meta === 'object' ? message.meta as Record<string, unknown> : undefined
      };
    }).filter((message) => message.text);
  }
  if (provider.kind === 'hermes') {
    const { stdout, stderr } = await runCommand(hermesBin, ['session', 'show', providerSessionId], 30000).catch(() => runCommand(hermesBin, ['sessions', 'show', providerSessionId], 30000));
    const text = String(stdout || stderr || '').trim();
    return text ? [{ role: 'assistant', text }] : [];
  }
  return [];
}
