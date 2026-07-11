import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ChangeEvent, ElementType } from "react";
import { Activity, Bell, Box, Check, ChevronDown, Copy, Gift, Grid2X2, Heart, Images, Info, KeyRound, Layers, Link2, List, Monitor, Plus, Sparkles, Trash2, TriangleAlert, Upload, UserRound, WandSparkles, X } from "lucide-react";
import {
  connectArtOAuth,
  createArtCategory,
  createArtProfile,
  deleteArtAsset,
  deleteArtCategory,
  deleteArtProfile,
  disconnectArtOAuth,
  duplicateArtProfile,
  getArtLibrary,
  linkArtAsset,
  requestArtGeneration,
  updateArtCategory,
  updateArtAsset,
  uploadArtAsset,
  type ReikaArtAsset,
  type ReikaArtCategory,
  type ReikaArtGenerationStatus,
  type ReikaArtLibraryResponse,
  type ReikaArtPlacement,
  type ReikaArtProfile,
  type ReikaArtScope
} from "../../lib/reikaApi";
import { artPlacementStyle, readAssetPlacement, resolveArtAssetUrl, type ArtRuntime } from "../../lib/artRuntime";
import { StatusDot } from "../../components/status";
import { statusLabels } from "../../app/constants";
import { cx, motionDelay, pageMotionClass } from "../../lib/motion";
import type { Agent, Device } from "../../types";

const defaultPlacement: ReikaArtPlacement = { scale: 1, x: 0, y: 0 };

export function AgentArtStudio({
  initialLibrary,
  devices = [],
  artRuntime,
  onLibraryChange
}: {
  initialLibrary: ReikaArtLibraryResponse | null;
  devices?: Device[];
  artRuntime: ArtRuntime;
  onLibraryChange: (library: ReikaArtLibraryResponse) => void;
}) {
  type ArtActionResponse = ReikaArtLibraryResponse & {
    profile?: ReikaArtProfile;
    category?: ReikaArtCategory;
    asset?: ReikaArtAsset;
    generation?: ReikaArtGenerationStatus;
  };

  const [library, setLibrary] = useState<ReikaArtLibraryResponse | null>(initialLibrary);
  const [activeScope, setActiveScope] = useState<ReikaArtScope>("agent");
  const [selectedProfileId, setSelectedProfileId] = useState("reika");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "selected">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [manageAssets, setManageAssets] = useState(false);
  const [manageReferences, setManageReferences] = useState(false);
  const [placementDraft, setPlacementDraft] = useState<ReikaArtPlacement>(defaultPlacement);
  const [placementPreview, setPlacementPreview] = useState<"chat" | "avatar" | "banner">("chat");
  const [positionEditorOpen, setPositionEditorOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [systemPromptDraft, setSystemPromptDraft] = useState("");
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generationState, setGenerationState] = useState<Record<string, ReikaArtGenerationStatus | { status: "waiting" | "running"; message: string; profileId: string; categoryId: string }>>({});

  const applyLibrary = (response: ReikaArtLibraryResponse) => {
    setLibrary(response);
    onLibraryChange(response);
  };

  const loadLibrary = () => {
    setBusy("load");
    setNotice(null);
    getArtLibrary()
      .then((response) => applyLibrary(response))
      .catch((error) => setNotice(readableError(error, "Could not load Agent Art Studio.")))
      .finally(() => setBusy(null));
  };

  useEffect(() => {
    if (initialLibrary) {
      setLibrary(initialLibrary);
      return;
    }
    loadLibrary();
  }, [initialLibrary]);

  const profiles = useMemo(() => library?.profiles.filter((profile) => profile.scope === activeScope) ?? [], [activeScope, library]);
  const discoveredAgents = useMemo(() => uniqueAgents(devices), [devices]);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? null;
  const categories = selectedProfile?.categories ?? [];
  const visibleCategories = categoryFilter === "selected"
    ? categories.filter((category) => Boolean(category.selectedAssetId))
    : categories;
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) ?? categories[0] ?? null;
  const selectedAsset = selectedCategory?.assets.find((item) => item.id === selectedCategory.selectedAssetId) ?? selectedCategory?.assets[0] ?? null;
  const selectedAssetUrl = selectedAsset ? resolveArtAssetUrl(selectedAsset) : "";
  const selectedPreviewUrl = selectedAsset ? resolveArtAssetUrl(selectedAsset) : "";
  const selectedReferences = selectedCategory?.referenceAssetIds
    .map((id) => selectedCategory.assets.find((item) => item.id === id))
    .filter((item): item is ReikaArtAsset => Boolean(item)) ?? [];
  const imageCredits = library?.storage.assetCount ?? 0;

  useEffect(() => {
    if (!selectedProfile && profiles[0]) {
      setSelectedProfileId(profiles[0].id);
      return;
    }
    if (selectedProfile && selectedProfile.id !== selectedProfileId) setSelectedProfileId(selectedProfile.id);
  }, [profiles, selectedProfile, selectedProfileId]);

  useEffect(() => {
    if (!selectedCategory && categories[0]) {
      setSelectedCategoryId(categories[0].id);
      return;
    }
    if (selectedCategory && selectedCategory.id !== selectedCategoryId) setSelectedCategoryId(selectedCategory.id);
  }, [categories, selectedCategory, selectedCategoryId]);

  useEffect(() => {
    setPromptDraft(selectedCategory?.prompt ?? "");
    setSystemPromptDraft(selectedCategory?.systemPrompt ?? "");
  }, [selectedCategory?.id, selectedCategory?.prompt, selectedCategory?.systemPrompt]);

  useEffect(() => {
    setPlacementDraft(readAssetPlacement(selectedAsset));
  }, [selectedAsset?.id]);

  useEffect(() => {
    if (!library || activeScope !== "agent" || discoveredAgents.length === 0 || busy) return;
    const existing = new Set(library.profiles.filter((profile) => profile.scope === "agent").flatMap((profile) => [profile.id.toLowerCase(), profile.name.toLowerCase()]));
    const missing = discoveredAgents.find((agent) => !existing.has(String(agent.characterId ?? "").toLowerCase()) && !existing.has(agent.id.toLowerCase()) && !existing.has(agent.name.toLowerCase()));
    if (!missing) return;
    runAction(
      "sync-agent-profile",
      () => createArtProfile({ name: missing.name, subtitle: `${missing.role || "Agent"} • ${missing.deviceId}`, scope: "agent" }),
      (response) => {
        if (response.profile) setSelectedProfileId(response.profile.id);
        return `Created art profile for ${missing.name}.`;
      }
    );
  }, [activeScope, busy, discoveredAgents, library]);

  const runAction = (label: string, action: () => Promise<ArtActionResponse>, success?: (response: ArtActionResponse) => string | void) => {
    setBusy(label);
    setNotice(null);
    action()
      .then((response) => {
        applyLibrary(response);
        const message = success?.(response);
        if (message) setNotice(message);
      })
      .catch((error) => setNotice(readableError(error, "Art Studio action failed.")))
      .finally(() => setBusy(null));
  };

  const selectScope = (scope: ReikaArtScope) => {
    setActiveScope(scope);
    const nextProfile = library?.profiles.find((profile) => profile.scope === scope);
    if (nextProfile) {
      setSelectedProfileId(nextProfile.id);
      setSelectedCategoryId(nextProfile.categories[0]?.id ?? "");
    }
  };

  const createProfileForScope = () => {
    const name = activeScope === "global" ? "Global Collection" : `Agent ${profiles.length + 1}`;
    runAction("create-profile", () => createArtProfile({ name, scope: activeScope }), (response) => {
      if (response.profile) {
        setSelectedProfileId(response.profile.id);
        setSelectedCategoryId(response.profile.categories[0]?.id ?? "");
      }
      return "New art profile created.";
    });
  };

  const duplicateProfile = () => {
    if (!selectedProfile) return;
    runAction("duplicate-profile", () => duplicateArtProfile(selectedProfile.id), (response) => {
      if (response.profile) {
        setSelectedProfileId(response.profile.id);
        setSelectedCategoryId(response.profile.categories[0]?.id ?? "");
      }
      return "Profile duplicated.";
    });
  };

  const removeProfile = () => {
    if (!selectedProfile || selectedProfile.defaultProfile) return;
    runAction("delete-profile", () => deleteArtProfile(selectedProfile.id), (response) => {
      const next = response.profiles.find((profile) => profile.scope === activeScope);
      setSelectedProfileId(next?.id ?? "");
      setSelectedCategoryId(next?.categories[0]?.id ?? "");
      return "Profile deleted.";
    });
  };

  const savePrompt = () => {
    if (!selectedProfile || !selectedCategory) return;
    runAction("save-prompt", () => updateArtCategory(selectedProfile.id, selectedCategory.id, { prompt: promptDraft, systemPrompt: systemPromptDraft }), () => "Prompt saved.");
  };

  const setSelectionMode = (selectionMode: "single" | "random") => {
    if (!selectedProfile || !selectedCategory) return;
    runAction("selection-mode", () => updateArtCategory(selectedProfile.id, selectedCategory.id, { selectionMode }), () => `Selection mode set to ${selectionMode}.`);
  };

  const chooseAsset = (assetId: string) => {
    if (!selectedProfile || !selectedCategory) return;
    runAction("select-asset", () => updateArtCategory(selectedProfile.id, selectedCategory.id, { selectedAssetId: assetId, selectionMode: "single" }), () => "Selected art updated.");
  };

  const toggleReference = (assetId: string) => {
    if (!selectedProfile || !selectedCategory) return;
    const set = new Set(selectedCategory.referenceAssetIds);
    if (set.has(assetId)) set.delete(assetId);
    else set.add(assetId);
    runAction("reference-toggle", () => updateArtCategory(selectedProfile.id, selectedCategory.id, { referenceAssetIds: Array.from(set) }), () => "Reference pool updated.");
  };

  const addCategory = () => {
    if (!selectedProfile) return;
    runAction("create-category", () => createArtCategory(selectedProfile.id, { name: "Custom Art" }), (response) => {
      if (response.category) setSelectedCategoryId(response.category.id);
      return "Custom category created.";
    });
  };

  const removeCategory = () => {
    if (!selectedProfile || !selectedCategory) return;
    runAction("delete-category", () => deleteArtCategory(selectedProfile.id, selectedCategory.id), (response) => {
      const profile = response.profiles.find((item) => item.id === selectedProfile.id);
      setSelectedCategoryId(profile?.categories[0]?.id ?? "");
      return "Category deleted.";
    });
  };

  const uploadAsset = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedProfile || !selectedCategory) return;
    runAction("upload-art", () => uploadArtAsset(selectedProfile.id, selectedCategory.id, file, promptDraft), () => "Art uploaded and selected.");
  };

  const addLink = () => {
    if (!selectedProfile || !selectedCategory || !linkUrl.trim()) return;
    runAction("link-art", () => linkArtAsset(selectedProfile.id, selectedCategory.id, { name: linkName, url: linkUrl, prompt: promptDraft }), () => {
      setLinkName("");
      setLinkUrl("");
      return "Linked art added.";
    });
  };

  const removeAsset = () => {
    if (!selectedProfile || !selectedCategory || !selectedAsset || selectedAsset.kind === "seed") return;
    runAction("delete-asset", () => deleteArtAsset(selectedProfile.id, selectedCategory.id, selectedAsset.id), () => "Art asset removed.");
  };

  const removeAssetById = (asset: ReikaArtAsset) => {
    if (!selectedProfile || !selectedCategory || asset.kind === "seed") return;
    runAction("delete-asset", () => deleteArtAsset(selectedProfile.id, selectedCategory.id, asset.id), () => `${asset.name} deleted.`);
  };

  const removeReference = (assetId: string) => {
    if (!selectedProfile || !selectedCategory) return;
    runAction(
      "reference-remove",
      () => updateArtCategory(selectedProfile.id, selectedCategory.id, { referenceAssetIds: selectedCategory.referenceAssetIds.filter((id) => id !== assetId) }),
      () => "Reference removed."
    );
  };

  const savePlacement = () => {
    if (!selectedProfile || !selectedCategory || !selectedAsset) return;
    runAction(
      "asset-placement",
      () => updateArtAsset(selectedProfile.id, selectedCategory.id, selectedAsset.id, { placement: placementDraft }),
      () => "Image placement saved."
    );
  };

  const resetPlacement = () => {
    if (!selectedProfile || !selectedCategory || !selectedAsset) return;
    setPlacementDraft(defaultPlacement);
    runAction(
      "asset-placement",
      () => updateArtAsset(selectedProfile.id, selectedCategory.id, selectedAsset.id, { placement: null }),
      () => "Image placement reset."
    );
  };

  const generateMore = () => {
    if (!selectedProfile || !selectedCategory) return;
    setGenerationState((current) => ({
      ...current,
      [selectedCategory.id]: { status: "running", message: `Generating ${selectedCategory.name}...`, profileId: selectedProfile.id, categoryId: selectedCategory.id }
    }));
    runAction("generate-art", () => requestArtGeneration(selectedProfile.id, selectedCategory.id), (response) => {
      if (response.generation) {
        setGenerationState((current) => ({
          ...current,
          [selectedCategory.id]: response.generation!
        }));
      }
      return response.generation?.message ?? "Generation request checked.";
    });
  };

  const clearProfileDefaults = async () => {
    if (!selectedProfile || selectedProfile.defaultProfile) return;
    setBusy("clear-default-art");
    setNotice(null);
    try {
      let latest: ReikaArtLibraryResponse | null = library;
      for (const category of selectedProfile.categories) {
        for (const asset of category.assets) {
          if (asset.kind !== "seed") continue;
          latest = await deleteArtAsset(selectedProfile.id, category.id, asset.id);
        }
      }
      if (latest) applyLibrary(latest);
      setNotice("Default seed art cleared for this custom agent profile.");
    } catch (error) {
      setNotice(readableError(error, "Could not clear default art."));
    } finally {
      setBusy(null);
    }
  };

  const generateAllCategories = async () => {
    if (!selectedProfile) return;
    setBusy("generate-all-art");
    setNotice(null);
    const pending = Object.fromEntries(selectedProfile.categories.map((category) => [
      category.id,
      { status: "waiting" as const, message: `Waiting to generate ${category.name}.`, profileId: selectedProfile.id, categoryId: category.id }
    ]));
    setGenerationState((current) => ({ ...current, ...pending }));
    try {
      let latest: ReikaArtLibraryResponse | null = library;
      for (const category of selectedProfile.categories) {
        setGenerationState((current) => ({
          ...current,
          [category.id]: { status: "running", message: `Generating ${category.name}...`, profileId: selectedProfile.id, categoryId: category.id }
        }));
        const response = await requestArtGeneration(selectedProfile.id, category.id);
        latest = response;
        setGenerationState((current) => ({
          ...current,
          [category.id]: response.generation
        }));
        applyLibrary(response);
        if (response.generation.status === "blocked" || response.generation.status === "failed") break;
      }
      if (latest) applyLibrary(latest);
      setNotice("Generate-all pass finished. Check the status list for any blocked or failed category.");
    } catch (error) {
      setNotice(readableError(error, "Generate-all failed."));
    } finally {
      setBusy(null);
    }
  };

  const connectImageGeneration = () => {
    const apiKey = apiKeyDraft.trim();
    if (!apiKey) {
      setNotice("Paste an OpenAI API key first, or use Codex auth from the local server.");
      return;
    }
    setBusy("connect-art-auth");
    setNotice(null);
    connectArtOAuth({ apiKey })
      .then((response) => {
        if (library) applyLibrary({ ...library, oauth: response.oauth });
        setApiKeyDraft("");
        setNotice(response.message);
      })
      .catch((error) => setNotice(readableError(error, "Could not save image generation key.")))
      .finally(() => setBusy(null));
  };

  const clearImageGenerationKey = () => {
    setBusy("disconnect-art-auth");
    setNotice(null);
    disconnectArtOAuth()
      .then((response) => {
        if (library) applyLibrary({ ...library, oauth: response.oauth });
        setNotice(response.message);
      })
      .catch((error) => setNotice(readableError(error, "Could not clear image generation key.")))
      .finally(() => setBusy(null));
  };

  return (
    <main className={pageMotionClass("page agent-art-page")}>
      <header className="art-header">
        <div>
          <span className="art-title-line">
            <h1>Agent Art Studio</h1>
            <b>Beta</b>
          </span>
          <p>Manage, generate, and customize art for your agents and global assets.</p>
        </div>
        <div className="art-header-actions">
          <button className="secondary-action small" type="button" onClick={() => setNotice("Agent Art Studio stores production art by profile, category, prompt, references, and selection mode.")}>
            <Info size={16} />
            How it works
          </button>
          <div className={cx("art-auth-card", library?.oauth.connected && "connected")}>
            <KeyRound size={18} />
            <span>
              <small>Image Auth</small>
              <strong>{library?.oauth.connected ? authLabel(library.oauth.source) : "Not Set"}</strong>
            </span>
            <input
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              placeholder="OpenAI API key"
              type="password"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="secondary-action small" type="button" onClick={connectImageGeneration} disabled={busy !== null || !apiKeyDraft.trim()}>
              Save
            </button>
            <button className="icon-button compact" type="button" onClick={clearImageGenerationKey} disabled={busy !== null} aria-label="Clear saved image key">
              <X size={16} />
            </button>
          </div>
          <div className="art-credit-card">
            <Images size={20} />
            <span>
              <small>Image Credits</small>
              <strong>{imageCredits.toLocaleString()}</strong>
            </span>
            <button className="icon-button compact" type="button" onClick={createProfileForScope} aria-label="Create art profile">
              <Plus size={18} />
            </button>
          </div>
        </div>
      </header>

      {notice ? (
        <div className="art-notice">
          <Info size={16} />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice">
            <X size={16} />
          </button>
        </div>
      ) : null}

      <div className="art-layout">
        <section className="art-main-panel">
          <div className="art-tabs" role="tablist" aria-label="Art scope">
            <button className={activeScope === "agent" ? "active" : ""} type="button" onClick={() => selectScope("agent")}>
              <WandSparkles size={16} />
              Agent Art
            </button>
            <button className={activeScope === "global" ? "active" : ""} type="button" onClick={() => selectScope("global")}>
              <Box size={16} />
              Global Art
            </button>
          </div>

          <section className="art-section">
            <div className="art-section-heading">
              <span>
                <h2>{activeScope === "agent" ? "Select Agent" : "Select Collection"}</h2>
                <p>{activeScope === "agent" ? "Each agent owns its own visual identity." : "Global art affects the app shell and shared states."}</p>
              </span>
              <div className="art-profile-actions">
                <button className="secondary-action small" type="button" onClick={duplicateProfile} disabled={!selectedProfile || busy !== null}>
                  <Copy size={15} />
                  Duplicate
                </button>
                <button className="secondary-action small danger-inline" type="button" onClick={removeProfile} disabled={!selectedProfile || selectedProfile.defaultProfile || busy !== null}>
                  <Trash2 size={15} />
                  Delete
                </button>
                <button className="secondary-action small danger-inline" type="button" onClick={clearProfileDefaults} disabled={!selectedProfile || selectedProfile.defaultProfile || busy !== null}>
                  <Trash2 size={15} />
                  Clear Defaults
                </button>
                <button className="primary-action small" type="button" onClick={generateAllCategories} disabled={!selectedProfile || busy !== null}>
                  <WandSparkles size={15} />
                  Generate All
                </button>
              </div>
            </div>

            <div className="art-agent-strip">
              {profiles.map((profile, index) => (
                <button className={cx("art-agent-card motion-card", profile.id === selectedProfile?.id && "active")} key={profile.id} type="button" style={motionDelay(index, 36)} onClick={() => {
                  setSelectedProfileId(profile.id);
                  setSelectedCategoryId(profile.categories[0]?.id ?? "");
                }}>
                  <img src={artRuntime.profileAvatar(profile, "studio-profile")} alt="" loading="lazy" decoding="async" />
                  <span>
                    <strong>{profile.name}</strong>
                    <small>{profile.subtitle}</small>
                    <em>
                      <StatusDot status={profile.status === "draft" ? "connecting" : profile.status} />
                      {profile.status === "draft" ? "Draft" : statusLabels[profile.status]}
                    </em>
                  </span>
                </button>
              ))}
              <button className="art-add-card" type="button" onClick={createProfileForScope}>
                <Plus size={26} />
                <span>Add {activeScope === "agent" ? "Agent" : "Collection"}</span>
              </button>
            </div>
          </section>

          <section className="art-section">
            <div className="art-section-heading">
              <span>
                <h2>Art Categories</h2>
                <p>Each category controls how art is used across AgentHub.</p>
              </span>
              <div className="art-toolbar">
                <button className="select-button compact-select" type="button" onClick={() => setCategoryFilter((current) => (current === "all" ? "selected" : "all"))}>
                  Show: {categoryFilter === "all" ? "All" : "Selected"}
                  <ChevronDown size={15} />
                </button>
                <div className="art-view-toggle">
                  <button className={viewMode === "grid" ? "active" : ""} type="button" onClick={() => setViewMode("grid")} aria-label="Grid view">
                    <Grid2X2 size={17} />
                  </button>
                  <button className={viewMode === "list" ? "active" : ""} type="button" onClick={() => setViewMode("list")} aria-label="List view">
                    <List size={17} />
                  </button>
                </div>
              </div>
            </div>

            <div className="art-categories-layout">
              <aside className="art-category-rail">
                <button className={selectedCategoryId === "" ? "active" : ""} type="button" onClick={() => setCategoryFilter("all")}>
                  <Layers size={16} />
                  <span>All Categories</span>
                  <strong>{categories.length}</strong>
                </button>
                {categories.map((category) => {
                  const Icon = artCategoryIcon(category.icon);
                  return (
                    <button className={category.id === selectedCategory?.id ? "active" : ""} key={category.id} type="button" onClick={() => setSelectedCategoryId(category.id)}>
                      <Icon size={16} />
                      <span>{category.name}</span>
                      <strong>{category.assets.length}</strong>
                    </button>
                  );
                })}
              </aside>

              <div className={viewMode === "grid" ? "art-category-grid" : "art-category-grid list"}>
                {visibleCategories.map((category, index) => (
                  <ArtCategoryCard
                    category={category}
                    key={category.id}
                    active={category.id === selectedCategory?.id}
                    onClick={() => setSelectedCategoryId(category.id)}
                    motionIndex={index}
                  />
                ))}
                <button className="art-category-card add motion-card" type="button" onClick={addCategory} style={motionDelay(visibleCategories.length, 36)}>
                  <Plus size={28} />
                  <strong>Add Category</strong>
                  <small>Create a new art category</small>
                </button>
              </div>
            </div>
          </section>

          <footer className="art-tip">
            <Sparkles size={16} />
            Changes are saved automatically. Generated images use the saved OpenAI API key, env key, or Codex auth when available.
          </footer>
        </section>

        <aside className="art-detail-panel">
          {selectedProfile && selectedCategory ? (
            <>
              <header className="art-detail-header">
                <span>
                  <h2>{selectedCategory.name}</h2>
                  <p>{selectedCategory.description}</p>
                </span>
                <ChevronDown size={18} />
              </header>

              <div className="art-preview-frame">
                {selectedPreviewUrl ? <img src={selectedPreviewUrl} alt="" style={assetPlacementStyle(selectedAsset)} /> : <div>No artwork yet</div>}
              </div>

              <section className="art-detail-section art-position-editor">
                <button className="art-position-toggle" type="button" onClick={() => setPositionEditorOpen(true)} aria-haspopup="dialog" aria-expanded={positionEditorOpen}>
                  <span>
                    <strong>Position Editor</strong>
                    <small>{selectedAsset?.name ?? "No image"} - {Math.round(placementDraft.scale * 100)}%, X {placementDraft.x}, Y {placementDraft.y}</small>
                  </span>
                  <ChevronDown size={17} />
                </button>
              </section>

              <section className="art-detail-section">
                <div className="art-detail-title">
                  <h3>Selection Mode</h3>
                  <Info size={14} />
                </div>
                <div className="art-segmented">
                  <button className={selectedCategory.selectionMode === "single" ? "active" : ""} type="button" onClick={() => setSelectionMode("single")}>Single</button>
                  <button className={selectedCategory.selectionMode === "random" ? "active" : ""} type="button" onClick={() => setSelectionMode("random")}>Random</button>
                </div>
                <p>{selectedCategory.selectionMode === "random" ? "Shows a random image from the selected pool." : "Always uses the selected image."}</p>
                {selectedCategory ? <GenerationStatusLine status={generationState[selectedCategory.id]} /> : null}
              </section>

              <section className="art-detail-section">
                <div className="art-detail-title">
                  <h3>Current Pool ({selectedCategory.assets.length} images)</h3>
                  <button type="button" onClick={() => setManageAssets((current) => !current)}>{manageAssets ? "Done" : "Manage"}</button>
                </div>
                <div className="art-pool-grid">
                  {selectedCategory.assets.map((item) => (
                    <div className={cx("art-image-tile", item.id === selectedCategory.selectedAssetId && "selected")} key={item.id}>
                      <button type="button" onClick={() => chooseAsset(item.id)} title={`Select ${item.name}`}>
                        <img src={resolveArtAssetUrl(item)} alt="" style={assetPlacementStyle(item)} loading="lazy" decoding="async" />
                        {item.id === selectedCategory.selectedAssetId ? <Check size={15} /> : null}
                      </button>
                      {manageAssets ? (
                        <button className="art-tile-delete" type="button" onClick={() => removeAssetById(item)} disabled={item.kind === "seed" || busy !== null} title={item.kind === "seed" ? "Default seed art cannot be deleted here" : `Delete ${item.name}`}>
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="art-detail-actions">
                  <button className="primary-action small" type="button" onClick={generateMore} disabled={busy !== null}>
                    <Plus size={17} />
                    Generate More
                  </button>
                  <label className="secondary-action small upload-label">
                    <Upload size={17} />
                    Upload Art
                    <input type="file" accept="image/*" onChange={uploadAsset} />
                  </label>
                </div>
                <div className="art-link-row">
                  <input value={linkName} onChange={(event) => setLinkName(event.target.value)} placeholder="Name" />
                  <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://..." />
                  <button type="button" onClick={addLink} disabled={!linkUrl.trim() || busy !== null}>
                    <Link2 size={16} />
                  </button>
                </div>
              </section>

              <section className="art-detail-section">
                <details open>
                  <summary>
                    <span>Prompt (System Prompt)</span>
                    <button type="button" onClick={savePrompt}>Save</button>
                  </summary>
                  <textarea value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} rows={5} />
                  <textarea value={systemPromptDraft} onChange={(event) => setSystemPromptDraft(event.target.value)} rows={3} />
                </details>
              </section>

              <section className="art-detail-section">
                <div className="art-detail-title">
                  <h3>Reference Images ({selectedReferences.length})</h3>
                  <button type="button" onClick={() => setManageReferences((current) => !current)}>{manageReferences ? "Done" : "Manage"}</button>
                </div>
                <div className="art-reference-row">
                  {selectedCategory.assets.map((item) => (
                    <div className={cx("art-image-tile", selectedCategory.referenceAssetIds.includes(item.id) && "active")} key={item.id}>
                      <button type="button" onClick={() => toggleReference(item.id)} title={selectedCategory.referenceAssetIds.includes(item.id) ? `Stop using ${item.name} as a reference` : `Use ${item.name} as a reference`}>
                        <img src={resolveArtAssetUrl(item)} alt="" style={assetPlacementStyle(item)} loading="lazy" decoding="async" />
                        {selectedCategory.referenceAssetIds.includes(item.id) ? <Check size={15} /> : null}
                      </button>
                      {manageReferences && selectedCategory.referenceAssetIds.includes(item.id) ? (
                        <button className="art-tile-remove" type="button" onClick={() => removeReference(item.id)} disabled={busy !== null} title={`Remove ${item.name} from references`}>
                          <X size={14} />
                        </button>
                      ) : null}
                      {manageReferences ? (
                        <button className="art-tile-delete" type="button" onClick={() => removeAssetById(item)} disabled={item.kind === "seed" || busy !== null} title={item.kind === "seed" ? "Default seed art cannot be deleted here" : `Delete ${item.name}`}>
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <label className="art-reference-add">
                    <Plus size={24} />
                    <input type="file" accept="image/*" onChange={uploadAsset} />
                  </label>
                </div>
              </section>

              <section className="art-detail-section">
                <div className="art-detail-title">
                  <h3>Generation Queue</h3>
                  <span>{Object.keys(generationState).length} tracked</span>
                </div>
                <div className="art-generation-list">
                  {selectedProfile.categories.map((category) => (
                    <GenerationStatusLine key={category.id} label={category.name} status={generationState[category.id]} />
                  ))}
                </div>
              </section>

              <button className="danger-action" type="button" onClick={removeAsset} disabled={!selectedAsset || selectedAsset.kind === "seed"}>
                <Trash2 size={18} />
                Delete Selected Asset
              </button>
              <button className="danger-action subtle-danger" type="button" onClick={removeCategory} disabled={categories.length <= 1}>
                <Trash2 size={18} />
                Delete Category
              </button>
            </>
          ) : (
            <section className="art-empty-detail">
              <Images size={44} />
              <h2>Art library offline</h2>
              <p>{notice ?? "Start the local Reika server to manage art profiles."}</p>
              <button className="primary-action small" type="button" onClick={loadLibrary}>
                Retry
              </button>
            </section>
          )}
        </aside>
      </div>
      {positionEditorOpen ? (
        <div className="art-position-modal-backdrop" role="presentation" onMouseDown={() => setPositionEditorOpen(false)}>
          <section className="art-position-modal" role="dialog" aria-modal="true" aria-label="Position Editor" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <span>
                <h2>Position Editor</h2>
                <p>{selectedProfile?.name ?? "Agent"} - {selectedCategory?.name ?? "Art"} - {selectedAsset?.name ?? "No image selected"}</p>
              </span>
              <button className="icon-button compact" type="button" onClick={() => setPositionEditorOpen(false)} aria-label="Close position editor">
                <X size={17} />
              </button>
            </header>
            <div className="art-position-modal-grid">
              <div className="art-position-source-panel">
                <span>Full Image</span>
                <div className="art-position-source-preview">
                  {selectedAssetUrl ? <img src={selectedAssetUrl} alt="" /> : <small>No artwork yet</small>}
                </div>
              </div>
              <div className="art-position-crop-panel">
                <div className="art-position-presets" role="tablist" aria-label="Preview shape">
                  <button className={placementPreview === "chat" ? "active" : ""} type="button" onClick={() => setPlacementPreview("chat")}>Chat</button>
                  <button className={placementPreview === "avatar" ? "active" : ""} type="button" onClick={() => setPlacementPreview("avatar")}>Avatar</button>
                  <button className={placementPreview === "banner" ? "active" : ""} type="button" onClick={() => setPlacementPreview("banner")}>Banner</button>
                </div>
                <div className={cx("art-position-preview large", `mode-${placementPreview}`)}>
                  {selectedAssetUrl ? <img src={selectedAssetUrl} alt="" style={placementStyle(placementDraft)} /> : <span>No artwork yet</span>}
                </div>
              </div>
            </div>
            <div className="art-position-controls modal-controls">
              <label>
                <span>Size</span>
                <input type="range" min="1" max="3" step="0.01" value={placementDraft.scale} onChange={(event) => setPlacementDraft((current) => ({ ...current, scale: Number(event.target.value) }))} disabled={!selectedAsset} />
                <b>{Math.round(placementDraft.scale * 100)}%</b>
              </label>
              <label>
                <span>X</span>
                <input type="range" min="-100" max="100" step="1" value={placementDraft.x} onChange={(event) => setPlacementDraft((current) => ({ ...current, x: Number(event.target.value) }))} disabled={!selectedAsset} />
                <b>{placementDraft.x}</b>
              </label>
              <label>
                <span>Y</span>
                <input type="range" min="-100" max="100" step="1" value={placementDraft.y} onChange={(event) => setPlacementDraft((current) => ({ ...current, y: Number(event.target.value) }))} disabled={!selectedAsset} />
                <b>{placementDraft.y}</b>
              </label>
            </div>
            <footer>
              <button className="secondary-action small" type="button" onClick={resetPlacement} disabled={!selectedAsset || busy !== null}>
                <X size={16} />
                Reset
              </button>
              <button className="primary-action small" type="button" onClick={savePlacement} disabled={!selectedAsset || busy !== null}>
                <Check size={16} />
                Save Position
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function authLabel(source?: string) {
  if (source === "stored") return "Saved Key";
  if (source === "env") return "Env Key";
  if (source === "codex-auth") return "Codex Key";
  if (source === "codex-oauth") return "Codex OAuth";
  return "Not Set";
}

function ArtCategoryCard({ category, active, onClick, motionIndex = 0 }: { category: ReikaArtCategory; active: boolean; onClick: () => void; motionIndex?: number }) {
  const preview = category.assets.slice(0, category.id.includes("expressions") || category.id.includes("chibi") ? 3 : 1);
  return (
    <button className={cx("art-category-card motion-card", active && "active")} type="button" onClick={onClick} style={motionDelay(motionIndex, 36)}>
      <strong>{category.name}</strong>
      <div className={preview.length > 1 ? "art-card-preview multi" : "art-card-preview"}>
        {preview.length > 0 ? preview.map((item) => <img src={resolveArtAssetUrl(item)} alt="" key={item.id} style={assetPlacementStyle(item)} loading="lazy" decoding="async" />) : <span>No art yet</span>}
      </div>
      <footer>
        <span>
          <UserRound size={14} />
          {category.assets.length}
        </span>
        <b>Selected: {category.selectionMode === "random" ? "Random" : "Single"}</b>
      </footer>
    </button>
  );
}

function assetPlacementStyle(asset: ReikaArtAsset | null | undefined): CSSProperties {
  return placementStyle(readAssetPlacement(asset));
}

function placementStyle(placement: ReikaArtPlacement): CSSProperties {
  return artPlacementStyle(placement);
}

function GenerationStatusLine({ status, label }: { status?: ReikaArtGenerationStatus | { status: "waiting" | "running"; message: string; profileId: string; categoryId: string }; label?: string }) {
  const state = status?.status ?? "queued";
  const tone = state === "completed" ? "online" : state === "failed" || state === "blocked" ? "error" : state === "running" ? "thinking" : "connecting";
  return (
    <div className={cx("art-generation-status", state)}>
      <StatusDot status={tone} />
      <span>
        {label ? <strong>{label}</strong> : null}
        <small>{status?.message ?? "Waiting to be generated."}</small>
      </span>
    </div>
  );
}

function uniqueAgents(devices: Device[]): Agent[] {
  const seen = new Set<string>();
  const agents: Agent[] = [];
  for (const device of devices) {
    for (const provider of device.providers) {
      for (const agent of provider.agents) {
        const key = `${agent.characterId || agent.id || agent.name}`.toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        agents.push(agent);
      }
    }
  }
  return agents;
}

function artCategoryIcon(icon: string): ElementType {
  if (icon === "portrait" || icon === "avatar") return UserRound;
  if (icon === "banner" || icon === "splash") return Images;
  if (icon === "loading") return Activity;
  if (icon === "expressions") return Heart;
  if (icon === "room") return Monitor;
  if (icon === "chibi") return Gift;
  if (icon === "bell") return Bell;
  if (icon === "warning") return TriangleAlert;
  return Box;
}

function readableError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}
