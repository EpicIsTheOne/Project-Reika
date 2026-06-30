import { useEffect, useMemo, useState } from "react";
import { devices as demoDevices } from "../data/mockData";
import { getLocalAgentStartup } from "../data/startup";
import {
  getArtLibrary,
  getHealth,
  getSettings,
  getState,
  getUplink,
  listNotifications,
  refreshProviders,
  type ReikaArtLibraryResponse,
  type ReikaNotification,
  type ReikaSettings,
  type ReikaStateResponse
} from "../lib/reikaApi";
import { createArtRuntime, makeArtRuntimeSeed } from "../lib/artRuntime";
import type { Device, View } from "../types";
import { defaultSettings, emptyDevice } from "./constants";
import type { BackendMode, BootStep, BootStepState } from "./types";
import { AppShell } from "../components/AppShell";
import { createBootSteps } from "../features/boot/bootSteps";
import { LoadingScreen } from "../features/boot/LoadingScreen";
import { HomePage } from "../features/home/HomePage";
import { SettingsView } from "../features/settings/SettingsView";
import { NotificationsView } from "../features/notifications/NotificationsView";
import { DevicesView } from "../features/devices/DevicesView";
import { ChatView } from "../features/chat/ChatView";
import { AgentArtStudio } from "../features/art/AgentArtStudio";
import {
  buildPresentationDevices,
  getFallbackAgent,
  mapReikaStateToDevice
} from "../domain/reikaMappers";

export function App() {
  const [view, setView] = useState<View>("loading");
  const [selectedAgentId, setSelectedAgentId] = useState("reika");
  const [appDevices, setAppDevices] = useState<Device[]>([]);
  const [reikaState, setReikaState] = useState<ReikaStateResponse | null>(null);
  const [settings, setSettings] = useState<ReikaSettings>(defaultSettings);
  const [notifications, setNotifications] = useState<ReikaNotification[]>([]);
  const [artLibrary, setArtLibrary] = useState<ReikaArtLibraryResponse | null>(null);
  const [bootSteps, setBootSteps] = useState<BootStep[]>(() => createBootSteps());
  const [bootReady, setBootReady] = useState(false);
  const [backendMode, setBackendMode] = useState<BackendMode>("loading");
  const [backendError, setBackendError] = useState<string | null>(null);
  const [pairingOpenRequest, setPairingOpenRequest] = useState(0);
  const artSeed = useMemo(() => makeArtRuntimeSeed(), []);
  const artRuntime = useMemo(() => createArtRuntime(artLibrary, artSeed), [artLibrary, artSeed]);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    const markBootStep = (id: BootStep["id"], state: BootStepState, detail?: string) => {
      if (cancelled) return;
      setBootSteps((current) => current.map((step) => (step.id === id ? { ...step, state, detail } : step)));
    };

    const runBoot = async () => {
      setBackendMode("loading");
      setBackendError(null);
      markBootStep("health", "active");
      try {
        await getHealth();
        markBootStep("health", "done", "Server ready");
      } catch (error) {
        markBootStep("health", "error", "Server offline");
        throw error;
      }

      markBootStep("settings", "active");
      const settingsResponse = await getSettings();
      if (cancelled) return;
      setSettings(settingsResponse.settings);
      markBootStep("settings", "done", settingsResponse.settings.mockEnabled ? "Mock available" : "Mock disabled");

      markBootStep("art", "active");
      try {
        const artResponse = await getArtLibrary();
        if (!cancelled) setArtLibrary(artResponse);
        markBootStep("art", "done", `${artResponse.storage.assetCount} art assets`);
      } catch {
        markBootStep("art", "error", "Bundled art fallback");
      }

      markBootStep("state", "active");
      const state = await getState();
      if (cancelled) return;
      setReikaState(state);
      if (state.settings) setSettings(state.settings);
      setAppDevices([mapReikaStateToDevice(state)]);
      markBootStep("state", "done", `${state.providers.length} providers`);

      markBootStep("notifications", "active");
      try {
        const notificationResponse = await listNotifications({ limit: 100 });
        if (!cancelled) setNotifications(notificationResponse.notifications);
        markBootStep("notifications", "done", `${notificationResponse.storage.unreadCount} unread`);
      } catch (error) {
        markBootStep("notifications", "error", "Inbox unavailable");
      }

      markBootStep("uplink", "active");
      markBootStep("startup", "active");
      const [uplinkResult, startupResult] = await Promise.allSettled([getUplink(), getLocalAgentStartup()]);
      markBootStep("uplink", uplinkResult.status === "fulfilled" ? "done" : "error", uplinkResult.status === "fulfilled" ? String(uplinkResult.value.uplink.status ?? "Checked") : "Unavailable");
      markBootStep("startup", startupResult.status === "fulfilled" ? "done" : "error", startupResult.status === "fulfilled" ? (startupResult.value.enabled ? "Enabled" : "Disabled") : "Unavailable");

      markBootStep("relay", "active");
      try {
        const response = await fetch("/v1/health");
        markBootStep("relay", response.ok ? "done" : "error", response.ok ? "Relay ready" : "Relay offline");
      } catch {
        markBootStep("relay", "error", "Relay offline");
      }

      if (cancelled) return;
      setBackendMode("live");
      setBackendError(null);
      const wait = Math.max(0, 650 - (Date.now() - startedAt));
      window.setTimeout(() => {
        if (cancelled) return;
        setBootReady(true);
        setView((current) => (current === "loading" ? state.settings?.startupView ?? settingsResponse.settings.startupView : current));
      }, wait);
    };

    runBoot().catch((error) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      setBackendMode("fallback");
      setBackendError(message);
      setBootReady(true);
      setBootSteps((current) => current.map((step) => (step.state === "idle" || step.state === "active" ? { ...step, state: "error", detail: "Skipped" } : step)));
      setAppDevices(settings.mockEnabled ? demoDevices : [emptyDevice]);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (view === "loading") return;
    window.scrollTo({ top: 0, left: 0 });
  }, [view]);

  const presentationDevices = useMemo(() => buildPresentationDevices(appDevices), [appDevices]);

  const selectedAgent = useMemo(() => {
    for (const device of presentationDevices) {
      for (const provider of device.providers) {
        const agent = provider.agents.find((item) => item.id === selectedAgentId);
        if (agent) return agent;
      }
    }
    return getFallbackAgent(settings.mockEnabled);
  }, [presentationDevices, selectedAgentId, settings.mockEnabled]);

  const handleScanProviders = () => {
    refreshProviders()
      .then((state) => {
        setReikaState(state);
        setAppDevices([mapReikaStateToDevice(state)]);
        setBackendMode("live");
        setBackendError(null);
      })
      .catch((error) => {
        setBackendMode("fallback");
        setBackendError(error instanceof Error ? error.message : String(error));
      });
  };

  const unreadCount = notifications.filter((item) => item.unread).length;
  const loadingArtReady = artLibrary !== null || bootSteps.some((step) => step.id === "art" && step.state === "error");

  const refreshNotifications = () => {
    listNotifications({ limit: 100 })
      .then((response) => setNotifications(response.notifications))
      .catch(() => undefined);
  };

  if (view === "loading") {
    return (
      <div className="app-root">
        <LoadingScreen steps={bootSteps} ready={bootReady} mode={backendMode} error={backendError} artRuntime={artRuntime} artReady={loadingArtReady} onEnter={() => setView(settings.startupView)} />
      </div>
    );
  }

  return (
    <div className="app-root">
      <AppShell activeView={view} backendMode={backendMode} notificationCount={unreadCount} artRuntime={artRuntime} onNavigate={setView}>
        {view === "home" && (
          <HomePage
            devices={presentationDevices}
            backendMode={backendMode}
            artRuntime={artRuntime}
            onScanProviders={handleScanProviders}
            onOpenNotifications={() => setView("notifications")}
            onAddDevice={() => {
              setPairingOpenRequest((value) => value + 1);
              setView("devices");
            }}
            onOpenChat={(agentId) => {
              setSelectedAgentId(agentId);
              setView("chat");
            }}
          />
        )}
        {view === "chat" && <ChatView agent={selectedAgent} initialState={reikaState} artRuntime={artRuntime} onBack={() => setView("home")} />}
        {view === "devices" && <DevicesView localDevices={appDevices} pairingOpenRequest={pairingOpenRequest} developerDiagnostics={settings.developerDiagnostics} relayUrl={settings.relayUrl} artRuntime={artRuntime} onScanProviders={handleScanProviders} />}
        {view === "notifications" && (
          <NotificationsView
            notifications={notifications}
            artRuntime={artRuntime}
            onRefresh={refreshNotifications}
            onUpdateNotifications={setNotifications}
            onOpenChat={() => {
              setSelectedAgentId("reika");
              setView("chat");
            }}
          />
        )}
        {view === "agentArt" && <AgentArtStudio initialLibrary={artLibrary} artRuntime={artRuntime} onLibraryChange={setArtLibrary} />}
        {view === "settings" && (
          <SettingsView
            settings={settings}
            backendMode={backendMode}
            backendError={backendError}
            artRuntime={artRuntime}
            onOpenDevices={() => setView("devices")}
            onSettingsChange={(nextSettings, nextState) => {
              setSettings(nextSettings);
              if (nextState) {
                setReikaState(nextState);
                setAppDevices([mapReikaStateToDevice(nextState)]);
              }
              refreshNotifications();
            }}
          />
        )}
      </AppShell>
    </div>
  );
}
