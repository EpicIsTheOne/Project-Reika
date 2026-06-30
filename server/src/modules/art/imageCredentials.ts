import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

interface ImageCredentialStore {
  version: 1;
  updatedAt: string;
  openAiApiKey?: string;
}

const defaultCredentialPath = join(homedir(), '.local', 'share', 'project-reika', 'image-auth.json');

function credentialPath() {
  return process.env.REIKA_IMAGE_AUTH_STORE_PATH || defaultCredentialPath;
}

function cleanApiKey(value: unknown) {
  return typeof value === 'string' && value.trim().startsWith('sk-') ? value.trim() : undefined;
}

async function readStore(): Promise<ImageCredentialStore> {
  try {
    const raw = await readFile(credentialPath(), 'utf8');
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<ImageCredentialStore>;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
      openAiApiKey: cleanApiKey(parsed.openAiApiKey)
    };
  } catch {
    return { version: 1, updatedAt: new Date(0).toISOString() };
  }
}

export async function getStoredImageApiKey() {
  const store = await readStore();
  return cleanApiKey(store.openAiApiKey);
}

export async function hasStoredImageApiKey() {
  return Boolean(await getStoredImageApiKey());
}

export async function saveStoredImageApiKey(apiKey: unknown) {
  const clean = cleanApiKey(apiKey);
  if (!clean) throw new Error('Enter a valid OpenAI API key beginning with sk-.');
  const path = credentialPath();
  const payload: ImageCredentialStore = {
    version: 1,
    updatedAt: new Date().toISOString(),
    openAiApiKey: clean
  };
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, path);
}

export async function clearStoredImageApiKey() {
  try {
    await unlink(credentialPath());
  } catch {
    // Already clear.
  }
}

