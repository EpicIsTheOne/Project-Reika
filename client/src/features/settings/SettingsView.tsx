import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bell, Box, Brush, ChevronDown, ChevronRight, Code2, Globe2, Info, KeyRound, Monitor, Palette, Play, RefreshCw, Search, Shield, Users, Volume2 } from "lucide-react";
import { defaultReikaRelayDeviceUrl } from "../../config/relay";
import { getLocalAgentStartup, setLocalAgentStartup, type LocalAgentStartupStatus } from "../../data/startup";
import { assets } from "../../data/assets";
import { sendRelayVoice } from "../../data/relay";
import {
  applyUpdates,
  checkForUpdates,
  clearCache,
  connectArtOAuth,
  disconnectArtOAuth,
  getArtOAuthStatus,
  getCacheStatus,
  getSecurityStatus,
  getUpdateStatus,
  patchSettings,
  refreshProviders,
  type ReikaCacheStatus,
  type ReikaArtOAuthStatus,
  type ReikaSecurityStatus,
  type ReikaSettings,
  type ReikaProviderRecord,
  type ReikaStateResponse,
  type ReikaUpdateStatus
} from "../../lib/reikaApi";
import { artRerollSlot, makeArtRuntimeSeed, type ArtRuntime } from "../../lib/artRuntime";
import { cx, motionDelay, pageMotionClass } from "../../lib/motion";
import type { BackendMode } from "../../app/types";
import { StatusDot, StatusPill, Toggle } from "../../components/status";
import { agentVoiceContext, resolveAgentVoice, speechPlayback } from "../../lib/voicePlayback";

export function SettingsView({
  settings,
  backendMode,
  backendError,
  providers,
  artRuntime,
  onOpenDevices,
  onSettingsChange
}: {
  settings: ReikaSettings;
  backendMode: BackendMode;
  backendError: string | null;
  providers: ReikaProviderRecord[];
  artRuntime: ArtRuntime;
  onOpenDevices: () => void;
  onSettingsChange: (settings: ReikaSettings, state?: ReikaStateResponse) => void;
}) {
  const [activeTab, setActiveTab] = useState("General");
  const [busySetting, setBusySetting] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [startupStatus, setStartupStatus] = useState<LocalAgentStartupStatus | null>(null);
  const [startupBusy, setStartupBusy] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<ReikaUpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [cacheStatus, setCacheStatus] = useState<ReikaCacheStatus | null>(null);
  const [securityStatus, setSecurityStatus] = useState<ReikaSecurityStatus | null>(null);
  const [relayUrlDraft, setRelayUrlDraft] = useState(settings.relayUrl);
  const [artOauth, setArtOauth] = useState<ReikaArtOAuthStatus | null>(null);
  const [artApiKeyDraft, setArtApiKeyDraft] = useState("");
  const [fishKeyDraft, setFishKeyDraft] = useState("");
  const [fishStatus, setFishStatus] = useState<ReikaVoiceSecretStatus | null>(null);
  const [fishBusy, setFishBusy] = useState(false);
  const [openRouterKeyDraft, setOpenRouterKeyDraft] = useState("");
  const [openRouterStatus, setOpenRouterStatus] = useState<ReikaVoiceSecretStatus | null>(null);
  const [openRouterBusy, setOpenRouterBusy] = useState(false);
  const [agentMaintenanceBusy, setAgentMaintenanceBusy] = useState(false);
  const [agentSearch, setAgentSearch] = useState("");
  const [agentProviderFilter, setAgentProviderFilter] = useState("all");
  const artInstanceKey = useMemo(() => makeArtRuntimeSeed(), []);
  const settingsTabs = [
    { title: "General", detail: "Basic preferences", icon: Brush },
    { title: "Devices", detail: "Manage your devices", icon: Monitor },
    { title: "Providers", detail: "Manage providers", icon: Box },
    { title: "Agents", detail: "Voices, speech, calls", icon: Users },
    { title: "Secrets", detail: "Secure API keys", icon: KeyRound },
    { title: "Notifications", detail: "Choose alerts", icon: Bell },
    { title: "Appearance", detail: "Theme, colors, layout", icon: Palette },
    { title: "Developer", detail: "Logs, diagnostics, tools", icon: Code2 }
  ];
  const voiceAgents = useMemo(() => providers.flatMap((provider) => provider.agents.map((agent) => ({ provider, agent }))).filter(({ provider, agent }) => {
    if (agentProviderFilter !== "all" && provider.id !== agentProviderFilter) return false;
    const query = agentSearch.trim().toLowerCase();
    return !query || `${agent.name} ${agent.id} ${provider.name}`.toLowerCase().includes(query);
  }), [agentProviderFilter, agentSearch, providers]);

  useEffect(() => {
    let active = true;
    getLocalAgentStartup()
      .then((status) => {
        if (active) setStartupStatus(status);
      })
      .catch(() => undefined);
    getUpdateStatus()
      .then((status) => {
        if (active) setUpdateStatus(status);
      })
      .catch(() => undefined);
    getCacheStatus()
      .then((status) => {
        if (active) setCacheStatus(status);
      })
      .catch(() => undefined);
    getSecurityStatus()
      .then((status) => {
        if (active) setSecurityStatus(status);
      })
      .catch(() => undefined);
    getArtOAuthStatus()
      .then((status) => {
        if (active) setArtOauth(status.oauth);
      })
      .catch(() => undefined);
    window.reikaDesktop?.voice.secretStatus().then((status) => { if (active) setFishStatus(status); }).catch(() => undefined);
    window.reikaDesktop?.stt.secretStatus().then((status) => { if (active) setOpenRouterStatus(status); }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setRelayUrlDraft(settings.relayUrl);
  }, [settings.relayUrl]);

  const updateSetting = (key: keyof Omit<ReikaSettings, "version" | "updatedAt">, value: string | boolean | ReikaSettings["notificationPreferences"] | ReikaSettings["agentSelector"] | ReikaSettings["voice"]) => {
    setBusySetting(key);
    setSettingsError(null);
    patchSettings({ [key]: value } as Partial<Omit<ReikaSettings, "version" | "updatedAt">>)
      .then(({ settings, state }) => onSettingsChange(settings, state))
      .catch((error) => setSettingsError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusySetting(null));
  };

  const updateVoice = (voice: ReikaSettings["voice"]) => updateSetting("voice", voice);

  const runFishSecretAction = async (action: "save" | "test" | "remove") => {
    if (!window.reikaDesktop?.voice) {
      setSettingsError("Secure Fish Audio settings require the packaged Reika desktop app.");
      return;
    }
    setFishBusy(true);
    setSettingsError(null);
    try {
      const status = action === "save"
        ? await window.reikaDesktop.voice.saveSecret(fishKeyDraft.trim())
        : action === "test"
          ? await window.reikaDesktop.voice.testSecret()
          : await window.reikaDesktop.voice.removeSecret();
      setFishStatus(status);
      setFishKeyDraft("");
      setSettingsError(action === "remove" ? "Fish Audio key removed." : "Fish Audio connection validated.");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : String(error));
    } finally {
      setFishBusy(false);
    }
  };

  const runOpenRouterSecretAction = async (action: "save" | "test" | "remove") => {
    if (!window.reikaDesktop?.stt) {
      setSettingsError("Secure OpenRouter settings require the packaged Reika desktop app.");
      return;
    }
    setOpenRouterBusy(true);
    setSettingsError(null);
    try {
      const status = action === "save"
        ? await window.reikaDesktop.stt.saveSecret(openRouterKeyDraft.trim())
        : action === "test"
          ? await window.reikaDesktop.stt.testSecret()
          : await window.reikaDesktop.stt.removeSecret();
      setOpenRouterStatus(status);
      setOpenRouterKeyDraft("");
      setSettingsError(action === "remove" ? "OpenRouter key removed." : "OpenRouter connection validated.");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpenRouterBusy(false);
    }
  };

  const updateNotificationPreference = (key: keyof ReikaSettings["notificationPreferences"], value: boolean) => {
    updateSetting("notificationPreferences", {
      ...settings.notificationPreferences,
      [key]: value
    });
  };

  const updateAutomaticUpdates = (enabled: boolean) => {
    setBusySetting("automaticUpdates");
    setSettingsError(null);
    patchSettings({ autoUpdateServer: enabled, autoUpdateClient: enabled })
      .then(({ settings, state }) => onSettingsChange(settings, state))
      .catch((error) => setSettingsError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusySetting(null));
  };

  const updateAgentSelectorSetting = <Key extends keyof ReikaSettings["agentSelector"]>(key: Key, value: ReikaSettings["agentSelector"][Key]) => {
    updateSetting("agentSelector", {
      ...settings.agentSelector,
      [key]: value
    });
  };

  const saveRelayUrl = () => {
    const nextRelayUrl = relayUrlDraft.trim();
    if (!isValidRelayDeviceUrl(nextRelayUrl)) {
      setSettingsError("Relay URL must be a ws:// or wss:// URL ending in /v1/device.");
      return;
    }
    updateSetting("relayUrl", nextRelayUrl);
  };

  const toggleStartup = () => {
    setStartupBusy(true);
    setSettingsError(null);
    setLocalAgentStartup(!startupStatus?.enabled, { relayUrl: settings.relayUrl })
      .then((status) => setStartupStatus(status))
      .catch((error) => setSettingsError(error instanceof Error ? error.message : String(error)))
      .finally(() => setStartupBusy(false));
  };

  const runUpdateCheck = () => {
    setUpdateBusy(true);
    setSettingsError(null);
    checkForUpdates()
      .then((status) => setUpdateStatus(status))
      .catch((error) => setSettingsError(error instanceof Error ? error.message : String(error)))
      .finally(() => setUpdateBusy(false));
  };

  const runUpdateApply = () => {
    setUpdateBusy(true);
    setSettingsError(null);
    applyUpdates()
      .then((status) => setUpdateStatus(status))
      .catch((error) => setSettingsError(error instanceof Error ? error.message : String(error)))
      .finally(() => setUpdateBusy(false));
  };

  const runProviderRefresh = () => {
    setBusySetting("providerRefresh");
    setSettingsError(null);
    refreshProviders()
      .then((state) => {
        onSettingsChange(state.settings ?? settings, state);
        setSettingsError("Provider scan complete.");
      })
      .catch((error) => setSettingsError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusySetting(null));
  };

  const saveArtApiKey = () => {
    if (!artApiKeyDraft.trim()) return;
    setBusySetting("artOauth");
    setSettingsError(null);
    connectArtOAuth({ apiKey: artApiKeyDraft.trim() })
      .then((response) => {
        setArtOauth(response.oauth);
        setArtApiKeyDraft("");
        setSettingsError(response.message);
      })
      .catch((error) => setSettingsError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusySetting(null));
  };

  const clearArtApiKey = () => {
    setBusySetting("artOauth");
    setSettingsError(null);
    disconnectArtOAuth()
      .then((response) => {
        setArtOauth(response.oauth);
        setSettingsError(response.message);
      })
      .catch((error) => setSettingsError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusySetting(null));
  };

  const cycleTheme = () => {
    const order: ReikaSettings["theme"][] = ["dark", "blue", "contrast"];
    const next = order[(order.indexOf(settings.theme) + 1) % order.length] ?? "dark";
    updateSetting("theme", next);
  };

  const runCacheClear = () => {
    setBusySetting("cache");
    setSettingsError(null);
    clearCache()
      .then((status) => {
        setCacheStatus(status);
        setSettingsError("Transient local cache cleared. Persistent app data was preserved.");
      })
      .catch((error) => setSettingsError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusySetting(null));
  };

  const refreshSecurity = () => {
    setBusySetting("security");
    getSecurityStatus()
      .then(setSecurityStatus)
      .catch((error) => setSettingsError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusySetting(null));
  };

  const rebuildAndRestartAgent = async () => {
    if (!window.reikaDesktop?.agent) {
      setSettingsError("Agent rebuild and restart requires the packaged Reika desktop app.");
      return;
    }
    setAgentMaintenanceBusy(true);
    setSettingsError("Rebuilding the local agent. Reika may appear offline briefly.");
    try {
      const result = await window.reikaDesktop.agent.rebuildAndRestart();
      setSettingsError(`${result.message}${result.logPath ? ` Log: ${result.logPath}` : ""}`);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : String(error));
    } finally {
      setAgentMaintenanceBusy(false);
    }
  };

  const settingsScene = artRuntime.agentArt("reika", "portrait-chat", assets.reika.halfBody, artRerollSlot("settings-portrait", artInstanceKey));

  return (
    <main className={pageMotionClass("settings-screen")}>
      <aside className="settings-scene">
        <img src={settingsScene} alt="" />
        <div className="settings-scene-card">
          <h2>Settings</h2>
          <p>Make Reika truly yours.</p>
          <span />
        </div>
      </aside>

      <section className="settings-main">
        <header className="settings-header">
          <div>
            <h1>Settings</h1>
            <p>Customize your experience.</p>
          </div>
          <button className="secondary-action" type="button" onClick={() => setSettingsError("Reika is an operating system for AI agents. Version 0.1.0.")}>
            <Info size={18} />
            About Reika
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-tabs" aria-label="Settings sections">
            {settingsTabs.map((item, index) => {
              const Icon = item.icon;
              return (
                <button className={cx("settings-tab motion-row", activeTab === item.title && "active")} key={item.title} onClick={() => { setActiveTab(item.title); setSettingsError(null); }} style={motionDelay(index, 38)}>
                  <Icon size={26} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <ChevronRight size={20} />
                </button>
              );
            })}
          </nav>

          <section className="settings-panel">
            <h2>{activeTab}</h2>
            {settingsError ? <p className="boot-note">{settingsError}</p> : null}
            {activeTab === "General" ? (
              <>
                <SettingRow title="Language" detail="Saved preference only. App translations are not implemented yet.">
                  <button className="select-button" onClick={() => updateSetting("language", settings.language === "English" ? "Japanese" : "English")} disabled={busySetting === "language"}>
                    <Globe2 size={18} />
                    {settings.language}
                    <ChevronDown size={18} />
                  </button>
                </SettingRow>
                <SettingRow title="Startup Behavior" detail="Choose what happens when Reika launches.">
                  <button className="select-button" onClick={() => updateSetting("startupView", nextStartupView(settings.startupView))} disabled={busySetting === "startupView"}>
                    Open {labelView(settings.startupView)}
                    <ChevronDown size={18} />
                  </button>
                </SettingRow>
                <SettingRow title="Minimize to Tray" detail="Unavailable in this build; minimizing keeps the normal taskbar window.">
                  <Toggle checked={false} disabled onClick={() => undefined} />
                </SettingRow>
                <SettingRow title="Start On Sign In" detail={startupStatus?.message ?? (startupStatus?.enabled ? "Local agent starts with Windows/Linux sign-in." : "Local agent startup is disabled.")}>
                  <Toggle checked={Boolean(startupStatus?.enabled)} disabled={startupBusy || !startupStatus?.supported} onClick={toggleStartup} />
                </SettingRow>
              </>
            ) : null}
            {activeTab === "Providers" ? (
              <>
                <SettingRow title="Agent Selector Labels" detail="Controls how agents are named in Chat without changing routing.">
                  <button className="select-button" onClick={() => updateAgentSelectorSetting("labelMode", nextAgentSelectorLabelMode(settings.agentSelector.labelMode))} disabled={busySetting === "agentSelector"}>
                    {agentSelectorLabel(settings.agentSelector.labelMode)}
                    <ChevronDown size={18} />
                  </button>
                </SettingRow>
                <SettingRow title="Show Agent Roles" detail={settings.agentSelector.showRole ? "Agent names can include role suffixes like Astra / Mission Orchestrator." : "Agent names show the base name only."}>
                  <Toggle
                    checked={settings.agentSelector.showRole}
                    disabled={busySetting === "agentSelector"}
                    onClick={() => updateAgentSelectorSetting("showRole", !settings.agentSelector.showRole)}
                  />
                </SettingRow>
                <SettingRow title="Hide CommandCenter Duplicates" detail={settings.agentSelector.hideCommandCenterDuplicates ? "Same-name CommandCenter/native pairs on the same server collapse into one agent." : "All same-name provider entries are shown."}>
                  <Toggle
                    checked={settings.agentSelector.hideCommandCenterDuplicates}
                    disabled={busySetting === "agentSelector"}
                    onClick={() => updateAgentSelectorSetting("hideCommandCenterDuplicates", !settings.agentSelector.hideCommandCenterDuplicates)}
                  />
                </SettingRow>
                <SettingRow title="Duplicate Preference" detail={settings.agentSelector.hideCommandCenterDuplicates ? "Chooses which side wins when CommandCenter duplicates a native provider agent." : "Enable duplicate hiding to use this preference."}>
                  <button
                    className="select-button"
                    onClick={() => updateAgentSelectorSetting("duplicatePreference", settings.agentSelector.duplicatePreference === "agent" ? "commandcenter" : "agent")}
                    disabled={busySetting === "agentSelector" || !settings.agentSelector.hideCommandCenterDuplicates}
                  >
                    {settings.agentSelector.duplicatePreference === "agent" ? "Agent provider" : "CommandCenter"}
                    <ChevronDown size={18} />
                  </button>
                </SettingRow>
                <SettingRow title="Mock Provider" detail={settings.mockEnabled ? "Mock fallback is allowed across the app." : "Mock fallback is disabled across the app."}>
                  <Toggle checked={settings.mockEnabled} disabled={busySetting === "mockEnabled"} onClick={() => updateSetting("mockEnabled", !settings.mockEnabled)} />
                </SettingRow>
                <SettingRow title="Provider Refresh" detail={backendError ?? `Backend mode: ${backendMode}.`}>
                  <button className="secondary-action small" onClick={runProviderRefresh} disabled={Boolean(busySetting)}>Refresh</button>
                </SettingRow>
                <SettingRow title="Art Generation Key" detail={artOauth?.message ?? "Saved locally on the Reika server. The key is never echoed back to the client."}>
                  <div className="relay-url-control secret-control">
                    <KeyRound size={18} />
                    <input
                      value={artApiKeyDraft}
                      onChange={(event) => setArtApiKeyDraft(event.target.value)}
                      placeholder={artOauth?.connected ? `${authLabel(artOauth.source)} connected` : "OpenAI API key"}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button className="primary-action small" onClick={saveArtApiKey} disabled={busySetting === "artOauth" || !artApiKeyDraft.trim()}>
                      Save
                    </button>
                    <button className="secondary-action small" onClick={clearArtApiKey} disabled={busySetting === "artOauth"}>
                      Clear
                    </button>
                  </div>
                </SettingRow>
              </>
            ) : null}
            {activeTab === "Agents" ? (
              <>
                <SettingRow title="Speak agent replies in chat" detail="Speak finalized assistant messages. Per-agent choices below can override this setting.">
                  <Toggle checked={settings.voice.speakAgentReplies} disabled={busySetting === "voice"} onClick={() => updateVoice({ ...settings.voice, speakAgentReplies: !settings.voice.speakAgentReplies })} />
                </SettingRow>
                <SettingRow title="Global default voice" detail={`${settings.voice.defaultVoice.voiceLabel || "No voice selected"} · ${settings.voice.defaultVoice.provider}`}>
                  <button className="secondary-action small" type="button" onClick={() => updateVoice({ ...settings.voice, defaultVoice: { provider: "system", voiceId: "system-default", voiceLabel: "System default" } })}>Use system voice</button>
                </SettingRow>
                <div className="agent-voice-toolbar">
                  <label><Search size={16} /><input value={agentSearch} onChange={(event) => setAgentSearch(event.target.value)} placeholder="Search agents..." /></label>
                  <select value={agentProviderFilter} onChange={(event) => setAgentProviderFilter(event.target.value)}>
                    <option value="all">All providers</option>
                    {providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}
                  </select>
                </div>
                <div className="agent-voice-list">
                  {voiceAgents.length ? voiceAgents.map(({ provider, agent }) => (
                    <AgentVoiceCard key={`${provider.id}:${agent.id}`} provider={provider} agent={agent} settings={settings} relayUrl={settings.relayUrl} disabled={busySetting === "voice"} onUpdate={updateVoice} onNotice={setSettingsError} />
                  )) : <p className="boot-note">No agents match this search. Refresh providers if the device is offline.</p>}
                </div>
              </>
            ) : null}
            {activeTab === "Secrets" ? (
              <>
                <SettingRow title="Fish Audio API key" detail={fishStatus?.configured ? `Configured securely${fishStatus.lastValidatedAt ? ` · validated ${new Date(fishStatus.lastValidatedAt).toLocaleString()}` : ""}` : fishStatus?.secureStorageAvailable === false ? "Secure operating-system storage is unavailable." : "Not configured."}>
                  <div className="relay-url-control secret-control">
                    <KeyRound size={18} />
                    <input value={fishKeyDraft} onChange={(event) => setFishKeyDraft(event.target.value)} type="password" autoComplete="off" spellCheck={false} placeholder={fishStatus?.configured ? "Replace configured key" : "Fish Audio API key"} />
                    <button className="primary-action small" onClick={() => void runFishSecretAction("save")} disabled={fishBusy || !fishKeyDraft.trim()}>Save</button>
                    <button className="secondary-action small" onClick={() => void runFishSecretAction("test")} disabled={fishBusy || !fishStatus?.configured}>Test</button>
                    <button className="secondary-action small" onClick={() => void runFishSecretAction("remove")} disabled={fishBusy || !fishStatus?.configured}>Remove</button>
                  </div>
                </SettingRow>
                <SettingRow title="OpenRouter API key" detail={openRouterStatus?.configured ? `Configured securely${openRouterStatus.lastValidatedAt ? ` · validated ${new Date(openRouterStatus.lastValidatedAt).toLocaleString()}` : ""}` : openRouterStatus?.secureStorageAvailable === false ? "Secure operating-system storage is unavailable." : "Required for Whisper voice-call transcription."}>
                  <div className="relay-url-control secret-control">
                    <KeyRound size={18} />
                    <input value={openRouterKeyDraft} onChange={(event) => setOpenRouterKeyDraft(event.target.value)} type="password" autoComplete="off" spellCheck={false} placeholder={openRouterStatus?.configured ? "Replace configured key" : "OpenRouter API key"} />
                    <button className="primary-action small" onClick={() => void runOpenRouterSecretAction("save")} disabled={openRouterBusy || !openRouterKeyDraft.trim()}>Save</button>
                    <button className="secondary-action small" onClick={() => void runOpenRouterSecretAction("test")} disabled={openRouterBusy || !openRouterStatus?.configured}>Test</button>
                    <button className="secondary-action small" onClick={() => void runOpenRouterSecretAction("remove")} disabled={openRouterBusy || !openRouterStatus?.configured}>Remove</button>
                  </div>
                </SettingRow>
                <p className="boot-note">Keys are write-only from the renderer. Fish synthesis and OpenRouter Whisper transcription run inside Reika's trusted desktop process.</p>
              </>
            ) : null}
            {activeTab === "Devices" ? (
              <>
                <SettingRow title="Relay URL" detail="Used for app pairing, device WebSockets, Linux CLI commands, and startup registration.">
                  <div className="relay-url-control">
                    <input
                      value={relayUrlDraft}
                      onChange={(event) => setRelayUrlDraft(event.target.value)}
                      placeholder="wss://relay.example.com/v1/device"
                      spellCheck={false}
                    />
                    <button className="secondary-action small" onClick={() => setRelayUrlDraft(defaultReikaRelayDeviceUrl)} disabled={busySetting === "relayUrl"}>
                      Default
                    </button>
                    <button className="primary-action small" onClick={saveRelayUrl} disabled={busySetting === "relayUrl" || relayUrlDraft.trim() === settings.relayUrl}>
                      Save
                    </button>
                  </div>
                </SettingRow>
                <SettingRow title="Relay Pairing" detail="Use Devices to pair Windows or Linux agents safely through the relay.">
                  <button className="secondary-action small" onClick={onOpenDevices}>Open Devices</button>
                </SettingRow>
                <SettingRow title="Startup Agent" detail={startupStatus?.command ?? "No startup command registered."}>
                  <StatusPill status={startupStatus?.enabled ? "online" : "offline"} />
                </SettingRow>
              </>
            ) : null}
            {activeTab === "Notifications" ? (
              <>
                {notificationPreferenceRows.map((item) => (
                  <SettingRow title={item.title} detail={settings.notificationPreferences[item.key] ? item.onDetail : item.offDetail} key={item.key}>
                    <Toggle
                      checked={settings.notificationPreferences[item.key]}
                      disabled={busySetting === "notificationPreferences"}
                      onClick={() => updateNotificationPreference(item.key, !settings.notificationPreferences[item.key])}
                    />
                  </SettingRow>
                ))}
              </>
            ) : null}
            {activeTab === "Appearance" ? (
              <>
                <SettingRow title="Theme" detail="Theme is saved locally and applied immediately.">
                  <button className="select-button" onClick={cycleTheme} disabled={busySetting === "theme"}>
                    <Palette size={18} />
                    {themeLabel(settings.theme)}
                  </button>
                </SettingRow>
              </>
            ) : null}
            {activeTab === "Developer" ? (
              <>
                <SettingRow title="Diagnostics" detail="Show extra backend details while building Project Reika.">
                  <Toggle checked={settings.developerDiagnostics} disabled={busySetting === "developerDiagnostics"} onClick={() => updateSetting("developerDiagnostics", !settings.developerDiagnostics)} />
                </SettingRow>
                <SettingRow title="Local Agent Build" detail="Rebuild the agent from this Project Reika checkout, replace the bundled copy, and restart it. Reika may be offline briefly.">
                  <button className="primary-action small" type="button" onClick={() => void rebuildAndRestartAgent()} disabled={agentMaintenanceBusy}>
                    <RefreshCw size={16} className={agentMaintenanceBusy ? "spin" : undefined} />
                    {agentMaintenanceBusy ? "Rebuilding…" : "Rebuild & Restart"}
                  </button>
                </SettingRow>
                <SettingRow title="Automatic App Updates" detail={settings.autoUpdateServer && settings.autoUpdateClient ? "Reika and its bundled server can update together." : "Updates are checked and applied manually."}>
                  <Toggle checked={settings.autoUpdateServer && settings.autoUpdateClient} disabled={busySetting === "automaticUpdates"} onClick={() => updateAutomaticUpdates(!(settings.autoUpdateServer && settings.autoUpdateClient))} />
                </SettingRow>
                <UpdateStatusCard status={updateStatus} busy={updateBusy} onCheck={runUpdateCheck} onApply={runUpdateApply} />
                <SettingRow title="Data & Cache" detail={cacheStatus ? `${cacheStatus.cache.events.count} transient events. Chat, files, art, and settings are preserved.` : backendError ?? `Backend mode: ${backendMode}.`}>
                  <button className="secondary-action small" onClick={runCacheClear} disabled={busySetting === "cache"}>Clear Transient</button>
                </SettingRow>
                <button type="button" className="security-row" onClick={refreshSecurity}>
                  <Shield size={28} />
                  <span>
                    <strong>Security</strong>
                    <small>{securityStatus?.security.relayAuth ?? "Refresh local security/session status."}</small>
                  </span>
                  <ChevronRight size={20} />
                </button>
                {securityStatus ? (
                  <div className="update-status-card">
                    <header>
                      <span>
                        <strong>Local Sessions</strong>
                        <small>{securityStatus.security.activeSessions.length} recent chat sessions tracked locally.</small>
                      </span>
                      <StatusPill status={securityStatus.security.uplink?.connected ? "online" : "offline"} />
                    </header>
                    <div className="update-file-list">
                      {securityStatus.security.activeSessions.slice(0, 5).map((session) => (
                        <span key={session.id}>
                          <code>{session.providerId}</code>
                          {session.title}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </section>
        </div>

        <footer className="settings-footer">
          Reika v0.1.0
          <StatusDot status={updateStatus?.available ? "busy" : "online"} />
          {updateStatus?.available ? `${updateStatus.behindBy} GitHub update${updateStatus.behindBy === 1 ? "" : "s"} available` : "No GitHub update pending"}
        </footer>
      </section>
    </main>
  );
}

function AgentVoiceCard({ provider, agent, settings, relayUrl, disabled, onUpdate, onNotice }: {
  provider: ReikaProviderRecord;
  agent: ReikaProviderRecord["agents"][number];
  settings: ReikaSettings;
  relayUrl: string;
  disabled: boolean;
  onUpdate: (voice: ReikaSettings["voice"]) => void;
  onNotice: (message: string | null) => void;
}) {
  const context = agentVoiceContext(agent, provider.id);
  const resolved = resolveAgentVoice(context, settings);
  const preference = settings.voice.agents[context.key] ?? { spokenChat: "global" as const, callEnabled: true };
  const [voiceQuery, setVoiceQuery] = useState("");
  const [manualId, setManualId] = useState(preference.override?.voiceId ?? "");
  const [results, setResults] = useState<ReikaVoiceSearchItem[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const query = voiceQuery.trim();
    if (!query || !window.reikaDesktop?.voice) { setResults([]); return; }
    const timer = window.setTimeout(() => {
      setSearching(true);
      window.reikaDesktop?.voice.search(query)
        .then((response) => setResults(response.items))
        .catch((error) => onNotice(error instanceof Error ? error.message : String(error)))
        .finally(() => setSearching(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [voiceQuery]);

  const savePreference = (next: Partial<typeof preference>) => onUpdate({
    ...settings.voice,
    agents: { ...settings.voice.agents, [context.key]: { ...preference, ...next } }
  });
  const selectFishVoice = (voiceId: string, voiceLabel: string) => {
    setManualId(voiceId);
    savePreference({ override: { provider: "fish", voiceId, voiceLabel } });
  };
  const preview = async () => {
    const messageId = `preview:${context.key}`;
    try {
      const relayDeviceId = typeof provider.relayDeviceId === "string" ? provider.relayDeviceId : agent.deviceId;
      const remoteSynthesizer = resolved.transport === "commandcenter" && relayDeviceId
        ? async ({ requestId, text }: { requestId: string; text: string }) => sendRelayVoice(relayDeviceId, {
            providerId: provider.relayProviderId || provider.id,
            agent: agent.relayAgentId || agent.id,
            requestId,
            text
          }, relayUrl)
        : undefined;
      await speechPlayback.speak({ messageId, text: `Hello. This is ${agent.name}.`, voice: resolved, remoteSynthesizer, force: true });
      if (speechPlayback.snapshot().phase === "error") onNotice(speechPlayback.snapshot().error ?? "Voice preview failed.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <details className="agent-voice-card">
      <summary>
        <img src={assets.reika.avatar} alt="" />
        <span><strong>{agent.name}</strong><small>{agent.id} · {provider.name}</small></span>
        <span className={`voice-source ${resolved.available ? "available" : "unavailable"}`}>{resolved.source}</span>
      </summary>
      <div className="agent-voice-card-body">
        <dl>
          <div><dt>Active provider</dt><dd>{provider.name}</dd></div>
          <div><dt>Voice provider</dt><dd>{resolved.inheritedProvider ?? resolved.provider}</dd></div>
          <div><dt>Voice name</dt><dd>{resolved.voiceLabel}</dd></div>
          <div><dt>Voice ID</dt><dd><code>{resolved.voiceId}</code></dd></div>
          <div><dt>Source</dt><dd>{resolved.source}</dd></div>
          <div><dt>Availability</dt><dd>{resolved.available ? "Available" : `Unavailable; ${resolved.fallbackReason ?? "fallback will be used"}`}</dd></div>
        </dl>
        <div className="agent-voice-actions">
          <button type="button" className="secondary-action small" disabled={disabled || !resolved.available} onClick={() => void preview()}><Play size={15} />Preview</button>
          <button type="button" className="secondary-action small" disabled={disabled || !preference.override} onClick={() => savePreference({ override: undefined })}>Reset to provider default</button>
        </div>
        <label className="agent-voice-field"><span>Spoken chat</span><select value={preference.spokenChat} onChange={(event) => savePreference({ spokenChat: event.target.value as typeof preference.spokenChat })}><option value="global">Use global setting</option><option value="always">Always speak</option><option value="never">Never speak</option></select></label>
        <label className="agent-voice-field"><span>Calls</span><Toggle checked={preference.callEnabled} disabled={disabled} onClick={() => savePreference({ callEnabled: !preference.callEnabled })} /></label>
        <label className="agent-voice-field"><span>Find Fish Audio voice</span><input value={voiceQuery} onChange={(event) => setVoiceQuery(event.target.value)} placeholder="Search name or description..." /></label>
        {searching ? <p className="boot-note">Searching Fish Audio…</p> : null}
        {!searching && voiceQuery.trim() && !results.length ? <p className="boot-note">No Fish Audio voices found.</p> : null}
        {results.length ? <div className="fish-voice-results">{results.slice(0, 6).map((item) => <button type="button" key={item.id} onClick={() => selectFishVoice(item.id, item.title)}><span><strong>{item.title}</strong><small>{item.description || item.tags.join(" · ") || item.languages.join(" · ")}</small></span><code>{item.id}</code></button>)}</div> : null}
        <label className="agent-voice-field"><span>Manual Fish reference ID</span><div><input value={manualId} onChange={(event) => setManualId(event.target.value)} placeholder="Fish reference ID" /><button type="button" className="primary-action small" disabled={!manualId.trim()} onClick={() => selectFishVoice(manualId.trim(), "Manual Fish voice")}>Save</button></div></label>
      </div>
    </details>
  );
}

function SettingRow({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      {children}
    </div>
  );
}

function UpdateStatusCard({ status, busy, onCheck, onApply }: { status: ReikaUpdateStatus | null; busy: boolean; onCheck: () => void; onApply: () => void }) {
  const description = status?.descriptions[0];
  const files = status?.files ?? [];
  return (
    <div className="update-status-card">
      <header>
        <span>
          <strong>GitHub Updates</strong>
          <small>{status?.message ?? "Check the Project Reika GitHub repo for updates."}</small>
        </span>
        <StatusPill status={status?.available ? "busy" : status?.supported === false ? "offline" : "online"} />
      </header>
      {description ? (
        <div className="update-description">
          <strong>{description.title}</strong>
          {description.body ? <small>{description.body}</small> : null}
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className="update-file-list">
          {files.slice(0, 8).map((file) => (
            <span key={`${file.status}-${file.path}`}>
              <code>{file.status}</code>
              {file.path}
            </span>
          ))}
          {files.length > 8 ? <small>And {files.length - 8} more files.</small> : null}
        </div>
      ) : null}
      <div className="update-actions">
        <button className="secondary-action small" type="button" onClick={onCheck} disabled={busy}>
          Check
        </button>
        <button className="primary-action small" type="button" onClick={onApply} disabled={busy || !status?.available || status.supported === false}>
          Apply Update
        </button>
      </div>
    </div>
  );
}

const notificationPreferenceRows: Array<{
  key: keyof ReikaSettings["notificationPreferences"];
  title: string;
  onDetail: string;
  offDetail: string;
}> = [
  {
    key: "agent",
    title: "Agent Alerts",
    onDetail: "Agent status and roster notices can appear.",
    offDetail: "Agent status and roster notices are muted."
  },
  {
    key: "device",
    title: "Device Alerts",
    onDetail: "Pairing, relay, and device connection notices can appear.",
    offDetail: "Pairing, relay, and device connection notices are muted."
  },
  {
    key: "provider",
    title: "Provider Alerts",
    onDetail: "Provider refresh, active-provider, and history notices can appear.",
    offDetail: "Provider refresh and provider history notices are muted."
  },
  {
    key: "chat",
    title: "Chat Alerts",
    onDetail: "Completed chat responses can appear in Notifications.",
    offDetail: "Completed chat response notices are muted."
  },
  {
    key: "file",
    title: "File And Art Alerts",
    onDetail: "Upload, link, and art-file notices can appear.",
    offDetail: "Upload, link, and art-file notices are muted."
  },
  {
    key: "system",
    title: "System Alerts",
    onDetail: "Settings and Project Reika update notices can appear.",
    offDetail: "Settings and Project Reika update notices are muted."
  },
  {
    key: "warning",
    title: "Warnings",
    onDetail: "Failures, blocked generation, and important warnings can appear.",
    offDetail: "Warnings are muted. Use this carefully."
  }
];

function nextStartupView(view: ReikaSettings["startupView"]): ReikaSettings["startupView"] {
  const order: ReikaSettings["startupView"][] = ["home", "chat", "devices", "notifications", "settings"];
  const index = order.indexOf(view);
  return order[(index + 1) % order.length];
}

function labelView(view: ReikaSettings["startupView"]) {
  if (view === "home") return "Home";
  if (view === "chat") return "Chat";
  if (view === "devices") return "Devices";
  if (view === "notifications") return "Notifications";
  return "Settings";
}

function themeLabel(theme: ReikaSettings["theme"]) {
  if (theme === "blue") return "Electric Blue";
  if (theme === "contrast") return "High Contrast";
  return "Midnight";
}

function nextAgentSelectorLabelMode(mode: ReikaSettings["agentSelector"]["labelMode"]): ReikaSettings["agentSelector"]["labelMode"] {
  if (mode === "agent-provider") return "agent-only";
  if (mode === "agent-only") return "agent-device";
  return "agent-provider";
}

function agentSelectorLabel(mode: ReikaSettings["agentSelector"]["labelMode"]) {
  if (mode === "agent-only") return "Agent only";
  if (mode === "agent-device") return "Agent + device";
  return "Agent + provider";
}

function authLabel(source?: string) {
  if (source === "stored") return "Saved key";
  if (source === "env") return "Env key";
  if (source === "codex-auth") return "Codex key";
  if (source === "codex-oauth") return "Codex OAuth";
  return "No key";
}

function isValidRelayDeviceUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "ws:" || url.protocol === "wss:") && /\/v1\/device\/?$/u.test(url.pathname);
  } catch {
    return false;
  }
}
