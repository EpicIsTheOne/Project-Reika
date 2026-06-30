export type ReikaProviderKind = "commandcenter" | "openclaw" | "hermes" | "mock";
export type ReikaProviderStatus = "preferred" | "available" | "planned" | "offline" | "error";
export type ReikaMessageRole = "user" | "assistant" | "system";

export interface ReikaProviderCapability {
  id: string;
  label: string;
  planned?: boolean;
}

export interface ReikaAgentSummary {
  id: string;
  name: string;
  label?: string;
  model?: string;
  source?: string;
  role?: string;
  characterId?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ReikaProviderRecord {
  id: string;
  kind: ReikaProviderKind;
  name: string;
  status: ReikaProviderStatus;
  priority: number;
  endpointLabel: string;
  capabilities: ReikaProviderCapability[];
  agents: ReikaAgentSummary[];
  notes: string;
  error?: string;
}

export interface ReikaDeviceSnapshot {
  id?: string;
  name?: string;
  deviceId?: string;
  platform?: string;
  hostname?: string;
  startedAt?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ReikaSessionSummary {
  id: string;
  providerId: string;
  agent: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string;
  metadata?: Record<string, unknown>;
}

export interface ReikaChatMessage {
  id: string;
  role: ReikaMessageRole;
  text: string;
  timestamp: string;
  meta?: Record<string, unknown>;
}

export interface ReikaChatResult {
  providerId: string;
  agentId: string;
  sessionId: string;
  runtime: ReikaProviderKind;
  text: string;
  raw?: string;
  metadata?: Record<string, unknown>;
}

export interface ReikaFileItem {
  id: string;
  kind: "file" | "link";
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: number;
  sourceUrl?: string;
  notes?: string;
}

export interface ReikaUplinkSnapshot {
  enabled?: boolean;
  connected?: boolean;
  status?: string;
  relayUrl?: string;
  deviceId?: string;
  lastError?: string;
  [key: string]: unknown;
}

export interface ReikaStartupStatus {
  supported: boolean;
  enabled: boolean;
  method: string;
  configPath?: string;
  command?: string;
  message?: string;
}

export interface ReikaHealthResponse {
  ok: true;
  service: string;
  status: string;
  settings?: unknown;
  notifications?: unknown;
  uplink?: ReikaUplinkSnapshot;
}

export interface ReikaSettings {
  version: 1;
  language: string;
  startupView: "home" | "chat" | "devices" | "notifications" | "settings";
  relayUrl: string;
  theme: "dark" | "blue" | "contrast";
  minimizeToTray: boolean;
  mockEnabled: boolean;
  notificationPreferences: ReikaNotificationPreferences;
  autoUpdateServer: boolean;
  autoUpdateClient: boolean;
  developerDiagnostics: boolean;
  updatedAt: string;
}

export interface ReikaUpdateFileChange {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
}

export interface ReikaUpdateDescription {
  sha: string;
  title: string;
  body?: string;
  author?: string;
  date?: string;
}

export interface ReikaUpdateStatus {
  ok: true;
  supported: boolean;
  mode?: "git" | "packaged";
  repoRoot?: string;
  branch?: string;
  localSha?: string;
  remoteSha?: string;
  behindBy: number;
  aheadBy: number;
  available: boolean;
  files: ReikaUpdateFileChange[];
  descriptions: ReikaUpdateDescription[];
  message: string;
  checkedAt: string;
  installerAsset?: {
    name: string;
    url: string;
    size?: number;
    version?: string;
  };
  settings?: {
    autoUpdateServer: boolean;
    autoUpdateClient: boolean;
  };
  applied?: boolean;
  applyOutput?: string;
}

export interface ReikaCacheStatus {
  ok: true;
  cache: {
    events: { count: number };
    sessions?: unknown;
    files?: unknown;
    art?: unknown;
    notifications?: unknown;
  };
  cleared?: boolean;
}

export interface ReikaSecurityStatus {
  ok: true;
  security: {
    localOnly: boolean;
    relayAuth: string;
    activeSessions: ReikaSessionSummary[];
    device?: ReikaDeviceSnapshot;
    uplink?: ReikaUplinkSnapshot;
  };
}

export type ReikaArtScope = "agent" | "global";
export type ReikaArtSelectionMode = "single" | "random";
export type ReikaArtAssetKind = "seed" | "upload" | "generated" | "reference" | "link";

export interface ReikaArtAsset {
  id: string;
  name: string;
  kind: ReikaArtAssetKind;
  createdAt: string;
  assetKey?: string;
  sourceUrl?: string;
  filePath?: string;
  mimeType?: string;
  size?: number;
  prompt?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface ReikaArtCategory {
  id: string;
  name: string;
  description: string;
  usage: string;
  icon: string;
  selectionMode: ReikaArtSelectionMode;
  selectedAssetId?: string;
  prompt: string;
  systemPrompt: string;
  referenceAssetIds: string[];
  assets: ReikaArtAsset[];
  locked?: boolean;
}

export interface ReikaArtProfile {
  id: string;
  scope: ReikaArtScope;
  name: string;
  subtitle: string;
  status: "online" | "offline" | "draft";
  providerLabel: string;
  avatarAssetKey: string;
  defaultProfile?: boolean;
  createdAt: string;
  updatedAt: string;
  categories: ReikaArtCategory[];
}

export interface ReikaArtOAuthStatus {
  connected: boolean;
  provider: "codex-oauth" | "openai-api-key";
  source: "env" | "stored" | "codex-auth" | "codex-oauth" | "none";
  imageGenerationAvailable: boolean;
  quotaLabel?: string;
  message: string;
}

export interface ReikaArtStorage {
  path: string;
  assetDir: string;
  loaded: boolean;
  profileCount: number;
  assetCount: number;
  lastSavedAt?: string;
  lastError?: string;
}

export interface ReikaArtGenerationStatus {
  status: "blocked" | "queued" | "running" | "completed" | "failed";
  provider: string;
  profileId: string;
  categoryId: string;
  assetId?: string;
  message: string;
  prompt?: string;
  systemPrompt?: string;
}

export interface ReikaArtLibraryResponse {
  ok: true;
  storage: ReikaArtStorage;
  oauth: ReikaArtOAuthStatus;
  profiles: ReikaArtProfile[];
}

export type ReikaNotificationKind = "agent" | "device" | "provider" | "chat" | "file" | "system" | "warning";
export type ReikaNotificationTone = "blue" | "green" | "purple" | "orange" | "red" | "gray" | "pink";
export type ReikaNotificationPreferences = Record<ReikaNotificationKind, boolean>;

export interface ReikaNotification {
  id: string;
  kind: ReikaNotificationKind;
  title: string;
  body: string;
  source: string;
  tone: ReikaNotificationTone;
  unread: boolean;
  createdAt: string;
  readAt?: string;
  data?: Record<string, unknown>;
}

export interface ReikaStateResponse {
  ok: true;
  device: ReikaDeviceSnapshot;
  activeProviderId: string;
  settings?: ReikaSettings;
  notifications?: {
    count: number;
    unreadCount: number;
    loaded: boolean;
    path?: string;
  };
  providerDetection?: {
    lastDetectionAt?: string;
    priority?: string[];
  };
  providers: ReikaProviderRecord[];
  agents?: ReikaAgentSummary[];
  sessionStore?: {
    loaded: boolean;
    sessionCount: number;
    path?: string;
    lastSavedAt?: string;
    lastError?: string;
  };
  fileStore?: {
    loaded: boolean;
    count: number;
    path?: string;
    dir?: string;
  };
  uplink?: ReikaUplinkSnapshot;
  connectionPolicy?: Record<string, unknown>;
}

export interface ReikaChatRequest {
  providerId?: string;
  agent?: string;
  sessionId?: string;
  message: string;
  title?: string;
  model?: string;
  metadata?: Record<string, unknown>;
  fileIds?: string[];
}

export interface ReikaApiErrorBody {
  ok?: false;
  error?: string;
  code?: string;
}

export class ReikaApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ReikaApiError";
    this.status = status;
    this.code = code;
  }
}

const API_BASE = "/agent";

export async function getHealth() {
  return request<ReikaHealthResponse>("/health");
}

export async function getState() {
  return request<ReikaStateResponse>("/state");
}

export async function getSettings() {
  return request<{ ok: true; settings: ReikaSettings; storage?: unknown }>("/settings");
}

export async function patchSettings(input: Partial<Omit<ReikaSettings, "version" | "updatedAt">>) {
  return request<{ ok: true; settings: ReikaSettings; state: ReikaStateResponse }>("/settings", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function getUpdateStatus() {
  return request<ReikaUpdateStatus>("/updates/status");
}

export async function checkForUpdates() {
  return request<ReikaUpdateStatus>("/updates/check", { method: "POST" });
}

export async function applyUpdates() {
  return request<ReikaUpdateStatus>("/updates/apply", { method: "POST" });
}

export async function getCacheStatus() {
  return request<ReikaCacheStatus>("/cache");
}

export async function clearCache() {
  return request<ReikaCacheStatus>("/cache/clear", { method: "POST" });
}

export async function getSecurityStatus() {
  return request<ReikaSecurityStatus>("/security/sessions");
}

export async function browseAgentMemory(agent = "reika", limit = 12) {
  const params = compactParams({ agent, limit });
  return request<{ ok: true; agent: string; memories: ReikaSessionSummary[] }>(`/memory/reika${params}`);
}

export async function getArtLibrary() {
  return request<ReikaArtLibraryResponse>("/art");
}

export async function getArtOAuthStatus() {
  return request<{ ok: true; oauth: ReikaArtOAuthStatus }>("/art/oauth/status");
}

export async function connectArtOAuth(input: { apiKey?: string }) {
  return request<{ ok: true; oauth: ReikaArtOAuthStatus; message: string }>("/art/oauth/connect", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function disconnectArtOAuth() {
  return request<{ ok: true; oauth: ReikaArtOAuthStatus; message: string }>("/art/oauth/disconnect", { method: "POST" });
}

export async function createArtProfile(input: { name?: string; subtitle?: string; scope?: ReikaArtScope }) {
  return request<ReikaArtLibraryResponse & { profile: ReikaArtProfile }>("/art/profiles", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function duplicateArtProfile(profileId: string) {
  return request<ReikaArtLibraryResponse & { profile: ReikaArtProfile }>(`/art/profiles/${encodeURIComponent(profileId)}/duplicate`, {
    method: "POST"
  });
}

export async function deleteArtProfile(profileId: string) {
  return request<ReikaArtLibraryResponse & { profile: ReikaArtProfile }>(`/art/profiles/${encodeURIComponent(profileId)}`, {
    method: "DELETE"
  });
}

export async function createArtCategory(profileId: string, input: { name?: string }) {
  return request<ReikaArtLibraryResponse & { category: ReikaArtCategory }>(`/art/profiles/${encodeURIComponent(profileId)}/categories`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateArtCategory(
  profileId: string,
  categoryId: string,
  input: Partial<Pick<ReikaArtCategory, "selectionMode" | "selectedAssetId" | "prompt" | "systemPrompt" | "referenceAssetIds">>
) {
  return request<ReikaArtLibraryResponse & { category: ReikaArtCategory }>(`/art/profiles/${encodeURIComponent(profileId)}/categories/${encodeURIComponent(categoryId)}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function deleteArtCategory(profileId: string, categoryId: string) {
  return request<ReikaArtLibraryResponse & { category: ReikaArtCategory }>(`/art/profiles/${encodeURIComponent(profileId)}/categories/${encodeURIComponent(categoryId)}`, {
    method: "DELETE"
  });
}

export async function uploadArtAsset(profileId: string, categoryId: string, file: File, prompt?: string) {
  const base64 = await readFileBase64(file);
  return request<ReikaArtLibraryResponse & { asset: ReikaArtAsset }>(`/art/profiles/${encodeURIComponent(profileId)}/categories/${encodeURIComponent(categoryId)}/assets/upload`, {
    method: "POST",
    body: JSON.stringify({
      name: file.name,
      mimeType: file.type || "image/png",
      base64,
      prompt
    })
  });
}

export async function linkArtAsset(profileId: string, categoryId: string, input: { url: string; name?: string; prompt?: string }) {
  return request<ReikaArtLibraryResponse & { asset: ReikaArtAsset }>(`/art/profiles/${encodeURIComponent(profileId)}/categories/${encodeURIComponent(categoryId)}/assets/link`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function deleteArtAsset(profileId: string, categoryId: string, assetId: string) {
  return request<ReikaArtLibraryResponse & { asset: ReikaArtAsset }>(
    `/art/profiles/${encodeURIComponent(profileId)}/categories/${encodeURIComponent(categoryId)}/assets/${encodeURIComponent(assetId)}`,
    { method: "DELETE" }
  );
}

export async function requestArtGeneration(profileId: string, categoryId: string) {
  return request<ReikaArtLibraryResponse & { generation: ReikaArtGenerationStatus }>(`/art/profiles/${encodeURIComponent(profileId)}/categories/${encodeURIComponent(categoryId)}/generate`, {
    method: "POST"
  });
}

export function artAssetContentUrl(assetId: string) {
  return `${API_BASE}/art/assets/${encodeURIComponent(assetId)}/content`;
}

export async function listNotifications(input: { unreadOnly?: boolean; limit?: number } = {}) {
  const params = compactParams({
    unread: input.unreadOnly ? "true" : undefined,
    limit: input.limit
  });
  return request<{ ok: true; storage: { count: number; unreadCount: number; loaded: boolean }; notifications: ReikaNotification[] }>(`/notifications${params}`);
}

export async function markNotificationRead(id: string) {
  return request<{ ok: true; notification: ReikaNotification; storage: { count: number; unreadCount: number; loaded: boolean } }>(`/notifications/${encodeURIComponent(id)}/read`, {
    method: "POST"
  });
}

export async function markAllNotificationsRead() {
  return request<{ ok: true; count: number; storage: { count: number; unreadCount: number; loaded: boolean }; notifications: ReikaNotification[] }>("/notifications/read-all", {
    method: "POST"
  });
}

export async function deleteNotification(id: string) {
  return request<{ ok: true; storage: { count: number; unreadCount: number; loaded: boolean }; notifications: ReikaNotification[] }>(`/notifications/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export async function getProviders() {
  return request<{ ok: true; activeProviderId: string; providers: ReikaProviderRecord[] }>("/providers");
}

export async function refreshProviders() {
  return request<ReikaStateResponse>("/providers/refresh", { method: "POST" });
}

export async function getProviderAgents(providerId: string) {
  return request<{ ok: true; providerId: string; agents: ReikaAgentSummary[] }>(`/providers/${encodeURIComponent(providerId)}/agents`);
}

export async function listSessions(input: { limit?: number; agent?: string; providerId?: string } = {}) {
  const params = compactParams({
    limit: input.limit,
    agent: input.agent,
    providerId: input.providerId
  });
  return request<{ ok: true; storage?: unknown; sessions: ReikaSessionSummary[] }>(`/sessions${params}`);
}

export async function searchSessions(input: { q: string; limit?: number; agent?: string; providerId?: string }) {
  const params = compactParams({
    q: input.q,
    limit: input.limit,
    agent: input.agent,
    providerId: input.providerId
  });
  return request<{ ok: true; query: string; results: ReikaSessionSummary[] }>(`/sessions/search${params}`);
}

export async function getSession(sessionId: string) {
  return request<{ ok: true; session: ReikaSessionSummary }>(`/sessions/${encodeURIComponent(sessionId)}`);
}

export async function getSessionMessages(sessionId: string, limit?: number) {
  const params = compactParams({ limit });
  return request<{ ok: true; sessionId: string; messages: ReikaChatMessage[] }>(`/sessions/${encodeURIComponent(sessionId)}/messages${params}`);
}

export async function createSession(input: { providerId?: string; agent?: string; title?: string; metadata?: Record<string, unknown> } = {}) {
  return request<{ ok: true; session: ReikaSessionSummary }>("/sessions", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function postSessionMessage(sessionId: string, input: { message: string; model?: string; fileIds?: string[] }) {
  return request<{ ok: true; session: ReikaSessionSummary; message: ReikaChatMessage; result: ReikaChatResult }>(
    `/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function chat(input: ReikaChatRequest) {
  return request<{ ok: true; session: ReikaSessionSummary; message: ReikaChatMessage; text: string; result: ReikaChatResult }>("/chat", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function streamChat(
  input: ReikaChatRequest,
  onEvent: (event: { type: string; data: unknown }) => void,
  endpoint = "/chat/stream"
) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new ReikaApiError(`Streaming chat failed: HTTP ${response.status}`, response.status);
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) emitSseChunk(chunk, onEvent);
  }

  if (buffer.trim()) emitSseChunk(buffer, onEvent);
}

export async function listProviderHistory(providerId: string, limit = 25) {
  const params = compactParams({ limit });
  return request<{ ok: true; providerId: string; sessions: unknown[] }>(`/providers/${encodeURIComponent(providerId)}/history${params}`);
}

export async function importProviderHistory(providerId: string, input: { limit?: number; includeMessages?: boolean } = {}) {
  return request<{ ok: true; providerId: string; imported: Array<{ providerSessionId: string; session: ReikaSessionSummary; created: boolean; messageCount: number }> }>(
    `/providers/${encodeURIComponent(providerId)}/history/import`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function listFiles() {
  return request<{ ok: true; storage?: unknown; items: ReikaFileItem[] }>("/files");
}

export async function linkFile(input: { url: string; name?: string; notes?: string }) {
  return request<{ ok: true; item: ReikaFileItem }>("/files/link", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function uploadFiles(files: File[]) {
  const encoded = await Promise.all(files.map(fileToUploadBody));
  return request<{ ok: true; items: ReikaFileItem[] }>("/files/upload", {
    method: "POST",
    body: JSON.stringify({ files: encoded })
  });
}

export function fileDownloadUrl(fileId: string) {
  return `${API_BASE}/files/${encodeURIComponent(fileId)}/download`;
}

export async function getUplink() {
  return request<{ ok: true; uplink: ReikaUplinkSnapshot }>("/uplink");
}

export async function connectUplink(input: { relayUrl: string; pairingToken?: string; deviceId?: string }) {
  return request<{ ok: true; uplink: ReikaUplinkSnapshot }>("/uplink/connect", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function disconnectUplink() {
  return request<{ ok: true; uplink: ReikaUplinkSnapshot }>("/uplink/disconnect", { method: "POST" });
}

export async function getStartup() {
  return request<{ ok: true; startup: ReikaStartupStatus }>("/startup");
}

export async function enableStartup(input: { relayUrl?: string; deviceId?: string } = {}) {
  return request<{ ok: boolean; startup: ReikaStartupStatus }>("/startup/enable", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function disableStartup() {
  return request<{ ok: boolean; startup: ReikaStartupStatus }>("/startup/disable", { method: "POST" });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers
  });
  const payload = (await response.json().catch(() => ({}))) as T & ReikaApiErrorBody;
  if (!response.ok || payload.ok === false) {
    throw new ReikaApiError(payload.error || `Reika server request failed: HTTP ${response.status}`, response.status, payload.code);
  }
  return payload as T;
}

function compactParams(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function fileToUploadBody(file: File) {
  const base64 = await readFileBase64(file);
  return {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    base64
  };
}

function readFileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() || "" : result);
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read file.")));
    reader.readAsDataURL(file);
  });
}

function emitSseChunk(chunk: string, onEvent: (event: { type: string; data: unknown }) => void) {
  let type = "message";
  const dataLines: string[] = [];
  for (const rawLine of chunk.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith("event:")) type = line.slice("event:".length).trim() || "message";
    if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
  }
  if (!dataLines.length) return;
  const rawData = dataLines.join("\n");
  let data: unknown = rawData;
  try {
    data = JSON.parse(rawData);
  } catch {
    // Plain-text SSE data is allowed; keep it as text.
  }
  onEvent({ type, data });
}
