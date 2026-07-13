import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getStoredImageApiKey, hasStoredImageApiKey } from './imageCredentials.js';

export interface ImageAuthStatus {
  connected: boolean;
  provider: 'openai-api-key' | 'codex-oauth';
  source: 'env' | 'stored' | 'codex-auth' | 'codex-oauth' | 'none';
  imageGenerationAvailable: boolean;
  quotaLabel?: string;
  message: string;
}

export interface GeneratedImageResult {
  base64: string;
  mimeType: string;
  model: string;
  provider: ImageAuthStatus['provider'];
  revisedPrompt?: string;
}

export interface ImageReferenceInput {
  name: string;
  filePath: string;
  mimeType: string;
}

interface CodexAuthFile {
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
}

const defaultCodexAuthPath = join(homedir(), '.codex', 'auth.json');

function codexAuthPath() {
  return process.env.REIKA_CODEX_AUTH_PATH || defaultCodexAuthPath;
}

function imageModel() {
  return process.env.REIKA_ART_IMAGE_MODEL || 'gpt-image-2';
}

function imageSize() {
  return process.env.REIKA_ART_IMAGE_SIZE || '1024x1024';
}

function imageQuality() {
  return process.env.REIKA_ART_IMAGE_QUALITY || 'high';
}

function codexChatModel() {
  return process.env.REIKA_CODEX_IMAGE_CHAT_MODEL || 'gpt-5.5';
}

function codexBaseUrl() {
  return (process.env.REIKA_CODEX_BASE_URL || 'https://chatgpt.com/backend-api/codex').replace(/\/+$/u, '');
}

function cleanToken(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

async function readCodexAuth(): Promise<CodexAuthFile | undefined> {
  try {
    const raw = await readFile(codexAuthPath(), 'utf8');
    return JSON.parse(raw.replace(/^\uFEFF/, '')) as CodexAuthFile;
  } catch {
    return undefined;
  }
}

export async function getImageAuthStatus(): Promise<ImageAuthStatus> {
  const apiKey = cleanToken(process.env.OPENAI_API_KEY || process.env.REIKA_OPENAI_API_KEY);
  if (apiKey) {
    return {
      connected: true,
      provider: 'openai-api-key',
      source: 'env',
      imageGenerationAvailable: true,
      quotaLabel: 'OpenAI API',
      message: `OpenAI image generation is configured with ${imageModel()}.`
    };
  }

  if (await hasStoredImageApiKey()) {
    return {
      connected: true,
      provider: 'openai-api-key',
      source: 'stored',
      imageGenerationAvailable: true,
      quotaLabel: 'Saved OpenAI API key',
      message: `OpenAI image generation is configured from the saved local API key with ${imageModel()}.`
    };
  }

  const auth = await readCodexAuth();
  const codexApiKey = cleanToken(auth?.OPENAI_API_KEY);
  if (codexApiKey) {
    return {
      connected: true,
      provider: 'openai-api-key',
      source: 'codex-auth',
      imageGenerationAvailable: true,
      quotaLabel: 'Codex auth API key',
      message: `OpenAI image generation is configured from Codex auth with ${imageModel()}.`
    };
  }

  if (cleanToken(auth?.tokens?.access_token)) {
    return {
      connected: true,
      provider: 'codex-oauth',
      source: 'codex-oauth',
      imageGenerationAvailable: true,
      quotaLabel: 'ChatGPT OAuth',
      message: `Codex/ChatGPT OAuth token found. Reika will use ${imageModel()} through the Codex image_generation tool.`
    };
  }

  return {
    connected: false,
    provider: 'codex-oauth',
    source: 'none',
    imageGenerationAvailable: false,
    quotaLabel: 'Unavailable',
    message: 'No OpenAI API key or Codex/ChatGPT OAuth token is available to the local server.'
  };
}

async function resolveAuthHeader() {
  const apiKey = cleanToken(process.env.OPENAI_API_KEY || process.env.REIKA_OPENAI_API_KEY);
  if (apiKey) return { provider: 'openai-api-key' as const, value: apiKey };

  const storedApiKey = await getStoredImageApiKey();
  if (storedApiKey) return { provider: 'openai-api-key' as const, value: storedApiKey };

  const auth = await readCodexAuth();
  const codexApiKey = cleanToken(auth?.OPENAI_API_KEY);
  if (codexApiKey) return { provider: 'openai-api-key' as const, value: codexApiKey };

  const accessToken = cleanToken(auth?.tokens?.access_token);
  if (accessToken) return { provider: 'codex-oauth' as const, value: accessToken };

  return undefined;
}

function extractImageBase64(payload: unknown) {
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return undefined;
  const first = data[0] as { b64_json?: unknown; url?: unknown; revised_prompt?: unknown } | undefined;
  if (!first) return undefined;
  if (typeof first.b64_json === 'string' && first.b64_json.length > 0) {
    return {
      base64: first.b64_json,
      revisedPrompt: typeof first.revised_prompt === 'string' ? first.revised_prompt : undefined
    };
  }
  return undefined;
}

function upstreamMessage(payload: unknown, fallback: string) {
  const maybe = payload as { error?: { message?: unknown; code?: unknown; type?: unknown }; message?: unknown };
  const parts = [
    typeof maybe.error?.message === 'string' ? maybe.error.message : undefined,
    typeof maybe.error?.code === 'string' ? maybe.error.code : undefined,
    typeof maybe.error?.type === 'string' ? maybe.error.type : undefined,
    typeof maybe.message === 'string' ? maybe.message : undefined
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : fallback;
}

export async function generateImageWithOpenAI(input: { prompt: string; systemPrompt?: string; references?: ImageReferenceInput[] }): Promise<GeneratedImageResult> {
  const auth = await resolveAuthHeader();
  if (!auth) {
    throw new Error('No OpenAI API key or Codex/ChatGPT OAuth token is available to generate art.');
  }

  const model = imageModel();
  const prompt = [input.systemPrompt, input.prompt].filter(Boolean).join('\n\n');
  const references = input.references?.filter((item) => item.filePath).slice(0, 4) ?? [];
  if (auth.provider === 'codex-oauth') {
    return generateImageWithCodexOAuth({ prompt, token: auth.value, model, references });
  }

  if (references.length > 0) {
    return generateImageEditWithOpenAI({ prompt, token: auth.value, model, references });
  }

  const response = await fetch(process.env.REIKA_OPENAI_IMAGES_URL || 'https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.value}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v2'
    },
    body: JSON.stringify({
      model,
      prompt,
      size: imageSize(),
      quality: imageQuality(),
      n: 1,
      response_format: 'b64_json'
    })
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    throw new Error(`OpenAI image generation failed (${response.status}): ${upstreamMessage(payload, response.statusText)}. Check that the saved API key has access to ${model} and image generation scopes.`);
  }

  const image = extractImageBase64(payload);
  if (!image) throw new Error('OpenAI image generation completed but returned no base64 image data.');

  return {
    ...image,
    mimeType: 'image/png',
    model,
    provider: auth.provider
  };
}

async function generateImageEditWithOpenAI(input: { prompt: string; token: string; model: string; references: ImageReferenceInput[] }): Promise<GeneratedImageResult> {
  const endpoint = process.env.REIKA_OPENAI_IMAGES_EDIT_URL || 'https://api.openai.com/v1/images/edits';
  const first = await postImageEdit(endpoint, input, 'image[]');
  if (!first.response.ok && first.response.status === 400) {
    const retry = await postImageEdit(endpoint, input, 'image');
    if (retry.response.ok) return imageEditResult(retry.payload, input.model);
    throw imageEditError(retry.response, retry.payload);
  }
  if (!first.response.ok) throw imageEditError(first.response, first.payload);
  return imageEditResult(first.payload, input.model);
}

async function postImageEdit(endpoint: string, input: { prompt: string; token: string; model: string; references: ImageReferenceInput[] }, imageFieldName: string) {
  const form = new FormData();
  form.set('model', input.model);
  form.set('prompt', input.prompt);
  form.set('size', imageSize());
  form.set('quality', imageQuality());
  form.set('n', '1');
  form.set('response_format', 'b64_json');

  for (const reference of input.references) {
    const buffer = await readFile(reference.filePath);
    const blob = new Blob([buffer], { type: reference.mimeType || 'image/png' });
    form.append(imageFieldName, blob, reference.name || 'reference.png');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.token}`,
      'OpenAI-Beta': 'assistants=v2'
    },
    body: form
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  return { response, payload };
}

function imageEditError(response: Response, payload: unknown) {
  return new Error(`OpenAI reference image generation failed (${response.status}): ${upstreamMessage(payload, response.statusText)}. Check that the selected reference images are valid PNG/JPEG/WebP files and that the saved key has image edit access.`);
}

function imageEditResult(payload: unknown, model: string): GeneratedImageResult {
  const image = extractImageBase64(payload);
  if (!image) throw new Error('OpenAI reference image generation completed but returned no base64 image data.');

  return {
    ...image,
    mimeType: 'image/png',
    model,
    provider: 'openai-api-key'
  };
}

async function generateImageWithCodexOAuth(input: { prompt: string; token: string; model: string; references: ImageReferenceInput[] }): Promise<GeneratedImageResult> {
  const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: input.prompt }];
  for (const reference of input.references) {
    const buffer = await readFile(reference.filePath);
    const mimeType = reference.mimeType || 'image/png';
    content.push({
      type: 'input_image',
      image_url: `data:${mimeType};base64,${buffer.toString('base64')}`
    });
  }

  const response = await fetch(`${codexBaseUrl()}/responses`, {
    method: 'POST',
    headers: {
      ...codexHeaders(input.token),
      Accept: 'text/event-stream',
      Authorization: `Bearer ${input.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: codexChatModel(),
      store: false,
      instructions: 'You are an assistant that must fulfill image generation requests by using the image_generation tool when provided.',
      input: [{
        type: 'message',
        role: 'user',
        content
      }],
      tools: [{
        type: 'image_generation',
        model: input.model,
        size: imageSize(),
        quality: imageQuality(),
        output_format: 'png',
        background: 'opaque',
        partial_images: 1
      }],
      tool_choice: {
        type: 'allowed_tools',
        mode: 'required',
        tools: [{ type: 'image_generation' }]
      },
      stream: true
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Codex OAuth image generation failed (${response.status}): ${raw.slice(0, 800) || response.statusText}`);
  }

  const base64 = extractCodexImageBase64(raw);
  if (!base64) throw new Error('Codex OAuth image generation completed but returned no image_generation result.');
  return {
    base64,
    mimeType: 'image/png',
    model: input.model,
    provider: 'codex-oauth'
  };
}

function codexHeaders(accessToken: string) {
  const headers: Record<string, string> = {
    'User-Agent': 'codex_cli_rs/0.0.0 (Project Reika)',
    originator: 'codex_cli_rs'
  };
  const accountId = chatGptAccountId(accessToken);
  if (accountId) headers['ChatGPT-Account-ID'] = accountId;
  return headers;
}

function chatGptAccountId(accessToken: string) {
  try {
    const [, payload] = accessToken.split('.');
    if (!payload) return undefined;
    const padded = payload.padEnd(payload.length + ((4 - payload.length % 4) % 4), '=');
    const decoded = JSON.parse(Buffer.from(padded, 'base64url').toString('utf8')) as {
      'https://api.openai.com/auth'?: { chatgpt_account_id?: unknown };
    };
    const accountId = decoded['https://api.openai.com/auth']?.chatgpt_account_id;
    return typeof accountId === 'string' && accountId ? accountId : undefined;
  } catch {
    return undefined;
  }
}

function extractCodexImageBase64(rawSse: string) {
  let latest: string | undefined;
  for (const event of parseSseJson(rawSse)) {
    const found = findCodexImageBase64(event);
    if (found) latest = found;
  }
  return latest;
}

function parseSseJson(rawSse: string) {
  const payloads: unknown[] = [];
  let eventName = '';
  let dataLines: string[] = [];
  const flush = () => {
    const raw = dataLines.join('\n').trim();
    dataLines = [];
    if (!raw || raw === '[DONE]') {
      eventName = '';
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (eventName && typeof parsed.type !== 'string') parsed.type = eventName;
      payloads.push(parsed);
    } catch {
      // Ignore non-JSON SSE records.
    }
    eventName = '';
  };

  for (const line of rawSse.split(/\r?\n/u)) {
    if (line === '') {
      flush();
    } else if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  flush();
  return payloads;
}

function findCodexImageBase64(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCodexImageBase64(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (record.type === 'image_generation_call' && typeof record.result === 'string' && record.result) return record.result;
  if (typeof record.partial_image_b64 === 'string' && record.partial_image_b64) return record.partial_image_b64;
  for (const child of Object.values(record)) {
    const found = findCodexImageBase64(child);
    if (found) return found;
  }
  return undefined;
}
