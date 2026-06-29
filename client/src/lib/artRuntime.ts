import { assets } from "../data/assets";
import type { Agent } from "../types";
import {
  artAssetContentUrl,
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
  resolveAssetKey: (assetKey: string | undefined, fallback?: string) => string;
  profileForAgent: (agent: ArtAgentLike) => ReikaArtProfile | undefined;
  profileAvatar: (profile: ReikaArtProfile | null | undefined, slot?: string) => string;
  agentAvatar: (agent: ArtAgentLike, slot?: string) => string;
  agentArt: (agent: ArtAgentLike, categoryId: string, fallback: string, slot?: string) => string;
  profileArt: (profile: ReikaArtProfile | null | undefined, categoryId: string, fallback: string, slot?: string) => string;
  globalArt: (categoryId: string, fallback: string, slot?: string) => string;
}

const fallbackProfileOrder = ["reika", "astra", "miyabi", "nyxie"];

export function makeArtRuntimeSeed() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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

  const resolveAssetKey = (assetKey: string | undefined, fallback = assets.reika.avatar) => resolveArtAssetKey(assetKey, fallback);

  const profileForAgent = (agent: ArtAgentLike) => findProfileForAgent(library, agent);

  const pickFromCategory = (profile: ReikaArtProfile | null | undefined, categoryId: string, fallback: string, slot = "default") => {
    const category = findCategory(profile, categoryId);
    const assetRecord = pickAsset(category, `${sessionSeed}:${versionKey}:${profile?.id ?? "none"}:${categoryId}:${slot}`);
    return resolveAssetUrl(assetRecord, fallback);
  };

  const profileAvatar = (profile: ReikaArtProfile | null | undefined, slot = "avatar") => {
    const fallback = resolveAssetKey(profile?.avatarAssetKey, assets.reika.avatar);
    return pickFromCategory(profile, "avatar-circle", fallback, slot);
  };

  const agentAvatar = (agent: ArtAgentLike, slot = "avatar") => profileAvatar(profileForAgent(agent), slot);

  const agentArt = (agent: ArtAgentLike, categoryId: string, fallback: string, slot = "default") => {
    const profile = profileForAgent(agent);
    return pickFromCategory(profile, categoryId, fallback, slot);
  };

  const profileArt = (profile: ReikaArtProfile | null | undefined, categoryId: string, fallback: string, slot = "default") => (
    pickFromCategory(profile, categoryId, fallback, slot)
  );

  const globalArt = (categoryId: string, fallback: string, slot = "default") => {
    const globalProfile = library?.profiles.find((profile) => profile.scope === "global" && profile.id === "global")
      ?? library?.profiles.find((profile) => profile.scope === "global");
    return pickFromCategory(globalProfile, categoryId, fallback, slot);
  };

  return {
    library,
    versionKey,
    resolveAssetUrl,
    resolveAssetKey,
    profileForAgent,
    profileAvatar,
    agentAvatar,
    agentArt,
    profileArt,
    globalArt
  };
}

export function resolveArtAssetUrl(assetRecord: ReikaArtAsset | null | undefined, fallback = assets.reika.avatar) {
  if (!assetRecord) return fallback;
  if (assetRecord.sourceUrl) return assetRecord.sourceUrl;
  if (assetRecord.filePath || assetRecord.kind === "upload") return artAssetContentUrl(assetRecord.id);
  if (assetRecord.assetKey) return resolveArtAssetKey(assetRecord.assetKey, fallback);
  return fallback;
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
    const exact = profiles.find((profile) => profile.id.toLowerCase() === key || profile.name.toLowerCase() === key);
    if (exact) return exact;
  }

  for (const key of keys) {
    const contained = profiles.find((profile) => key.includes(profile.id.toLowerCase()) || key.includes(profile.name.toLowerCase()));
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
  if (typeof agent === "string") return [cleanKey(agent)];
  return [agent.characterId, agent.id, agent.name].map(cleanKey).filter(Boolean);
}

function cleanKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function findCategory(profile: ReikaArtProfile | null | undefined, categoryId: string) {
  if (!profile) return undefined;
  return profile.categories.find((category) => category.id === categoryId)
    ?? profile.categories.find((category) => category.id.endsWith(`-${categoryId}`))
    ?? profile.categories.find((category) => category.name.toLowerCase() === categoryId.toLowerCase());
}

function pickAsset(category: ReikaArtCategory | undefined, key: string) {
  if (!category || category.assets.length === 0) return undefined;
  if (category.selectionMode === "single") {
    return category.assets.find((assetRecord) => assetRecord.id === category.selectedAssetId) ?? category.assets[0];
  }
  const index = positiveHash(key) % category.assets.length;
  return category.assets[index];
}

function positiveHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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
