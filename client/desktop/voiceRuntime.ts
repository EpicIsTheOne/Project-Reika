import { app, ipcMain, safeStorage } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tagTtsText } from "fish-audio-tts-toolkit/src/tagging.js";
import { searchFishModelsByName } from "fish-audio-tts-toolkit/src/search.js";
import { buildDirectFishTtsSettings, buildFishTtsPayload, callFishTTS } from "fish-audio-tts-toolkit/src/fish.js";

const FISH_BASE_URL = "https://api.fish.audio";
const FISH_BACKEND = "s2-pro";
const MAX_CACHE_ENTRIES = 24;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const CACHE_TTL_MS = 60 * 60 * 1000;

type SecretRecord = { encrypted: string; updatedAt: string; lastValidatedAt?: string };
type SecretFile = { version: 1; secrets: Record<string, SecretRecord> };
type CachedAudio = { at: number; bytes: Buffer; contentType: string; taggedText: string; spokenText: string; tags: string[] };

const modelCache = new Map();
const audioCache = new Map<string, CachedAudio>();
const activeRequests = new Map<string, AbortController>();

function secretPath() { return join(app.getPath("userData"), "secure-secrets.bin"); }
function encryptionReady() {
  const backend = (safeStorage as typeof safeStorage & { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend?.();
  return safeStorage.isEncryptionAvailable() && backend !== "basic_text";
}

async function readSecrets(): Promise<SecretFile> {
  try {
    const parsed = JSON.parse(await readFile(secretPath(), "utf8")) as SecretFile;
    return parsed?.version === 1 && parsed.secrets && typeof parsed.secrets === "object" ? parsed : { version: 1, secrets: {} };
  } catch {
    return { version: 1, secrets: {} };
  }
}

async function writeSecrets(value: SecretFile) {
  await mkdir(dirname(secretPath()), { recursive: true });
  const temporary = `${secretPath()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, secretPath());
}

async function getFishKey() {
  if (!encryptionReady()) throw new Error("Secure operating-system secret storage is unavailable.");
  const record = (await readSecrets()).secrets.fishAudio;
  if (!record?.encrypted) throw new Error("Fish Audio API key is not configured.");
  try {
    return safeStorage.decryptString(Buffer.from(record.encrypted, "base64"));
  } catch {
    throw new Error("Fish Audio secret could not be decrypted on this device.");
  }
}

function publicStatus(file: SecretFile) {
  const record = file.secrets.fishAudio;
  return { configured: Boolean(record?.encrypted), secureStorageAvailable: encryptionReady(), updatedAt: record?.updatedAt, lastValidatedAt: record?.lastValidatedAt };
}

function cleanError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "Voice operation failed.");
  return raw
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[a-f0-9]{32,}/gi, "[redacted]")
    .replace(/api[_ -]?key\s*[:=]\s*\S+/gi, "API key [redacted]")
    .slice(0, 500);
}

function requireText(value: unknown, label: string, maximum = 2500) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maximum) throw new Error(`${label} is too long.`);
  return text;
}

function normalizeVoiceId(value: unknown) {
  const id = requireText(value, "Fish reference ID", 240);
  if (!/^[A-Za-z0-9_-]{8,240}$/.test(id)) throw new Error("Fish reference ID contains invalid characters.");
  return id;
}

async function testFishKey(apiKey: string, signal?: AbortSignal) {
  const result = await searchFishModelsByName("English", {
    apiKey, baseUrl: FISH_BASE_URL, cache: new Map(), limit: 1, pageSize: 1, maxCacheEntries: 2, signal: signal ?? AbortSignal.timeout(20000)
  });
  return Boolean(result && Array.isArray(result.items));
}

function pruneAudioCache() {
  const now = Date.now();
  for (const [key, value] of audioCache) if (now - value.at > CACHE_TTL_MS) audioCache.delete(key);
  let bytes = [...audioCache.values()].reduce((total, item) => total + item.bytes.length, 0);
  while (audioCache.size > MAX_CACHE_ENTRIES || bytes > MAX_CACHE_BYTES) {
    const oldest = audioCache.entries().next().value as [string, CachedAudio] | undefined;
    if (!oldest) break;
    audioCache.delete(oldest[0]);
    bytes -= oldest[1].bytes.length;
  }
}

export function registerVoiceRuntime() {
  ipcMain.handle("reika-voice:secret-status", async () => publicStatus(await readSecrets()));
  ipcMain.handle("reika-voice:save-secret", async (_event, input = {}) => {
    if (!encryptionReady()) throw new Error("Secure operating-system secret storage is unavailable.");
    const apiKey = requireText((input as { apiKey?: unknown }).apiKey, "Fish Audio API key", 500);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      await testFishKey(apiKey, controller.signal);
      const file = await readSecrets();
      file.secrets.fishAudio = { encrypted: safeStorage.encryptString(apiKey).toString("base64"), updatedAt: new Date().toISOString(), lastValidatedAt: new Date().toISOString() };
      await writeSecrets(file);
      return publicStatus(file);
    } catch (error) {
      throw new Error(cleanError(error));
    } finally {
      clearTimeout(timeout);
    }
  });
  ipcMain.handle("reika-voice:test-secret", async () => {
    try {
      const apiKey = await getFishKey();
      await testFishKey(apiKey);
      const file = await readSecrets();
      if (file.secrets.fishAudio) file.secrets.fishAudio.lastValidatedAt = new Date().toISOString();
      await writeSecrets(file);
      return publicStatus(file);
    } catch (error) { throw new Error(cleanError(error)); }
  });
  ipcMain.handle("reika-voice:remove-secret", async () => {
    const file = await readSecrets();
    delete file.secrets.fishAudio;
    if (Object.keys(file.secrets).length) await writeSecrets(file); else await rm(secretPath(), { force: true });
    audioCache.clear();
    return publicStatus(file);
  });
  ipcMain.handle("reika-voice:search", async (_event, input = {}) => {
    try {
      const apiKey = await getFishKey();
      const query = requireText((input as { query?: unknown }).query, "Voice search", 120);
      const result = await searchFishModelsByName(query, {
        apiKey, baseUrl: FISH_BASE_URL, cache: modelCache, limit: 8, pageSize: 12, maxCacheEntries: 100, signal: AbortSignal.timeout(20000)
      });
      return { query: result.query, items: result.items.map((item: Record<string, unknown>) => ({
        id: String(item._id || ""), title: String(item.title || item._id || "Fish voice"),
        description: String(item.description || ""), tags: Array.isArray(item.tags) ? item.tags.map(String).slice(0, 12) : [],
        languages: Array.isArray(item.languages) ? item.languages.map(String).slice(0, 8) : [],
        coverImage: typeof item.cover_image === "string" ? item.cover_image : undefined,
        matchReasons: Array.isArray(item.matchReasons) ? item.matchReasons.map(String).slice(0, 5) : []
      })) };
    } catch (error) { throw new Error(cleanError(error)); }
  });
  ipcMain.handle("reika-voice:tag", async (_event, input = {}) => {
    try { return await tagTtsText({ text: requireText((input as { text?: unknown }).text, "Speech text") }); }
    catch (error) { throw new Error(cleanError(error)); }
  });
  ipcMain.handle("reika-voice:synthesize", async (_event, input = {}) => {
    const request = input as { requestId?: unknown; text?: unknown; voiceId?: unknown };
    const requestId = requireText(request.requestId, "Voice request ID", 160);
    const text = requireText(request.text, "Speech text");
    const voiceId = normalizeVoiceId(request.voiceId);
    const cacheKey = createHash("sha256").update(`${voiceId}\0${text}`).digest("hex");
    pruneAudioCache();
    const cached = audioCache.get(cacheKey);
    if (cached) return { requestId, audioBase64: cached.bytes.toString("base64"), contentType: cached.contentType, taggedText: cached.taggedText, spokenText: cached.spokenText, tags: cached.tags, cacheHit: true };
    const controller = new AbortController();
    activeRequests.get(requestId)?.abort();
    activeRequests.set(requestId, controller);
    try {
      const apiKey = await getFishKey();
      const tagged = await tagTtsText({ text });
      const settings = buildDirectFishTtsSettings({ voiceId, format: "mp3", latency: "low" });
      const payload = buildFishTtsPayload({ text: tagged.taggedText, settings });
      const result = await callFishTTS({ apiKey, baseUrl: FISH_BASE_URL, backend: FISH_BACKEND, payload, signal: controller.signal });
      if (activeRequests.get(requestId) !== controller || controller.signal.aborted) throw new DOMException("Voice synthesis was cancelled.", "AbortError");
      const entry = { at: Date.now(), bytes: Buffer.from(result.buffer), contentType: result.contentType, taggedText: tagged.taggedText, spokenText: tagged.spokenText, tags: tagged.tags };
      audioCache.set(cacheKey, entry);
      pruneAudioCache();
      return { requestId, audioBase64: entry.bytes.toString("base64"), contentType: entry.contentType, taggedText: entry.taggedText, spokenText: entry.spokenText, tags: entry.tags, cacheHit: false };
    } catch (error) { throw new Error(cleanError(error)); }
    finally { if (activeRequests.get(requestId) === controller) activeRequests.delete(requestId); }
  });
  ipcMain.handle("reika-voice:cancel", async (_event, input = {}) => {
    const requestId = typeof (input as { requestId?: unknown }).requestId === "string" ? String((input as { requestId: string }).requestId) : "";
    if (requestId) { activeRequests.get(requestId)?.abort(); activeRequests.delete(requestId); }
    return { cancelled: Boolean(requestId) };
  });
  ipcMain.handle("reika-voice:stop-all", async () => {
    for (const controller of activeRequests.values()) controller.abort();
    activeRequests.clear();
    return { stopped: true };
  });
}
