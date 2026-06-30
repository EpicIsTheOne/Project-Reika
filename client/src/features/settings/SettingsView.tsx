import { useEffect, useState, type ReactNode } from "react";
import { Box, Brush, ChevronDown, ChevronRight, Code2, Globe2, Info, Monitor, Palette, Shield } from "lucide-react";
import { defaultReikaRelayDeviceUrl } from "../../config/relay";
import { getLocalAgentStartup, setLocalAgentStartup, type LocalAgentStartupStatus } from "../../data/startup";
import { assets } from "../../data/assets";
import {
  applyUpdates,
  checkForUpdates,
  getUpdateStatus,
  patchSettings,
  refreshProviders,
  type ReikaSettings,
  type ReikaStateResponse,
  type ReikaUpdateStatus
} from "../../lib/reikaApi";
import type { ArtRuntime } from "../../lib/artRuntime";
import { cx, motionDelay, pageMotionClass } from "../../lib/motion";
import type { BackendMode } from "../../app/types";
import { StatusDot, StatusPill, Toggle } from "../../components/status";

export function SettingsView({
  settings,
  backendMode,
  backendError,
  artRuntime,
  onOpenDevices,
  onSettingsChange
}: {
  settings: ReikaSettings;
  backendMode: BackendMode;
  backendError: string | null;
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
  const [relayUrlDraft, setRelayUrlDraft] = useState(settings.relayUrl);
  const settingsTabs = [
    { title: "General", detail: "Basic preferences", icon: Brush },
    { title: "Devices", detail: "Manage your devices", icon: Monitor },
    { title: "Providers", detail: "Manage providers", icon: Box },
    { title: "Appearance", detail: "Theme, colors, layout", icon: Palette },
    { title: "Developer", detail: "Logs, diagnostics, tools", icon: Code2 }
  ];

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
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setRelayUrlDraft(settings.relayUrl);
  }, [settings.relayUrl]);

  const updateSetting = (key: keyof Omit<ReikaSettings, "version" | "updatedAt">, value: string | boolean) => {
    setBusySetting(key);
    setSettingsError(null);
    patchSettings({ [key]: value } as Partial<Omit<ReikaSettings, "version" | "updatedAt">>)
      .then(({ settings, state }) => onSettingsChange(settings, state))
      .catch((error) => setSettingsError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusySetting(null));
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

  return (
    <main className={pageMotionClass("settings-screen")}>
      <aside className="settings-scene">
        <img src={artRuntime.agentArt("reika", "splash-full-body", artRuntime.agentArt("reika", "room-background", assets.reika.splash, "settings-room-fallback"), "settings-scene")} alt="" />
        <div className="settings-scene-card">
          <h2>Settings</h2>
          <p>Make AgentHub truly yours.</p>
          <span />
        </div>
      </aside>

      <section className="settings-main">
        <header className="settings-header">
          <div>
            <h1>Settings</h1>
            <p>Customize your experience.</p>
          </div>
          <button className="secondary-action" type="button" onClick={() => setSettingsError("AgentHub v0.1.0 local desktop client.")}>
            <Info size={18} />
            About AgentHub
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-tabs" aria-label="Settings sections">
            {settingsTabs.map((item, index) => {
              const Icon = item.icon;
              return (
                <button className={cx("settings-tab motion-row", activeTab === item.title && "active")} key={item.title} onClick={() => setActiveTab(item.title)} style={motionDelay(index, 38)}>
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
                <SettingRow title="Startup Behavior" detail="Choose what happens when AgentHub launches.">
                  <button className="select-button" onClick={() => updateSetting("startupView", nextStartupView(settings.startupView))} disabled={busySetting === "startupView"}>
                    Open {labelView(settings.startupView)}
                    <ChevronDown size={18} />
                  </button>
                </SettingRow>
                <SettingRow title="Minimize to Tray" detail="Keep AgentHub running in the background.">
                  <Toggle checked={settings.minimizeToTray} disabled={busySetting === "minimizeToTray"} onClick={() => updateSetting("minimizeToTray", !settings.minimizeToTray)} />
                </SettingRow>
                <SettingRow title="Start On Sign In" detail={startupStatus?.message ?? (startupStatus?.enabled ? "Local agent starts with Windows/Linux sign-in." : "Local agent startup is disabled.")}>
                  <Toggle checked={Boolean(startupStatus?.enabled)} disabled={startupBusy || !startupStatus?.supported} onClick={toggleStartup} />
                </SettingRow>
              </>
            ) : null}
            {activeTab === "Providers" ? (
              <>
                <SettingRow title="Mock Provider" detail={settings.mockEnabled ? "Mock fallback is allowed across the app." : "Mock fallback is disabled across the app."}>
                  <Toggle checked={settings.mockEnabled} disabled={busySetting === "mockEnabled"} onClick={() => updateSetting("mockEnabled", !settings.mockEnabled)} />
                </SettingRow>
                <SettingRow title="Provider Refresh" detail={backendError ?? `Backend mode: ${backendMode}.`}>
                  <button className="secondary-action small" onClick={runProviderRefresh} disabled={Boolean(busySetting)}>Refresh</button>
                </SettingRow>
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
            {activeTab === "Appearance" ? (
              <>
                <SettingRow title="Theme" detail="Dark AgentHub theme is active for Phase 1.">
                  <button className="select-button" disabled title="Theme switching is not implemented yet.">
                    <Palette size={18} />
                    Dark
                  </button>
                </SettingRow>
              </>
            ) : null}
            {activeTab === "Developer" ? (
              <>
                <SettingRow title="Diagnostics" detail="Show extra backend details while building Project Reika.">
                  <Toggle checked={settings.developerDiagnostics} disabled={busySetting === "developerDiagnostics"} onClick={() => updateSetting("developerDiagnostics", !settings.developerDiagnostics)} />
                </SettingRow>
                <SettingRow title="Server Auto Update" detail={settings.autoUpdateServer ? "Server updates can apply from the GitHub repo on startup." : "Server update checks are manual until enabled."}>
                  <Toggle checked={settings.autoUpdateServer} disabled={busySetting === "autoUpdateServer"} onClick={() => updateSetting("autoUpdateServer", !settings.autoUpdateServer)} />
                </SettingRow>
                <SettingRow title="Client Auto Update" detail={settings.autoUpdateClient ? "Client files can update from the GitHub repo on startup." : "Client update checks are manual until enabled."}>
                  <Toggle checked={settings.autoUpdateClient} disabled={busySetting === "autoUpdateClient"} onClick={() => updateSetting("autoUpdateClient", !settings.autoUpdateClient)} />
                </SettingRow>
                <UpdateStatusCard status={updateStatus} busy={updateBusy} onCheck={runUpdateCheck} onApply={runUpdateApply} />
                <SettingRow title="Data & Cache" detail={backendError ?? `Backend mode: ${backendMode}.`}>
                  <button className="secondary-action small" disabled title="Cache management endpoints are not available yet.">Manage</button>
                </SettingRow>
                <div className="security-row" aria-disabled="true">
                  <Shield size={28} />
                  <span>
                    <strong>Security</strong>
                    <small>Pairing-code approval only in Phase 1.</small>
                  </span>
                  <ChevronRight size={20} />
                </div>
              </>
            ) : null}
          </section>
        </div>

        <footer className="settings-footer">
          AgentHub v0.1.0
          <StatusDot status={updateStatus?.available ? "busy" : "online"} />
          {updateStatus?.available ? `${updateStatus.behindBy} GitHub update${updateStatus.behindBy === 1 ? "" : "s"} available` : "No GitHub update pending"}
        </footer>
      </section>
    </main>
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

function isValidRelayDeviceUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "ws:" || url.protocol === "wss:") && /\/v1\/device\/?$/u.test(url.pathname);
  } catch {
    return false;
  }
}
