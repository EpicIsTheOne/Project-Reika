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
      message: `Codex/ChatGPT OAuth token found. AgentHub will try ${imageModel()} through the OpenAI image API.`
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

export async function generateImageWithOpenAI(input: { prompt: string; systemPrompt?: string }): Promise<GeneratedImageResult> {
  const auth = await resolveAuthHeader();
  if (!auth) {
    throw new Error('No OpenAI API key or Codex/ChatGPT OAuth token is available to generate art.');
  }

  const model = imageModel();
  const prompt = [input.systemPrompt, input.prompt].filter(Boolean).join('\n\n');
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
    const hint = auth.provider === 'codex-oauth'
      ? ' The ChatGPT OAuth token may not be accepted by this OpenAI API endpoint; set OPENAI_API_KEY or REIKA_OPENAI_API_KEY if this keeps failing.'
      : '';
    throw new Error(`OpenAI image generation failed (${response.status}): ${upstreamMessage(payload, response.statusText)}.${hint}`);
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
