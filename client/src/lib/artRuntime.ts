import { assets } from "../data/assets";
import type { CSSProperties } from "react";
import type { Agent } from "../types";
import {
  artAssetContentUrl,
  type ReikaArtPlacement,
  type ReikaArtAsset,
  type ReikaArtCategory,
  type ReikaArtLibraryResponse,
  type ReikaArtProfile
} from "./reikaApi";

export type ArtAgentLike = Partial<Pick<Agent, "id" | "name" | "characterId">> | string | null | undefined;

export interface ArtRuntime {
  library: ReikaArtLibraryResponse | null;
  versionKey: string;
  resolveAssetUrl: (assetRecord: ReikaArtAsset | null | undefined, fallback?: string) => string;
  resolveAssetRender: (assetRecord: ReikaArtAsset | null | undefined, fallback?: string) => ArtRenderAsset;
  resolveAssetKey: (assetKey: string | undefined, fallback?: string) => string;
  profileForAgent: (agent: ArtAgentLike) => ReikaArtProfile | undefined;
  profileAvatar: (profile: ReikaArtProfile | null | undefined, slot?: string) => string;
  profileAvatarRender: (profile: ReikaArtProfile | null | undefined, slot?: string) => ArtRenderAsset;
  profilePortrait: (profile: ReikaArtProfile | null | undefined, slot?: string) => string;
  profilePortraitRender: (profile: ReikaArtProfile | null | undefined, slot?: string) => ArtRenderAsset;
  agentAvatar: (agent: ArtAgentLike, slot?: string) => string;
  agentAvatarRender: (agent: ArtAgentLike, slot?: string) => ArtRenderAsset;
  agentPortrait: (agent: ArtAgentLike, slot?: string) => string;
  agentPortraitRender: (agent: ArtAgentLike, slot?: string) => ArtRenderAsset;
  agentArt: (agent: ArtAgentLike, categoryId: string, fallback: string, slot?: string) => string;
  agentArtRender: (agent: ArtAgentLike, categoryId: string, fallback: string, slot?: string) => ArtRenderAsset;
  profileArt: (profile: ReikaArtProfile | null | undefined, categoryId: string, fallback: string, slot?: string) => string;
  profileArtRender: (profile: ReikaArtProfile | null | undefined, categoryId: string, fallback: string, slot?: string) => ArtRenderAsset;
  globalArt: (categoryId: string, fallback: string, slot?: string) => string;
  globalArtRender: (categoryId: string, fallback: string, slot?: string) => ArtRenderAsset;
}

export interface ArtRenderAsset {
  src: string;
  placement: ReikaArtPlacement;
  style: CSSProperties;
}

const fallbackProfileOrder = ["reika", "astra", "miyabi", "nyxie"];
const rerollSeparator = "::reroll:";
const rerollMemoryPrefix = "agenthub-art-reroll:";
const rerollMemory = new Map<string, RerollMemoryEntry>();

type RerollMemoryEntry = {
  nonce: string;
  assetId: string;
};

export function makeArtRuntimeSeed() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function artRerollSlot(slot: string, nonce: string | number) {
  return `${slot}${rerollSeparator}${String(nonce)}`;
}

export function createArtRuntime(library: ReikaArtLibraryResponse | null, sessionSeed: string): ArtRuntime {
  const versionKey = artVersionKey(library);

  const resolveAssetUrl = (assetRecord: ReikaArtAsset | null | undefined, fallback = assets.reika.avatar) => {
    if (!assetRecord) return fallback;
    if (assetRecord.sourceUrl) return assetRecord.sourceUrl;
    if (assetRecord.filePath || assetRecord.kind === "upload") return artAssetContentUrl(assetRecord.id);
    if (assetRecord.assetKey) return resolveArtAssetKey(assetRecord.assetKey, fallback);
    return fallback;
  };

  const resolveAssetRender = (assetRecord: ReikaArtAsset | null | undefined, fallback = assets.reika.avatar): ArtRenderAsset => {
    const placement = readAssetPlacement(assetRecord);
    return {
      src: resolveAssetUrl(assetRecord, fallback),
      placement,
      style: artPlacementStyle(placement)
    };
  };

  const resolveAssetKey = (assetKey: string | undefined, fallback = assets.reika.avatar) => resolveArtAssetKey(assetKey, fallback);

  const profileForAgent = (agent: ArtAgentLike) => findProfileForAgent(library, agent);

  const pickFromCategory = (
    profile: ReikaArtProfile | null | undefined,
    categoryId: string,
    fallback: string,
    slot = "default",
    options: { skipInheritedReikaArt?: boolean } = {}
  ) => {
    const category = findCategory(profile, categoryId);
    const parsedSlot = parseRerollSlot(slot);
    const assetRecord = pickAsset(category, {
      hashKey: `${sessionSeed}:${versionKey}:${profile?.id ?? "none"}:${categoryId}:${slot}`,
      memoryKey: `${versionKey}:${profile?.id ?? "none"}:${categoryId}:${parsedSlot.baseSlot}`,
      rerollNonce: parsedSlot.rerollNonce
    }, profile, options);
    return resolveAssetRender(assetRecord, fallback);
  };

  const profileAvatar = (profile: ReikaArtProfile | null | undefined, slot = "avatar") => {
    const fallback = resolveAssetKey(profile?.avatarAssetKey, assets.reika.avatar);
    return pickFromCategory(profile, "avatar-circle", fallback, slot).src;
  };

  const profileAvatarRender = (profile: ReikaArtProfile | null | undefined, slot = "avatar") => {
    const fallback = resolveAssetKey(profile?.avatarAssetKey, assets.reika.avatar);
    return pickFromCategory(profile, "avatar-circle", fallback, slot);
  };

  const profilePortrait = (profile: ReikaArtProfile | null | undefined, slot = "portrait") => {
    const fallback = profileAvatar(profile, `${slot}-fallback`);
    return pickFromCategory(profile, "portrait-chat", fallback, slot).src;
  };

  const profilePortraitRender = (profile: ReikaArtProfile | null | undefined, slot = "portrait") => {
    const fallback = profileAvatarRender(profile, `${slot}-fallback`);
    return pickFromCategory(profile, "portrait-chat", fallback.src, slot, { skipInheritedReikaArt: true });
  };

  const agentAvatar = (agent: ArtAgentLike, slot = "avatar") => profileAvatar(profileForAgent(agent), slot);
  const agentAvatarRender = (agent: ArtAgentLike, slot = "avatar") => profileAvatarRender(profileForAgent(agent), slot);
  const agentPortrait = (agent: ArtAgentLike, slot = "portrait") => profilePortrait(profileForAgent(agent), slot);
  const agentPortraitRender = (agent: ArtAgentLike, slot = "portrait") => profilePortraitRender(profileForAgent(agent), slot);

  const agentArt = (agent: ArtAgentLike, categoryId: string, fallback: string, slot = "default") => {
    const profile = profileForAgent(agent);
    return pickFromCategory(profile, categoryId, fallback, slot).src;
  };

  const agentArtRender = (agent: ArtAgentLike, categoryId: string, fallback: string, slot = "default") => {
    const profile = profileForAgent(agent);
    return pickFromCategory(profile, categoryId, fallback, slot);
  };

  const profileArt = (profile: ReikaArtProfile | null | undefined, categoryId: string, fallback: string, slot = "default") => (
    pickFromCategory(profile, categoryId, fallback, slot).src
  );

  const profileArtRender = (profile: ReikaArtProfile | null | undefined, categoryId: string, fallback: string, slot = "default") => (
    pickFromCategory(profile, categoryId, fallback, slot)
  );

  const globalArt = (categoryId: string, fallback: string, slot = "default") => {
    const globalProfile = library?.profiles.find((profile) => profile.scope === "global" && profile.id === "global")
      ?? library?.profiles.find((profile) => profile.scope === "global");
    return pickFromCategory(globalProfile, categoryId, fallback, slot).src;
  };

  const globalArtRender = (categoryId: string, fallback: string, slot = "default") => {
    const globalProfile = library?.profiles.find((profile) => profile.scope === "global" && profile.id === "global")
      ?? library?.profiles.find((profile) => profile.scope === "global");
    return pickFromCategory(globalProfile, categoryId, fallback, slot);
  };

  return {
    library,
    versionKey,
    resolveAssetUrl,
    resolveAssetRender,
    resolveAssetKey,
    profileForAgent,
    profileAvatar,
    profileAvatarRender,
    profilePortrait,
    profilePortraitRender,
    agentAvatar,
    agentAvatarRender,
    agentPortrait,
    agentPortraitRender,
    agentArt,
    agentArtRender,
    profileArt,
    profileArtRender,
    globalArt,
    globalArtRender
  };
}

export function resolveArtAssetUrl(assetRecord: ReikaArtAsset | null | undefined, fallback = assets.reika.avatar) {
  if (!assetRecord) return fallback;
  if (assetRecord.sourceUrl) return assetRecord.sourceUrl;
  if (assetRecord.filePath || assetRecord.kind === "upload") return artAssetContentUrl(assetRecord.id);
  if (assetRecord.assetKey) return resolveArtAssetKey(assetRecord.assetKey, fallback);
  return fallback;
}

export function readAssetPlacement(assetRecord: ReikaArtAsset | null | undefined): ReikaArtPlacement {
  const value = assetRecord?.metadata?.placement;
  if (!value || typeof value !== "object") return defaultPlacement();
  const input = value as Partial<Record<keyof ReikaArtPlacement, unknown>>;
  return {
    scale: clampPlacement(input.scale, 1, 3, 1),
    x: clampPlacement(input.x, -100, 100, 0),
    y: clampPlacement(input.y, -100, 100, 0)
  };
}

export function artPlacementStyle(placement: ReikaArtPlacement): CSSProperties {
  return {
    "--art-x": `${placement.x}%`,
    "--art-y": `${placement.y}%`,
    "--art-scale": String(placement.scale)
  } as CSSProperties;
}

function defaultPlacement(): ReikaArtPlacement {
  return { scale: 1, x: 0, y: 0 };
}

function clampPlacement(value: unknown, min: number, max: number, fallback: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}

export function resolveArtAssetKey(assetKey: string | undefined, fallback = assets.reika.avatar) {
  if (!assetKey) return fallback;
  const map: Record<string, string> = {
    "brand.logo": assets.brand.logoSmall,
    "brand.wordmark": assets.brand.wordmark,
    "reika.chibi": assets.reika.chibi,
    "reika.avatar": assets.reika.avatar,
    "reika.splash": assets.reika.splash,
    "reika.halfBody": assets.reika.halfBody,
    "reika.expressions.neutral": assets.reika.expressions.neutral,
    "reika.expressions.happy": assets.reika.expressions.happy,
    "reika.expressions.thinking": assets.reika.expressions.thinking,
    "reika.expressions.playful": assets.reika.expressions.playful,
    "room.full": assets.room.full,
    "room.blurred": assets.room.blurred,
    "room.hero": assets.room.hero,
    "loading.background": assets.loading.background,
    "loading.bootBackdrop": assets.loading.bootBackdrop,
    "empty.noAgents": assets.empty.noAgents,
    "empty.noChat": assets.empty.noChat
  };
  return map[assetKey] ?? fallback;
}

function findProfileForAgent(library: ReikaArtLibraryResponse | null, agent: ArtAgentLike) {
  const profiles = library?.profiles.filter((profile) => profile.scope === "agent") ?? [];
  if (profiles.length === 0) return undefined;
  const keys = agentKeys(agent);

  for (const key of keys) {
    const exact = profiles.find((profile) => profileKey(profile.id) === key || profileKey(profile.name) === key || profileBaseKey(profile.name) === key);
    if (exact) return exact;
  }

  for (const key of keys) {
    const contained = profiles.find((profile) => {
      const id = profileKey(profile.id);
      const name = profileKey(profile.name);
      const baseName = profileBaseKey(profile.name);
      return Boolean(
        (id && (key.includes(id) || id.includes(key))) ||
        (name && (key.includes(name) || name.includes(key))) ||
        (baseName && (key.includes(baseName) || baseName.includes(key)))
      );
    });
    if (contained) return contained;
  }

  for (const id of fallbackProfileOrder) {
    const known = profiles.find((profile) => profile.id === id);
    if (known && keys.some((key) => key.includes(id))) return known;
  }

  return profiles.find((profile) => profile.id === "reika") ?? profiles[0];
}

function agentKeys(agent: ArtAgentLike) {
  if (!agent) return ["reika"];
  if (typeof agent === "string") return uniqueKeys([profileBaseKey(agent), profileKey(agent)]);
  return uniqueKeys([agent.characterId, agent.id, agent.name, profileBaseKey(agent.name)].map(profileKey));
}

function cleanKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function profileKey(value: unknown) {
  return cleanKey(value).replace(/\s+/g, " ");
}

function profileBaseKey(value: unknown) {
  return profileKey(String(value ?? "").split(/\s+\/\s+/u)[0]);
}

function uniqueKeys(values: unknown[]) {
  return [...new Set(values.map(profileKey).filter((value) => value.length >= 2))];
}

function findCategory(profile: ReikaArtProfile | null | undefined, categoryId: string) {
  if (!profile) return undefined;
  const wanted = cleanCategoryKey(categoryId);
  return profile.categories.find((category) => category.id === categoryId)
    ?? profile.categories.find((category) => category.id.endsWith(`-${categoryId}`))
    ?? profile.categories.find((category) => cleanCategoryKey(category.id) === wanted)
    ?? profile.categories.find((category) => cleanCategoryKey(category.id).endsWith(`-${wanted}`))
    ?? profile.categories.find((category) => cleanCategoryKey(category.name) === wanted);
}

function cleanCategoryKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pickAsset(
  category: ReikaArtCategory | undefined,
  context: { hashKey: string; memoryKey: string; rerollNonce?: string },
  profile?: ReikaArtProfile | null,
  options: { skipInheritedReikaArt?: boolean } = {}
) {
  if (!category || category.assets.length === 0) return undefined;
  const preferredAssets = options.skipInheritedReikaArt
    ? category.assets.filter((assetRecord) => !isInheritedReikaAsset(profile, assetRecord))
    : category.assets;
  if (options.skipInheritedReikaArt && preferredAssets.length === 0) return undefined;

  if (category.selectionMode === "single") {
    return preferredAssets.find((assetRecord) => assetRecord.id === category.selectedAssetId) ?? preferredAssets[0];
  }
  const pool = preferredAssets;
  let index = positiveHash(context.hashKey) % pool.length;

  if (!context.rerollNonce) return pool[index];

  const previous = readRerollMemory(context.memoryKey);
  const previousInPool = previous ? pool.find((assetRecord) => assetRecord.id === previous.assetId) : undefined;
  if (previous?.nonce === context.rerollNonce && previousInPool) return previousInPool;

  if (pool.length > 1 && previous?.assetId && pool[index]?.id === previous.assetId) {
    index = (index + 1) % pool.length;
  }

  const picked = pool[index];
  writeRerollMemory(context.memoryKey, { nonce: context.rerollNonce, assetId: picked.id });
  return picked;
}

function isInheritedReikaAsset(profile: ReikaArtProfile | null | undefined, assetRecord: ReikaArtAsset) {
  if (isReikaProfile(profile)) return false;
  return cleanKey(assetRecord.assetKey).startsWith("reika.");
}

function isReikaProfile(profile: ReikaArtProfile | null | undefined) {
  if (!profile) return false;
  return profileKey(profile.id) === "reika" || profileBaseKey(profile.name) === "reika";
}

function positiveHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function parseRerollSlot(slot: string) {
  const [baseSlot, rerollNonce] = slot.split(rerollSeparator);
  return { baseSlot: baseSlot || "default", rerollNonce };
}

function readRerollMemory(memoryKey: string): RerollMemoryEntry | undefined {
  const cached = rerollMemory.get(memoryKey);
  if (cached) return cached;

  try {
    if (typeof sessionStorage === "undefined") return undefined;
    const raw = sessionStorage.getItem(`${rerollMemoryPrefix}${memoryKey}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<RerollMemoryEntry>;
    if (typeof parsed.nonce !== "string" || typeof parsed.assetId !== "string") return undefined;
    const entry = { nonce: parsed.nonce, assetId: parsed.assetId };
    rerollMemory.set(memoryKey, entry);
    return entry;
  } catch {
    return undefined;
  }
}

function writeRerollMemory(memoryKey: string, entry: RerollMemoryEntry) {
  rerollMemory.set(memoryKey, entry);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(`${rerollMemoryPrefix}${memoryKey}`, JSON.stringify(entry));
    }
  } catch {
    // Private browsing or storage pressure should never break art selection.
  }
}

function artVersionKey(library: ReikaArtLibraryResponse | null) {
  if (!library) return "fallback";
  return [
    library.storage.lastSavedAt ?? "unsaved",
    library.storage.profileCount,
    library.storage.assetCount,
    library.profiles.map((profile) => `${profile.id}:${profile.updatedAt}:${profile.categories.map((category) => `${category.id}:${category.selectionMode}:${category.selectedAssetId ?? ""}:${category.assets.length}`).join(",")}`).join("|")
  ].join(":");
}
