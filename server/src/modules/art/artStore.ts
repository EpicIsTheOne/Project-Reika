import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join } from 'node:path';
import { homedir } from 'node:os';

export type ArtScope = 'agent' | 'global';
export type ArtSelectionMode = 'single' | 'random';
export type ArtAssetKind = 'seed' | 'upload' | 'generated' | 'reference' | 'link';

export interface ArtAssetRecord {
  id: string;
  name: string;
  kind: ArtAssetKind;
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

export interface ArtCategoryRecord {
  id: string;
  name: string;
  description: string;
  usage: string;
  icon: string;
  selectionMode: ArtSelectionMode;
  selectedAssetId?: string;
  prompt: string;
  systemPrompt: string;
  referenceAssetIds: string[];
  assets: ArtAssetRecord[];
  locked?: boolean;
}

export interface ArtProfileRecord {
  id: string;
  scope: ArtScope;
  name: string;
  subtitle: string;
  status: 'online' | 'offline' | 'draft';
  providerLabel: string;
  avatarAssetKey: string;
  defaultProfile?: boolean;
  createdAt: string;
  updatedAt: string;
  categories: ArtCategoryRecord[];
}

export interface ArtOAuthStatus {
  connected: boolean;
  provider: 'codex-oauth';
  imageGenerationAvailable: boolean;
  quotaLabel?: string;
  message: string;
}

export interface ArtStoreSnapshot {
  path: string;
  assetDir: string;
  loaded: boolean;
  profileCount: number;
  assetCount: number;
  lastSavedAt?: string;
  lastError?: string;
}

interface PersistedArtStore {
  version: 1;
  updatedAt: string;
  profiles: ArtProfileRecord[];
}

const defaultStorePath = join(homedir(), '.local', 'share', 'project-reika', 'art-library.json');
const defaultAssetDir = join(homedir(), '.local', 'share', 'project-reika', 'art-assets');

function storagePath() {
  return process.env.REIKA_ART_STORE_PATH || defaultStorePath;
}

function assetDir() {
  return process.env.REIKA_ART_ASSET_DIR || defaultAssetDir;
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

function asset(id: string, name: string, assetKey: string, kind: ArtAssetKind = 'seed'): ArtAssetRecord {
  return {
    id,
    name,
    kind,
    assetKey,
    createdAt: new Date(0).toISOString(),
    model: kind === 'generated' ? 'gpt-image-2' : undefined
  };
}

function category(input: Omit<ArtCategoryRecord, 'referenceAssetIds'> & { referenceAssetIds?: string[] }): ArtCategoryRecord {
  const selectedAssetId = input.selectedAssetId || input.assets[0]?.id;
  return {
    ...input,
    selectedAssetId,
    referenceAssetIds: input.referenceAssetIds || input.assets.slice(0, 3).map((item) => item.id)
  };
}

function reikaCategories(): ArtCategoryRecord[] {
  const portrait = [
    asset('art_reika_portrait_chat_main', 'Reika Portrait Main', 'reika.halfBody', 'generated'),
    asset('art_reika_portrait_chat_soft', 'Soft Chat Portrait', 'reika.avatar', 'generated'),
    asset('art_reika_portrait_chat_happy', 'Happy Portrait', 'reika.expressions.happy', 'generated'),
    asset('art_reika_portrait_chat_playful', 'Playful Portrait', 'reika.expressions.playful', 'generated'),
    asset('art_reika_portrait_chat_thinking', 'Thinking Portrait', 'reika.expressions.thinking', 'generated'),
    asset('art_reika_portrait_chat_neutral', 'Neutral Portrait', 'reika.expressions.neutral', 'generated')
  ];
  const expressions = [
    asset('art_reika_expression_neutral', 'Neutral', 'reika.expressions.neutral', 'seed'),
    asset('art_reika_expression_happy', 'Happy', 'reika.expressions.happy', 'seed'),
    asset('art_reika_expression_thinking', 'Thinking', 'reika.expressions.thinking', 'seed'),
    asset('art_reika_expression_playful', 'Playful', 'reika.expressions.playful', 'seed')
  ];
  return [
    category({
      id: 'portrait-chat',
      name: 'Portrait (Chat)',
      description: 'Used in chat headers, message lists, and side panels.',
      usage: 'Chat UI',
      icon: 'portrait',
      selectionMode: 'random',
      selectedAssetId: portrait[0]?.id,
      prompt: 'Anime-style portrait of Reika from AgentHub, cyberpunk bedroom at night, neon blue lighting, soft cozy atmosphere, detailed face, blue eyes, black hair in ponytail, wearing black futuristic outfit, high quality, ultra detailed.',
      systemPrompt: 'Keep AgentHub assets dark navy, electric blue, premium, cozy futuristic, and consistent with Reika reference art.',
      assets: portrait
    }),
    category({
      id: 'avatar-circle',
      name: 'Avatar (Circle)',
      description: 'Small identity image for agent lists, chat rows, and notifications.',
      usage: 'Identity',
      icon: 'avatar',
      selectionMode: 'single',
      selectedAssetId: 'art_reika_avatar_circle_main',
      prompt: 'Circular avatar of Reika, readable at small sizes, neon blue accents, clean face crop, premium AgentHub style.',
      systemPrompt: 'Prioritize face readability, clean silhouette, and dark UI contrast.',
      assets: [
        asset('art_reika_avatar_circle_main', 'Main Avatar', 'reika.avatar', 'seed'),
        asset('art_reika_avatar_circle_happy', 'Happy Avatar', 'reika.expressions.happy', 'seed'),
        asset('art_reika_avatar_circle_playful', 'Playful Avatar', 'reika.expressions.playful', 'seed')
      ]
    }),
    category({
      id: 'hero-banner',
      name: 'Hero / Banner',
      description: 'Wide presentation art for Home and agent profile headers.',
      usage: 'Home hero',
      icon: 'banner',
      selectionMode: 'single',
      selectedAssetId: 'art_reika_hero_room',
      prompt: 'Wide cinematic hero banner of Reika in her neon blue bedroom command space, AgentHub logo glow in the room, premium dark futuristic UI feel.',
      systemPrompt: 'Keep composition wide, character-focused, and usable behind overlay text.',
      assets: [
        asset('art_reika_hero_room', 'Bedroom Hero', 'room.hero', 'generated'),
        asset('art_reika_hero_full', 'Full Splash', 'reika.splash', 'generated')
      ]
    }),
    category({
      id: 'loading-screen',
      name: 'Loading Screen',
      description: 'Startup and boot sequence artwork.',
      usage: 'Startup',
      icon: 'loading',
      selectionMode: 'random',
      selectedAssetId: 'art_reika_loading_boot',
      prompt: 'AgentHub loading screen featuring Reika by a rainy neon city window, large glowing AgentHub emblem, cinematic dark blue interface.',
      systemPrompt: 'Must leave room for progress UI and boot status copy.',
      assets: [
        asset('art_reika_loading_boot', 'Boot Backdrop', 'loading.bootBackdrop', 'generated'),
        asset('art_reika_loading_splash', 'Loading Splash', 'loading.background', 'generated')
      ]
    }),
    category({
      id: 'expressions',
      name: 'Expressions',
      description: 'Mood and response portraits for chat and notifications.',
      usage: 'Mood system',
      icon: 'expressions',
      selectionMode: 'random',
      selectedAssetId: expressions[0]?.id,
      prompt: 'Expression set for Reika with subtle emotional variations while preserving exact character identity and AgentHub blue neon style.',
      systemPrompt: 'Keep the face and outfit consistent. Only vary expression and micro pose.',
      assets: expressions
    }),
    category({
      id: 'room-background',
      name: 'Room / Background',
      description: 'Environmental art used behind panels and character cards.',
      usage: 'Backgrounds',
      icon: 'room',
      selectionMode: 'random',
      selectedAssetId: 'art_reika_room_full',
      prompt: 'Cozy cyberpunk AI assistant bedroom at night, rainy window, dark navy and electric blue UI glow, premium AgentHub mood.',
      systemPrompt: 'No busy foreground text. Background must support readable UI overlays.',
      assets: [
        asset('art_reika_room_full', 'Full Room Night', 'room.full', 'generated'),
        asset('art_reika_room_blurred', 'Blurred UI Background', 'room.blurred', 'generated'),
        asset('art_reika_room_hero', 'Cropped Room Banner', 'room.hero', 'generated')
      ]
    }),
    category({
      id: 'chibi-small',
      name: 'Chibi / Small',
      description: 'Small mascot states and compact empty-state art.',
      usage: 'Empty states',
      icon: 'chibi',
      selectionMode: 'random',
      selectedAssetId: 'art_reika_chibi_main',
      prompt: 'Cute chibi Reika mascot in AgentHub style, dark blue cyber UI base, expressive and readable.',
      systemPrompt: 'Keep the mascot crisp and transparent-background ready where possible.',
      assets: [
        asset('art_reika_chibi_main', 'Chibi Main', 'reika.chibi', 'generated'),
        asset('art_reika_empty_agents', 'No Agents State', 'empty.noAgents', 'generated'),
        asset('art_reika_empty_chat', 'No Chat State', 'empty.noChat', 'generated')
      ]
    }),
    category({
      id: 'notifications',
      name: 'Notifications',
      description: 'Notification portraits and status thumbnails.',
      usage: 'Notifications',
      icon: 'bell',
      selectionMode: 'random',
      selectedAssetId: 'art_reika_notification_main',
      prompt: 'Compact Reika notification thumbnail, clear face crop, electric blue accents, readable in a dark glass notification card.',
      systemPrompt: 'Prioritize compact readability and emotional clarity.',
      assets: [
        asset('art_reika_notification_main', 'Main Notification', 'reika.avatar', 'seed'),
        asset('art_reika_notification_happy', 'Happy Notification', 'reika.expressions.happy', 'seed'),
        asset('art_reika_notification_thinking', 'Thinking Notification', 'reika.expressions.thinking', 'seed')
      ]
    }),
    category({
      id: 'splash-full-body',
      name: 'Splash / Full Body',
      description: 'Large presentation and profile artwork.',
      usage: 'Profiles',
      icon: 'splash',
      selectionMode: 'single',
      selectedAssetId: 'art_reika_splash_full',
      prompt: 'Full splash illustration of Reika in her AgentHub room, cinematic neon blue, polished production asset.',
      systemPrompt: 'Use full composition with room context and clean character silhouette.',
      assets: [
        asset('art_reika_splash_full', 'Full Splash', 'reika.splash', 'generated'),
        asset('art_reika_splash_half', 'Half Body Portrait', 'reika.halfBody', 'generated')
      ]
    }),
    category({
      id: 'offline-error',
      name: 'Offline / Error',
      description: 'Glitched, offline, or degraded-mode artwork.',
      usage: 'Error states',
      icon: 'warning',
      selectionMode: 'single',
      selectedAssetId: 'art_reika_error_glow',
      prompt: 'Reika offline/error portrait with subtle holographic glitch, red-blue warning accents, still premium and readable.',
      systemPrompt: 'Use error mood without making the UI look broken or low quality.',
      assets: [
        asset('art_reika_error_glow', 'Glitch Portrait', 'reika.expressions.thinking', 'seed'),
        asset('art_reika_error_chibi', 'Offline Chibi', 'empty.noChat', 'generated')
      ]
    })
  ];
}

function cloneCategoriesWithPrefix(categories: ArtCategoryRecord[], prefix: string, avatarKey: string) {
  return categories.map((categoryRecord) => ({
    ...categoryRecord,
    id: `${prefix}-${categoryRecord.id}`,
    selectedAssetId: categoryRecord.selectedAssetId ? `${prefix}-${categoryRecord.selectedAssetId}` : undefined,
    referenceAssetIds: categoryRecord.referenceAssetIds.map((id) => `${prefix}-${id}`),
    assets: categoryRecord.assets.map((item, index) => ({
      ...item,
      id: `${prefix}-${item.id}`,
      name: `${item.name}`,
      assetKey: index === 0 && categoryRecord.id === 'avatar-circle' ? avatarKey : item.assetKey
    }))
  }));
}

function defaultProfiles(): ArtProfileRecord[] {
  const createdAt = new Date(0).toISOString();
  const reika = reikaCategories();
  return [
    {
      id: 'reika',
      scope: 'agent',
      name: 'Reika',
      subtitle: 'Default - Hermes',
      status: 'online',
      providerLabel: 'Hermes',
      avatarAssetKey: 'reika.avatar',
      defaultProfile: true,
      createdAt,
      updatedAt: createdAt,
      categories: reika
    },
    {
      id: 'astra',
      scope: 'agent',
      name: 'Astra',
      subtitle: 'VPS - OpenClaw',
      status: 'online',
      providerLabel: 'OpenClaw',
      avatarAssetKey: 'reika.expressions.happy',
      createdAt,
      updatedAt: createdAt,
      categories: cloneCategoriesWithPrefix(reika, 'astra', 'reika.expressions.happy')
    },
    {
      id: 'miyabi',
      scope: 'agent',
      name: 'Miyabi',
      subtitle: 'VPS - OpenClaw',
      status: 'online',
      providerLabel: 'OpenClaw',
      avatarAssetKey: 'reika.expressions.playful',
      createdAt,
      updatedAt: createdAt,
      categories: cloneCategoriesWithPrefix(reika, 'miyabi', 'reika.expressions.playful')
    },
    {
      id: 'nyxie',
      scope: 'agent',
      name: 'Nyxie',
      subtitle: 'PC - Hermes',
      status: 'online',
      providerLabel: 'Hermes',
      avatarAssetKey: 'reika.expressions.thinking',
      createdAt,
      updatedAt: createdAt,
      categories: cloneCategoriesWithPrefix(reika, 'nyxie', 'reika.expressions.thinking')
    },
    {
      id: 'global',
      scope: 'global',
      name: 'Global Assets',
      subtitle: 'Application-wide art',
      status: 'online',
      providerLabel: 'AgentHub',
      avatarAssetKey: 'brand.logo',
      defaultProfile: true,
      createdAt,
      updatedAt: createdAt,
      categories: [
        category({
          id: 'global-loading',
          name: 'Loading Screen',
          description: 'Global boot and startup artwork.',
          usage: 'Startup',
          icon: 'loading',
          selectionMode: 'random',
          selectedAssetId: 'art_global_loading_boot',
          prompt: 'Global AgentHub boot artwork in dark navy and electric blue, premium futuristic identity, character-friendly composition.',
          systemPrompt: 'Must match AgentHub loading UI and leave room for status rail and progress.',
          assets: [
            asset('art_global_loading_boot', 'Reika Boot Backdrop', 'loading.bootBackdrop', 'generated'),
            asset('art_global_loading_splash', 'Loading Splash', 'loading.background', 'generated')
          ]
        }),
        category({
          id: 'global-empty-states',
          name: 'Empty States',
          description: 'No agents, no chat, and setup helper art.',
          usage: 'Empty states',
          icon: 'empty',
          selectionMode: 'random',
          selectedAssetId: 'art_global_empty_agents',
          prompt: 'AgentHub empty-state illustration, small Reika mascot, dark glass UI base, clear blue accent.',
          systemPrompt: 'Should fit compact cards and avoid heavy background clutter.',
          assets: [
            asset('art_global_empty_agents', 'No Agents Connected', 'empty.noAgents', 'generated'),
            asset('art_global_empty_chat', 'No Chat History', 'empty.noChat', 'generated'),
            asset('art_global_empty_chibi', 'Chibi Helper', 'reika.chibi', 'generated')
          ]
        }),
        category({
          id: 'global-backgrounds',
          name: 'Global Backgrounds',
          description: 'Application backgrounds and room plates.',
          usage: 'Shell backgrounds',
          icon: 'room',
          selectionMode: 'random',
          selectedAssetId: 'art_global_room_blur',
          prompt: 'AgentHub dark navy glass background, neon blue cozy room, usable behind interface panels.',
          systemPrompt: 'Support text readability and premium app shell consistency.',
          assets: [
            asset('art_global_room_blur', 'Blurred Room', 'room.blurred', 'generated'),
            asset('art_global_room_full', 'Full Room', 'room.full', 'generated'),
            asset('art_global_room_hero', 'Hero Room', 'room.hero', 'generated')
          ]
        })
      ]
    }
  ];
}

function isProfile(value: unknown): value is ArtProfileRecord {
  const maybe = value as Partial<ArtProfileRecord>;
  return Boolean(maybe && typeof maybe.id === 'string' && typeof maybe.name === 'string' && Array.isArray(maybe.categories));
}

function cleanName(value: unknown, fallback: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function extensionForMime(mimeType: string, originalName?: string) {
  const fromName = originalName ? extname(originalName).replace(/[^a-zA-Z0-9.]/g, '') : '';
  if (fromName) return fromName;
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  return '.png';
}

export class ArtStore {
  private readonly path = storagePath();
  private readonly assetDir = assetDir();
  private profiles: ArtProfileRecord[] = defaultProfiles();
  private loaded = false;
  private lastSavedAt?: string;
  private lastError?: string;
  private saveQueue: Promise<void> = Promise.resolve();

  async load() {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<PersistedArtStore>;
      const profiles = (parsed.profiles || []).filter(isProfile);
      this.profiles = profiles.length > 0 ? profiles : defaultProfiles();
      this.loaded = true;
      this.lastError = undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.profiles = defaultProfiles();
        this.loaded = true;
        this.lastError = undefined;
        this.queueSave();
        return;
      }
      this.loaded = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  snapshot(): ArtStoreSnapshot {
    return {
      path: this.path,
      assetDir: this.assetDir,
      loaded: this.loaded,
      profileCount: this.profiles.length,
      assetCount: this.profiles.reduce((total, profile) => total + profile.categories.reduce((categoryTotal, item) => categoryTotal + item.assets.length, 0), 0),
      lastSavedAt: this.lastSavedAt,
      lastError: this.lastError
    };
  }

  oauthStatus(): ArtOAuthStatus {
    return {
      connected: false,
      provider: 'codex-oauth',
      imageGenerationAvailable: false,
      quotaLabel: 'Unavailable',
      message: 'Codex/ChatGPT OAuth image generation is not connected to the local server yet.'
    };
  }

  list() {
    return this.profiles;
  }

  getProfile(profileId: string) {
    return this.profiles.find((profile) => profile.id === profileId);
  }

  createProfile(input: { name?: unknown; subtitle?: unknown; scope?: unknown }) {
    const now = nowIso();
    const name = cleanName(input.name, 'New Agent');
    const idBase = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'agent';
    const id = `${idBase}-${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const profile: ArtProfileRecord = {
      id,
      scope: input.scope === 'global' ? 'global' : 'agent',
      name,
      subtitle: cleanName(input.subtitle, 'Draft art profile'),
      status: 'draft',
      providerLabel: input.scope === 'global' ? 'AgentHub' : 'Custom',
      avatarAssetKey: input.scope === 'global' ? 'brand.logo' : 'reika.avatar',
      createdAt: now,
      updatedAt: now,
      categories: cloneCategoriesWithPrefix(reikaCategories(), id, 'reika.avatar')
    };
    this.profiles.push(profile);
    this.queueSave();
    return profile;
  }

  duplicateProfile(profileId: string) {
    const source = this.requireProfile(profileId);
    const now = nowIso();
    const id = `${source.id}-copy-${randomUUID().replace(/-/g, '').slice(0, 6)}`;
    const profile: ArtProfileRecord = {
      ...JSON.parse(JSON.stringify(source)) as ArtProfileRecord,
      id,
      name: `${source.name} Copy`,
      defaultProfile: false,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      categories: source.categories.map((categoryRecord) => ({
        ...categoryRecord,
        id: `${id}-${categoryRecord.id}`,
        selectedAssetId: categoryRecord.selectedAssetId ? `${id}-${categoryRecord.selectedAssetId}` : undefined,
        referenceAssetIds: categoryRecord.referenceAssetIds.map((assetId) => `${id}-${assetId}`),
        assets: categoryRecord.assets.map((item) => ({ ...item, id: `${id}-${item.id}` }))
      }))
    };
    this.profiles.push(profile);
    this.queueSave();
    return profile;
  }

  deleteProfile(profileId: string) {
    const profile = this.requireProfile(profileId);
    if (profile.defaultProfile) throw new Error('Default art profiles cannot be deleted.');
    this.profiles = this.profiles.filter((item) => item.id !== profileId);
    this.queueSave();
    return profile;
  }

  addCategory(profileId: string, input: { name?: unknown }) {
    const profile = this.requireProfile(profileId);
    const name = cleanName(input.name, 'Custom Category');
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'custom'}-${randomUUID().replace(/-/g, '').slice(0, 5)}`;
    const newCategory = category({
      id,
      name,
      description: 'Custom art category for this profile.',
      usage: 'Custom',
      icon: 'custom',
      selectionMode: 'single',
      prompt: `AgentHub ${name} artwork for ${profile.name}, dark navy, electric blue, premium futuristic style.`,
      systemPrompt: 'Keep AgentHub visual consistency and character identity.',
      assets: []
    });
    profile.categories.push(newCategory);
    profile.updatedAt = nowIso();
    this.queueSave();
    return newCategory;
  }

  deleteCategory(profileId: string, categoryId: string) {
    const profile = this.requireProfile(profileId);
    const existing = this.requireCategory(profile, categoryId);
    profile.categories = profile.categories.filter((item) => item.id !== categoryId);
    profile.updatedAt = nowIso();
    this.queueSave();
    return existing;
  }

  updateCategory(profileId: string, categoryId: string, input: Partial<Pick<ArtCategoryRecord, 'selectionMode' | 'selectedAssetId' | 'prompt' | 'systemPrompt' | 'referenceAssetIds'>>) {
    const profile = this.requireProfile(profileId);
    const existing = this.requireCategory(profile, categoryId);
    const assetIds = new Set(existing.assets.map((item) => item.id));
    if (input.selectionMode === 'single' || input.selectionMode === 'random') existing.selectionMode = input.selectionMode;
    if (typeof input.selectedAssetId === 'string' && assetIds.has(input.selectedAssetId)) existing.selectedAssetId = input.selectedAssetId;
    if (typeof input.prompt === 'string') existing.prompt = input.prompt;
    if (typeof input.systemPrompt === 'string') existing.systemPrompt = input.systemPrompt;
    if (Array.isArray(input.referenceAssetIds)) existing.referenceAssetIds = input.referenceAssetIds.filter((id) => assetIds.has(id));
    profile.updatedAt = nowIso();
    this.queueSave();
    return existing;
  }

  addLinkedAsset(profileId: string, categoryId: string, input: { name?: unknown; url?: unknown; prompt?: unknown }) {
    const categoryRecord = this.requireCategory(this.requireProfile(profileId), categoryId);
    const url = typeof input.url === 'string' ? input.url.trim() : '';
    if (!url) throw new Error('url is required.');
    const record: ArtAssetRecord = {
      id: makeId('art_link'),
      name: cleanName(input.name, 'Linked Art'),
      kind: 'link',
      sourceUrl: url,
      prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
      createdAt: nowIso()
    };
    categoryRecord.assets.unshift(record);
    categoryRecord.selectedAssetId = record.id;
    this.touchProfile(profileId);
    this.queueSave();
    return record;
  }

  async addUploadedAsset(profileId: string, categoryId: string, input: { name?: unknown; mimeType?: unknown; base64?: unknown; prompt?: unknown }) {
    const profile = this.requireProfile(profileId);
    const categoryRecord = this.requireCategory(profile, categoryId);
    const base64 = typeof input.base64 === 'string' ? input.base64.replace(/^data:[^;]+;base64,/, '') : '';
    if (!base64) throw new Error('base64 image data is required.');
    const buffer = Buffer.from(base64, 'base64');
    const mimeType = typeof input.mimeType === 'string' && input.mimeType.trim() ? input.mimeType.trim() : 'image/png';
    if (!mimeType.startsWith('image/')) throw new Error('Only image uploads are allowed.');
    const id = makeId('art_upload');
    const name = cleanName(input.name, 'Uploaded Art');
    const filePath = join(this.assetDir, `${id}${extensionForMime(mimeType, name)}`);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
    const record: ArtAssetRecord = {
      id,
      name,
      kind: 'upload',
      createdAt: nowIso(),
      filePath,
      mimeType,
      size: buffer.byteLength,
      prompt: typeof input.prompt === 'string' ? input.prompt : undefined
    };
    categoryRecord.assets.unshift(record);
    categoryRecord.selectedAssetId = record.id;
    profile.updatedAt = nowIso();
    this.queueSave();
    return record;
  }

  deleteAsset(profileId: string, categoryId: string, assetId: string) {
    const profile = this.requireProfile(profileId);
    const categoryRecord = this.requireCategory(profile, categoryId);
    const existing = categoryRecord.assets.find((item) => item.id === assetId);
    if (!existing) throw new Error('Art asset not found.');
    if (existing.kind === 'seed') throw new Error('Seed assets cannot be deleted.');
    categoryRecord.assets = categoryRecord.assets.filter((item) => item.id !== assetId);
    if (categoryRecord.selectedAssetId === assetId) categoryRecord.selectedAssetId = categoryRecord.assets[0]?.id;
    categoryRecord.referenceAssetIds = categoryRecord.referenceAssetIds.filter((id) => id !== assetId);
    profile.updatedAt = nowIso();
    this.queueSave();
    return existing;
  }

  resolveAssetContent(assetId: string): { stream: ReadStream; mimeType: string; name: string } | undefined {
    for (const profile of this.profiles) {
      for (const categoryRecord of profile.categories) {
        const item = categoryRecord.assets.find((assetRecord) => assetRecord.id === assetId);
        if (item?.filePath) {
          return {
            stream: createReadStream(item.filePath),
            mimeType: item.mimeType || 'application/octet-stream',
            name: item.name
          };
        }
      }
    }
    return undefined;
  }

  requestGeneration(profileId: string, categoryId: string) {
    const profile = this.requireProfile(profileId);
    const categoryRecord = this.requireCategory(profile, categoryId);
    return {
      status: 'blocked' as const,
      provider: 'gpt-image-2',
      profileId: profile.id,
      categoryId: categoryRecord.id,
      message: 'GPT-image 2 generation is waiting on Codex/ChatGPT OAuth support in the local server.',
      prompt: categoryRecord.prompt,
      systemPrompt: categoryRecord.systemPrompt
    };
  }

  async flush() {
    await this.saveQueue;
  }

  private requireProfile(profileId: string) {
    const profile = this.getProfile(profileId);
    if (!profile) throw new Error('Art profile not found.');
    return profile;
  }

  private requireCategory(profile: ArtProfileRecord, categoryId: string) {
    const existing = profile.categories.find((categoryRecord) => categoryRecord.id === categoryId);
    if (!existing) throw new Error('Art category not found.');
    return existing;
  }

  private touchProfile(profileId: string) {
    const profile = this.requireProfile(profileId);
    profile.updatedAt = nowIso();
  }

  private queueSave() {
    this.saveQueue = this.saveQueue.then(() => this.save()).catch((error) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error(`Failed to save AgentHub art library: ${this.lastError}`);
    });
  }

  private async save() {
    const now = nowIso();
    const payload: PersistedArtStore = {
      version: 1,
      updatedAt: now,
      profiles: this.profiles
    };
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(tmp, this.path);
    this.lastSavedAt = now;
    this.lastError = undefined;
  }
}
