import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, ElementType, FormEvent, ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  Bell,
  Bot,
  Box,
  Brush,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Crown,
  Cpu,
  Database,
  Gift,
  Globe2,
  Heart,
  Home,
  Info,
  Link2,
  LogOut,
  MessageCircle,
  Mic,
  Monitor,
  MoreHorizontal,
  Palette,
  Plus,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Terminal,
  Trash2,
  TriangleAlert,
  Sun,
  UserRound,
  Users
} from "lucide-react";
import { assets } from "./data/assets";
import { mapDevice } from "./data/api";
import {
  applyRelayEnvelope,
  approveRelayPairingCode,
  claimRelayPairingCode,
  connectRelayApp,
  createRelayPairingCode,
  type RelayDeviceRecord,
  type RelayPairing
} from "./data/relay";
import { linuxInstallCommand, reikaRelayDeviceUrl } from "./config/relay";
import { getLocalAgentStartup, setLocalAgentStartup, type LocalAgentStartupStatus } from "./data/startup";
import { chatMessages, devices as mockDevices, reikaProfile } from "./data/mockData";
import {
  chat,
  applyUpdates,
  checkForUpdates,
  createSession,
  deleteNotification,
  getHealth,
  getSessionMessages,
  getSettings,
  getState,
  getUpdateStatus,
  getUplink,
  linkFile,
  listNotifications,
  listSessions,
  markAllNotificationsRead,
  markNotificationRead,
  patchSettings,
  postSessionMessage,
  refreshProviders,
  searchSessions,
  uploadFiles,
  type ReikaChatMessage,
  type ReikaFileItem,
  type ReikaNotification,
  type ReikaProviderRecord,
  type ReikaSessionSummary,
  type ReikaSettings,
  type ReikaStateResponse,
  type ReikaUpdateStatus
} from "./lib/reikaApi";
import type { Agent, ChatMessage, Device, Provider, Status, View } from "./types";

const statusLabels: Record<Status, string> = {
  online: "Online",
  offline: "Offline",
  connecting: "Connecting",
  busy: "Busy",
  thinking: "Thinking",
  error: "Error",
  unknown: "Unknown"
};

type BackendMode = "loading" | "live" | "fallback";
type BootStepState = "idle" | "active" | "done" | "error";

interface BootStep {
  id: "health" | "settings" | "state" | "notifications" | "uplink" | "startup" | "relay";
  label: string;
  icon: ElementType;
  state: BootStepState;
  detail?: string;
}

const navItems = [
  { key: "home", route: "home" as const, label: "Home", icon: Home },
  { key: "chat", route: "chat" as const, label: "Chats", icon: MessageCircle },
  { key: "devices", route: "devices" as const, label: "Devices", icon: Monitor },
  { key: "notifications", route: "notifications" as const, label: "Notifications", icon: Bell },
  { key: "settings", route: "settings" as const, label: "Settings", icon: Settings }
];

const defaultSettings: ReikaSettings = {
  version: 1,
  language: "English",
  startupView: "home",
  minimizeToTray: true,
  mockEnabled: true,
  autoUpdateServer: false,
  autoUpdateClient: false,
  developerDiagnostics: false,
  updatedAt: new Date(0).toISOString()
};

const emptyDevice: Device = {
  id: "offline-local",
  name: "Local Agent Offline",
  type: "unknown",
  status: "offline",
  location: "Local",
  providers: []
};

export function App() {
  const [view, setView] = useState<View>("loading");
  const [selectedAgentId, setSelectedAgentId] = useState("reika");
  const [appDevices, setAppDevices] = useState<Device[]>(mockDevices);
  const [reikaState, setReikaState] = useState<ReikaStateResponse | null>(null);
  const [settings, setSettings] = useState<ReikaSettings>(defaultSettings);
  const [notifications, setNotifications] = useState<ReikaNotification[]>([]);
  const [bootSteps, setBootSteps] = useState<BootStep[]>(() => createBootSteps());
  const [bootReady, setBootReady] = useState(false);
  const [backendMode, setBackendMode] = useState<BackendMode>("loading");
  const [backendError, setBackendError] = useState<string | null>(null);
  const [pairingOpenRequest, setPairingOpenRequest] = useState(0);

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
      setAppDevices(settings.mockEnabled ? mockDevices : [emptyDevice]);
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
    return mockDevices[0].providers[0].agents[0];
  }, [presentationDevices, selectedAgentId]);

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

  const refreshNotifications = () => {
    listNotifications({ limit: 100 })
      .then((response) => setNotifications(response.notifications))
      .catch(() => undefined);
  };

  if (view === "loading") {
    return (
      <div className="app-root">
        <LoadingScreen steps={bootSteps} ready={bootReady} mode={backendMode} error={backendError} onEnter={() => setView(settings.startupView)} />
      </div>
    );
  }

  return (
    <div className="app-root">
      <AppShell activeView={view} backendMode={backendMode} notificationCount={unreadCount} onNavigate={setView}>
        {view === "home" && (
          <HomePage
            devices={presentationDevices}
            backendMode={backendMode}
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
        {view === "chat" && <ChatView agent={selectedAgent} initialState={reikaState} onBack={() => setView("home")} />}
        {view === "devices" && <DevicesView localDevices={appDevices} pairingOpenRequest={pairingOpenRequest} onScanProviders={handleScanProviders} />}
        {view === "notifications" && (
          <NotificationsView
            notifications={notifications}
            onRefresh={refreshNotifications}
            onUpdateNotifications={setNotifications}
            onOpenChat={() => {
              setSelectedAgentId("reika");
              setView("chat");
            }}
          />
        )}
        {view === "settings" && (
          <SettingsView
            settings={settings}
            backendMode={backendMode}
            backendError={backendError}
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

function LoadingScreen({
  steps,
  ready,
  mode,
  error,
  onEnter
}: {
  steps: BootStep[];
  ready: boolean;
  mode: BackendMode;
  error: string | null;
  onEnter: () => void;
}) {
  const doneCount = steps.filter((step) => step.state === "done").length;
  const completeCount = steps.filter((step) => step.state === "done" || step.state === "error").length;
  const progress = Math.max(8, Math.round((completeCount / Math.max(steps.length, 1)) * 100));
  const activeStep = steps.find((step) => step.state === "active") ?? [...steps].reverse().find((step) => step.state === "done") ?? steps[0];
  const systemStatus =
    mode === "fallback" ? "Fallback mode active" : mode === "live" ? "All systems nominal" : activeStep?.detail ?? "Scanning local providers";

  return (
    <main className="loading-screen">
      <img className="loading-bg" src={assets.loading.bootBackdrop} alt="" />
      <div className="loading-shade" />
      <div className="loading-grid" aria-hidden="true" />

      <aside className="loading-rail" aria-label="Boot sequence">
        <div className="loading-rail-brand">
          <strong>AGENTHUB</strong>
          <span>v0.1.0</span>
        </div>

        <ol className="boot-steps">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <li className={`boot-step ${step.state}`} key={step.label}>
                <span className="boot-step-icon">
                  <Icon size={20} />
                </span>
                <span>{step.label}</span>
              </li>
            );
          })}
        </ol>

        <div className="loading-system-status">
          <span>System Status</span>
          <strong>{systemStatus}</strong>
          <div className="status-wave" aria-hidden="true">
            <Activity size={42} />
          </div>
        </div>
      </aside>

      <section className="loading-stage">
        <div className="loading-emblem-shell" aria-hidden="true">
          <span />
          <span />
          <img src={assets.brand.logo} alt="" />
        </div>

        <div className="loading-title-block">
          <h1 aria-label="AgentHub">A G E N T H U B</h1>
          <p>Your AI Agents. One Hub.</p>
        </div>

        <div className="boot-progress" aria-label="Initializing secure connection">
          <div className="boot-progress-label">
            <span>{activeStep?.label ?? "Finalizing"}...</span>
            <strong>{progress}%</strong>
          </div>
          <div className="boot-progress-track">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>

        <figure className="boot-quote">
          <blockquote>Connecting minds. Building tomorrow.</blockquote>
          <figcaption>Astra</figcaption>
        </figure>

        {error ? <p className="boot-note">{error}</p> : <p className="boot-note">{doneCount} checks passed. {ready ? "Entering AgentHub." : "Still loading."}</p>}

        <button className="boot-enter" onClick={onEnter}>
          {ready ? "Enter AgentHub" : "Skip Boot"}
          <ChevronRight size={18} />
        </button>
      </section>

      <footer className="loading-footer">
        <span />
        <div>
          <Heart size={20} />
          <strong>Designed by Epic</strong>
        </div>
        <span />
      </footer>
    </main>
  );
}

function createBootSteps(): BootStep[] {
  return [
    { id: "health", label: "Initializing", icon: Activity, state: "idle" },
    { id: "settings", label: "Loading Settings", icon: Brush, state: "idle" },
    { id: "state", label: "Loading Agents", icon: Users, state: "idle" },
    { id: "notifications", label: "Syncing Notifications", icon: Bell, state: "idle" },
    { id: "uplink", label: "Checking Relay Uplink", icon: Link2, state: "idle" },
    { id: "startup", label: "Checking Startup", icon: ShieldCheck, state: "idle" },
    { id: "relay", label: "Finalizing", icon: CheckCircle2, state: "idle" }
  ];
}

function AppShell({
  activeView,
  backendMode,
  notificationCount,
  onNavigate,
  children
}: {
  activeView: View;
  backendMode: BackendMode;
  notificationCount: number;
  onNavigate: (view: View) => void;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <button className="brand-lockup" onClick={() => onNavigate("home")} aria-label="Go home">
          <img src={assets.brand.logoSmall} alt="" />
          <span>
            <strong>AGENTHUB</strong>
            <small>Your AI Agents. One Hub.</small>
          </span>
        </button>

        <nav className="nav-list" aria-label="Primary">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.route;
            return (
              <button className={active ? "nav-item active" : "nav-item"} key={item.label} aria-label={item.label} onClick={() => onNavigate(item.route)}>
                <Icon size={22} />
                <span>{item.label}</span>
                {item.route === "notifications" && notificationCount > 0 ? <strong>{notificationCount}</strong> : null}
              </button>
            );
          })}
        </nav>

        <div className="account-card">
          <img src={assets.reika.avatar} alt="" />
          <span>
            <strong>Epic</strong>
            <small>epic@agenthub.dev</small>
          </span>
          <button className="plan-button">
            <Crown size={14} />
            Pro Plan
          </button>
        </div>

        <div className="sidebar-tools">
          <button className="icon-button" aria-label="Light mode">
            <Sun size={20} />
          </button>
          <button className="icon-button" aria-label="Backend status">
            <StatusDot status={backendMode === "live" ? "online" : backendMode === "loading" ? "connecting" : "offline"} />
          </button>
          <button className="icon-button" aria-label="Sign out">
            <LogOut size={20} />
          </button>
        </div>
      </aside>

      <section className="page-shell">{children}</section>
    </div>
  );
}

function HomePage({
  devices,
  backendMode,
  onScanProviders,
  onOpenNotifications,
  onAddDevice,
  onOpenChat
}: {
  devices: Device[];
  backendMode: BackendMode;
  onScanProviders: () => void;
  onOpenNotifications: () => void;
  onAddDevice: () => void;
  onOpenChat: (agentId: string) => void;
}) {
  const onlineAgents = devices
    .flatMap((device) => device.providers.flatMap((provider) => provider.agents))
    .filter((agent) => agent.status === "online" || agent.status === "busy" || agent.status === "thinking").length;

  return (
    <main className="page home-page">
      <HeaderBar
        title={
          <>
            Welcome back, <span>Epic.</span>
          </>
        }
        subtitle={
          <>
            <StatusDot status={backendMode === "fallback" ? "offline" : "online"} />
            {backendMode === "fallback" ? "Mock fallback active" : "All systems operational"}
            <b>{onlineAgents} agents online</b>
          </>
        }
        action={<NotificationButton onClick={onOpenNotifications} />}
      />

      <section className="feature-hero">
        <img src={assets.room.hero} alt="" />
        <div className="feature-copy">
          <p className="eyebrow">Featured Agent</p>
          <h2>
            Reika
            <Heart size={28} fill="currentColor" />
          </h2>
          <p className="hero-quote">"Hehe~ You're back."</p>
          <p>Ready to get things done together?</p>
          <div className="hero-actions">
            <button className="primary-action" onClick={() => onOpenChat("reika")}>
              <MessageCircle size={20} />
              Chat Now
            </button>
            <button className="secondary-action">
              View Profile
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <div className="hero-dots" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="section-title-row">
        <h2>Your Devices</h2>
        <button className="secondary-action small" onClick={onAddDevice}>
          <Plus size={18} />
          Add Device
        </button>
      </section>

      <section className="device-grid">
        {devices.map((device) => (
          <DeviceCard device={device} key={device.id} onOpenChat={onOpenChat} />
        ))}
      </section>

      <footer className="app-footer">
        Your AI agents. Anywhere. Anytime.
        <Heart size={14} fill="currentColor" />
      </footer>
    </main>
  );
}

function HeaderBar({ title, subtitle, action }: { title: ReactNode; subtitle: ReactNode; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="header-actions">
        <label className="search-field">
          <Search size={22} />
          <input placeholder="Search agents, devices..." />
          <kbd>Ctrl</kbd>
          <kbd>K</kbd>
        </label>
        {action}
      </div>
    </header>
  );
}

function NotificationButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="notification-button" aria-label="Notifications" onClick={onClick}>
      <Bell size={22} />
      <span />
    </button>
  );
}

function DeviceCard({ device, onOpenChat }: { device: Device; onOpenChat: (agentId: string) => void }) {
  const Icon = device.type === "server" ? Box : device.type === "laptop" ? Monitor : Monitor;
  const agentCount = device.providers.reduce((total, provider) => total + provider.agents.length, 0);

  return (
    <article className="device-card">
      <header className="device-card-header">
        <Icon size={30} />
        <div>
          <h3>{device.name}</h3>
          <p>{device.type === "server" ? "Ubuntu 24.04 LTS" : device.type === "laptop" ? "Windows 11 Home" : "Windows 11 Pro"}</p>
        </div>
        <StatusPill status={device.status} />
      </header>

      <div className="provider-stack">
        {device.providers.map((provider) => (
          <ProviderBlock provider={provider} key={provider.id} onOpenChat={onOpenChat} />
        ))}
      </div>

      <footer className="device-card-footer">
        <span>{device.status === "online" ? "Last seen: now" : agentCount > 0 ? "Last seen: 1m ago" : "Last seen: 2 days ago"}</span>
        <MoreHorizontal size={18} />
      </footer>
    </article>
  );
}

function ProviderBlock({ provider, onOpenChat }: { provider: Provider; onOpenChat: (agentId: string) => void }) {
  return (
    <section className="provider-block">
      <header>
        <img src={assets.icons.providers[provider.name]} alt="" />
        <strong>{provider.name}</strong>
        <span>{provider.agents.length} {provider.agents.length === 1 ? "agent" : "agents"}</span>
      </header>
      <div className="provider-agents">
        {provider.agents.length > 0 ? (
          provider.agents.map((agent) => (
            <button className="agent-row" key={agent.id} onClick={() => onOpenChat(agent.id)}>
              <img src={getAgentAvatar(agent)} alt="" />
              <span>
                <strong>{agent.name}</strong>
                <small>
                  <StatusDot status={agent.status} />
                  {statusLabels[agent.status]}
                </small>
              </span>
              <ChevronRight size={18} />
            </button>
          ))
        ) : (
          <div className="empty-agent-row">No agents available</div>
        )}
      </div>
    </section>
  );
}

function ChatView({ agent, initialState, onBack }: { agent: Agent; initialState: ReikaStateResponse | null; onBack: () => void }) {
  const [serverState, setServerState] = useState<ReikaStateResponse | null>(initialState);
  const [providers, setProviders] = useState<ReikaProviderRecord[]>(initialState?.providers ?? []);
  const [selectedProviderId, setSelectedProviderId] = useState(initialState?.activeProviderId ?? "");
  const [selectedAgentKey, setSelectedAgentKey] = useState(agent.id);
  const [sessions, setSessions] = useState<ReikaSessionSummary[]>([]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<ReikaFileItem[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Connecting to Reika server...");
  const [stateError, setStateError] = useState<string | null>(null);
  const [sessionListError, setSessionListError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? providers.find((provider) => provider.status === "preferred") ?? providers[0],
    [providers, selectedProviderId]
  );
  const providerAgents = selectedProvider?.agents ?? [];
  const selectedProviderStatus = mapProviderStatus(selectedProvider?.status);
  const selectedLiveAgent = providerAgents.find((item) => item.id === selectedAgentKey || item.name === selectedAgentKey) ?? providerAgents[0];
  const headerAgentName = selectedLiveAgent?.name ?? agent.name;
  const providerLabel = selectedProvider?.name ?? "Reika Server";
  const deviceName = getReikaDeviceName(serverState) || "Epic PC";
  const selectedAttachments = files.filter((file) => selectedFileIds.includes(file.id));

  const normalizeChatError = (value: unknown, fallback = "Something went wrong.") => {
    const raw = value instanceof Error ? value.message : String(value || fallback);
    if (/^(fetch failed|failed to fetch)$/i.test(raw.trim())) return "Could not reach the local Reika server at `/agent`.";
    return raw || fallback;
  };

  const loadLiveState = async () => {
    try {
      const state = await getState();
      setServerState(state);
      setProviders(state.providers);
      setSelectedProviderId((current) => current || state.activeProviderId || state.providers[0]?.id || "");
      setStatus(`${state.providers.length} providers detected`);
      setStateError(null);
    } catch (loadError) {
      setStatus("Reika server offline");
      setStateError(normalizeChatError(loadError, "Could not reach the local Reika server at `/agent`."));
    }
  };

  const loadSessionRows = async (query = sessionSearch, providerId = selectedProvider?.id, agentId = selectedLiveAgent?.id) => {
    try {
      if (query.trim()) {
        const result = await searchSessions({ q: query.trim(), limit: 30, providerId, agent: agentId });
        setSessions(result.results);
      } else {
        const result = await listSessions({ limit: 30, providerId, agent: agentId });
        setSessions(result.sessions);
      }
      setSessionListError(null);
    } catch (loadError) {
      setSessionListError(normalizeChatError(loadError, "Could not load sessions."));
    }
  };

  useEffect(() => {
    void loadLiveState();
  }, []);

  useEffect(() => {
    if (!initialState) return;
    setServerState(initialState);
    setProviders(initialState.providers);
    setSelectedProviderId((current) => current || initialState.activeProviderId || initialState.providers[0]?.id || "");
  }, [initialState]);

  useEffect(() => {
    if (!selectedProvider) return;
    if (!providerAgents.some((item) => item.id === selectedAgentKey || item.name === selectedAgentKey)) {
      setSelectedAgentKey(providerAgents[0]?.id ?? "reika");
    }
  }, [providerAgents, selectedAgentKey, selectedProvider]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSessionRows();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [sessionSearch, selectedProvider?.id, selectedLiveAgent?.id]);

  useEffect(() => {
    if (!selectedSessionId) {
      setMessages([]);
      return;
    }
    getSessionMessages(selectedSessionId)
      .then((result) => {
        setMessages(result.messages.map(mapReikaMessage));
        setSendError(null);
      })
      .catch((loadError) => {
        setSendError(normalizeChatError(loadError, "Could not load that conversation."));
      });
  }, [selectedSessionId]);

  const handleRefreshProviders = async () => {
    setBusy(true);
    try {
      const state = await refreshProviders();
      setServerState(state);
      setProviders(state.providers);
      setSelectedProviderId(state.activeProviderId || state.providers[0]?.id || "");
      setStatus("Provider scan complete");
      setStateError(null);
      setSendError(null);
    } catch (refreshError) {
      setSendError(normalizeChatError(refreshError, "Provider refresh failed."));
    } finally {
      setBusy(false);
    }
  };

  const handleNewSession = async () => {
    if (!selectedProvider) return;
    setBusy(true);
    try {
      const created = await createSession({
        providerId: selectedProvider.id,
        agent: selectedLiveAgent?.id ?? selectedAgentKey,
        title: `${selectedLiveAgent?.name ?? headerAgentName} session`
      });
      setSelectedSessionId(created.session.id);
      setMessages([]);
      await loadSessionRows();
      setSendError(null);
    } catch (createError) {
      setSendError(normalizeChatError(createError, "Could not create a new session."));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setDraft("");
    setMessages((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        sender: "user",
        body: message,
        time: formatClock(new Date().toISOString())
      }
    ]);
    try {
      const result = selectedSessionId
        ? await postSessionMessage(selectedSessionId, { message, fileIds: selectedFileIds })
        : await chat({
            providerId: selectedProvider?.id,
            agent: selectedLiveAgent?.id ?? selectedAgentKey,
            message,
            fileIds: selectedFileIds
          });
      setSelectedSessionId(result.session.id);
      const refreshed = await getSessionMessages(result.session.id);
      setMessages(refreshed.messages.map(mapReikaMessage));
      await loadSessionRows("", selectedProvider?.id, selectedLiveAgent?.id);
      setStatus(`Routed through ${result.result.runtime}`);
      setFiles((current) => current.filter((file) => !selectedFileIds.includes(file.id)));
      setSelectedFileIds([]);
      setSendError(null);
    } catch (sendError) {
      setSendError(normalizeChatError(sendError, "Message failed."));
    } finally {
      setBusy(false);
    }
  };

  const handleAddLink = async () => {
    if (!linkUrl.trim() || busy) return;
    setBusy(true);
    try {
      const result = await linkFile({ url: linkUrl.trim(), name: linkName.trim() || undefined });
      setFiles((current) => [result.item, ...current.filter((item) => item.id !== result.item.id)]);
      setSelectedFileIds((current) => [...new Set([result.item.id, ...current])]);
      setLinkUrl("");
      setLinkName("");
      setSendError(null);
    } catch (linkError) {
      setSendError(normalizeChatError(linkError, "Could not attach that link."));
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const uploadList = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!uploadList.length || busy) return;
    setBusy(true);
    try {
      const result = await uploadFiles(uploadList);
      setFiles((current) => [...result.items, ...current.filter((item) => !result.items.some((next) => next.id === item.id))]);
      setSelectedFileIds((current) => [...new Set([...result.items.map((item) => item.id), ...current])]);
      setSendError(null);
    } catch (uploadError) {
      setSendError(normalizeChatError(uploadError, "Could not upload that file."));
    } finally {
      setBusy(false);
    }
  };

  const removeAttachment = (fileId: string) => {
    setSelectedFileIds((current) => current.filter((id) => id !== fileId));
    setFiles((current) => current.filter((file) => file.id !== fileId));
  };

  const visibleMessages = messages.length > 0 ? messages : sendError || stateError ? [] : chatMessages;
  const canSend = Boolean(draft.trim()) && !busy && Boolean(selectedProvider) && !stateError;

  return (
    <main className="chat-screen">
      <aside className="chat-profile">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={20} />
          Back
        </button>
        <img className="chat-profile-art" src={assets.reika.splash} alt="" />
        <div className="chat-profile-card live-chat-profile-card">
          <h2>
            {headerAgentName}
            <Heart size={24} fill="currentColor" />
          </h2>
          <p>{providerLabel} {"\u2022"} {deviceName}</p>
          <span>
            <StatusDot status={selectedProviderStatus} />
            {statusLabels[selectedProviderStatus]}
          </span>

          <div className="live-chat-card">
            <label>
              <span>Provider</span>
              <select value={selectedProvider?.id ?? ""} onChange={(event) => setSelectedProviderId(event.target.value)}>
                {providers.length > 0 ? (
                  providers.map((provider) => (
                    <option value={provider.id} key={provider.id}>
                      {provider.name} ({provider.status})
                    </option>
                  ))
                ) : (
                  <option value="">Server offline</option>
                )}
              </select>
            </label>
            <label>
              <span>Agent</span>
              <select value={selectedLiveAgent?.id ?? selectedAgentKey} onChange={(event) => setSelectedAgentKey(event.target.value)}>
                {providerAgents.length > 0 ? (
                  providerAgents.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name || item.label || item.id}
                    </option>
                  ))
                ) : (
                  <option value="reika">Reika</option>
                )}
              </select>
            </label>
            <div className="chat-session-tools">
              <button onClick={handleNewSession} disabled={!selectedProvider || busy}>
                <Plus size={16} />
                New
              </button>
              <button onClick={() => void handleRefreshProviders()} disabled={busy}>
                <Activity size={16} />
                Refresh
              </button>
            </div>
          </div>

          <div className="chat-session-card">
            <header>
              <strong>Sessions</strong>
              <small>{sessions.length}</small>
            </header>
            <label className="mini-search-field">
              <Search size={15} />
              <input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder="Search sessions..." />
            </label>
            <div className="chat-session-list">
              {sessionListError ? <small className="chat-inline-error">{sessionListError}</small> : null}
              {sessions.length > 0 ? (
                sessions.map((session) => (
                  <button
                    className={session.id === selectedSessionId ? "selected" : ""}
                    key={session.id}
                    onClick={() => setSelectedSessionId(session.id)}
                  >
                    <strong>{session.title}</strong>
                    <small>{session.lastMessagePreview || `${session.messageCount} messages`}</small>
                  </button>
                ))
              ) : (
                <small>No sessions yet</small>
              )}
            </div>
          </div>
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-header">
          <img src={assets.reika.avatar} alt="" />
          <div>
            <h1>
              {headerAgentName}
              <Heart size={26} fill="currentColor" />
            </h1>
            <p>
              {providerLabel} {"\u2022"} {deviceName}
              <StatusDot status={selectedProviderStatus} />
              {statusLabels[selectedProviderStatus]}
            </p>
          </div>
          <button className="icon-button" onClick={() => void handleRefreshProviders()} disabled={busy} aria-label="Refresh providers">
            <Activity size={22} />
          </button>
        </header>

        <section className="conversation-panel">
          <div className="day-divider">
            <span />
            {status}
            <span />
          </div>
          {stateError ? <div className="chat-error-banner">Reika server offline. {stateError}</div> : null}
          {sendError ? <div className="chat-error-banner">{sendError}</div> : null}
          <div className="message-list">
            {visibleMessages.map((message) => (
              <MessageBubble message={message} key={message.id} />
            ))}
            {busy ? (
              <div className="typing-row">
                <img src={assets.reika.avatar} alt="" />
                <span>{headerAgentName} is thinking</span>
                <i />
                <i />
                <i />
              </div>
            ) : null}
          </div>

          <form className="chat-composer" onSubmit={handleSubmit}>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Message ${headerAgentName}...`} />
            {selectedAttachments.length > 0 ? (
              <div className="selected-attachment-chips">
                {selectedAttachments.map((file) => (
                  <button type="button" className="attachment-chip" key={file.id} onClick={() => removeAttachment(file.id)}>
                    {file.kind === "link" ? <Link2 size={14} /> : <Plus size={14} />}
                    <span>{file.name}</span>
                    <Trash2 size={13} />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="composer-tools">
              <div className="composer-attachment-wrap">
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Attach file or link"
                  onClick={() => setAttachmentMenuOpen((current) => !current)}
                  disabled={busy || Boolean(stateError)}
                >
                  <Link2 size={21} />
                </button>
                {attachmentMenuOpen ? (
                  <div className="attachment-popover">
                    <label className="attachment-upload-button">
                      <Plus size={15} />
                      Upload File
                      <input type="file" multiple onChange={handleUpload} />
                    </label>
                    <div className="attachment-link-fields">
                      <input value={linkName} onChange={(event) => setLinkName(event.target.value)} placeholder="Name" />
                      <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://..." />
                      <button type="button" onClick={handleAddLink} disabled={!linkUrl.trim() || busy}>
                        <Link2 size={15} />
                        Add Link
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <button className="send-button" type="submit" aria-label="Send" disabled={!canSend}>
              <Send size={24} />
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}

function LegacyChatView({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  return (
    <main className="chat-screen">
      <aside className="chat-profile">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={20} />
          Back
        </button>
        <img className="chat-profile-art" src={assets.reika.splash} alt="" />
        <div className="chat-profile-card">
          <h2>
            Reika
            <Heart size={24} fill="currentColor" />
          </h2>
          <p>Hermes • Epic PC</p>
          <span>
            <StatusDot status="online" />
            Online
          </span>
          <div className="mood-card">
            <p>Current Mood</p>
            <strong>
              <Heart size={20} fill="currentColor" />
              Playful
            </strong>
            <button>Change</button>
          </div>
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-header">
          <img src={assets.reika.avatar} alt="" />
          <div>
            <h1>
              {agent.name}
              <Heart size={26} fill="currentColor" />
            </h1>
            <p>
              Hermes • Epic PC
              <StatusDot status={agent.status} />
              {statusLabels[agent.status]}
            </p>
          </div>
          <button className="secondary-action">
            <UserRound size={20} />
            Agent Profile
          </button>
          <button className="icon-button">
            <MoreHorizontal size={22} />
          </button>
        </header>

        <section className="conversation-panel">
          <div className="day-divider">
            <span />
            Today
            <span />
          </div>
          <div className="message-list">
            {chatMessages.map((message) => (
              <MessageBubble message={message} key={message.id} />
            ))}
            <div className="typing-row">
              <img src={assets.reika.avatar} alt="" />
              <span>Reika is typing</span>
              <i />
              <i />
              <i />
            </div>
          </div>

          <div className="chat-composer">
            <input placeholder="Message Reika..." />
            <div className="composer-tools">
              <button className="icon-button" aria-label="Add">
                <Plus size={22} />
              </button>
              <button className="icon-button" aria-label="Gift">
                <Gift size={20} />
              </button>
            </div>
            <button className="icon-button mic-button" aria-label="Voice">
              <Mic size={22} />
            </button>
            <button className="send-button" aria-label="Send">
              <Send size={24} />
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.sender === "system") return null;
  const isUser = message.sender === "user";

  return (
    <article className={isUser ? "chat-message user" : "chat-message agent"}>
      {!isUser ? <img src={assets.reika.avatar} alt="" /> : null}
      <div className="message-content">
        {!isUser ? (
          <header>
            <strong>Reika</strong>
            <time>{message.time}</time>
          </header>
        ) : null}
        <p>{message.body}</p>
        {!isUser ? (
          <button className="reaction-pill" aria-label="Heart reaction">
            <Heart size={14} fill="currentColor" />
          </button>
        ) : (
          <time>{message.time}</time>
        )}
      </div>
    </article>
  );
}

type DevicePageRow = {
  id: string;
  name: string;
  icon: string;
  typeLabel: string;
  system: string;
  connection: string;
  status: Status;
  statusLabel?: string;
  tag?: string;
  tagTone?: "blue" | "green" | "purple" | "orange" | "gray";
  metrics?: { cpu: number; ram: number; disk: number };
  provider: Provider["name"];
  providers?: Provider[];
  agents?: Agent[];
  activeProviderId?: string;
  lastCommand?: string;
  lastConnected: string;
  localIp: string;
  version: string;
  relayUrl?: string;
  startupDeviceId?: string;
};

const deviceRows: DevicePageRow[] = [
  {
    id: "epic-pc",
    name: "Epic PC",
    icon: assets.icons.devices.pc,
    typeLabel: "This Device",
    system: "Windows 11 Pro",
    connection: "Local Connection",
    status: "online",
    tag: "This Device",
    tagTone: "blue",
    metrics: { cpu: 18, ram: 32, disk: 41 },
    provider: "Hermes",
    lastConnected: "Just now",
    localIp: "192.168.1.42",
    version: "v1.0.0"
  },
  {
    id: "hostinger-vps",
    name: "Hostinger VPS",
    icon: assets.icons.devices.server,
    typeLabel: "Server",
    system: "Ubuntu 24.04 LTS",
    connection: "hermes.agenthub.dev",
    status: "online",
    tag: "Server",
    tagTone: "purple",
    metrics: { cpu: 22, ram: 28, disk: 36 },
    provider: "OpenClaw",
    lastConnected: "1m ago",
    localIp: "10.8.0.12",
    version: "v1.0.0"
  },
  {
    id: "epic-laptop",
    name: "Epic Laptop",
    icon: assets.icons.devices.laptop,
    typeLabel: "Laptop",
    system: "Windows 11 Home",
    connection: "Last seen 2h ago",
    status: "busy",
    statusLabel: "Idle",
    metrics: { cpu: 8, ram: 21, disk: 17 },
    provider: "Hermes",
    lastConnected: "2h ago",
    localIp: "192.168.1.68",
    version: "v0.9.8"
  },
  {
    id: "epic-phone",
    name: "Epic Phone (Future)",
    icon: assets.icons.devices.phone,
    typeLabel: "Phone",
    system: "iOS 17.5",
    connection: "Last seen 1d ago",
    status: "offline",
    provider: "Hermes",
    lastConnected: "1d ago",
    localIp: "Not paired",
    version: "-"
  },
  {
    id: "old-test-server",
    name: "Old Test Server",
    icon: assets.icons.devices.server,
    typeLabel: "Server",
    system: "Ubuntu 22.04 LTS",
    connection: "test.agenthub.dev",
    status: "error",
    statusLabel: "Connection Error",
    provider: "OpenClaw",
    lastConnected: "5d ago",
    localIp: "10.8.0.44",
    version: "v0.8.2"
  }
];

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  time: string;
  detailTime: string;
  tag: string;
  tagTone: "blue" | "green" | "purple" | "orange" | "gray";
  avatar?: string;
  icon?: string;
  providerIcon?: string;
  accent: "blue" | "green" | "purple" | "orange" | "red" | "pink";
  badge?: "check" | "warning" | "heart" | "spark";
  unread?: boolean;
};

const notificationItems: NotificationItem[] = [
  {
    id: "reika-online",
    title: "Reika is now online",
    body: "Reika has come online and is ready to assist you.",
    time: "2m ago",
    detailTime: "Today at 10:24 AM",
    tag: "Reika",
    tagTone: "blue",
    avatar: assets.reika.avatar,
    accent: "blue",
    unread: true
  },
  {
    id: "epic-pc-online",
    title: "Epic PC is back online",
    body: "Your device reconnected successfully.",
    time: "8m ago",
    detailTime: "Today at 10:18 AM",
    tag: "Device",
    tagTone: "green",
    icon: assets.icons.devices.pc,
    accent: "green",
    badge: "check",
    unread: true
  },
  {
    id: "openclaw-sync",
    title: "OpenClaw sync completed",
    body: "2 agents synced and configuration updated.",
    time: "15m ago",
    detailTime: "Today at 10:11 AM",
    tag: "OpenClaw",
    tagTone: "purple",
    providerIcon: assets.icons.providers.OpenClaw,
    accent: "purple",
    unread: true
  },
  {
    id: "memory-added",
    title: "New memory added",
    body: "\"UNBEATABLE stream plans\" was saved to memory.",
    time: "1h ago",
    detailTime: "Today at 9:24 AM",
    tag: "Reika",
    tagTone: "blue",
    avatar: assets.reika.expressions.happy,
    accent: "blue",
    badge: "spark"
  },
  {
    id: "cpu-warning",
    title: "Hostinger VPS high CPU usage",
    body: "CPU usage is above 85% for the last 10 minutes.",
    time: "2h ago",
    detailTime: "Today at 8:24 AM",
    tag: "Device",
    tagTone: "orange",
    icon: assets.icons.devices.server,
    accent: "orange",
    badge: "warning"
  },
  {
    id: "hermes-stable",
    title: "Hermes connection stable",
    body: "Hermes provider health check passed.",
    time: "3h ago",
    detailTime: "Today at 7:24 AM",
    tag: "Hermes",
    tagTone: "gray",
    providerIcon: assets.icons.providers.Hermes,
    accent: "green",
    badge: "check"
  },
  {
    id: "reika-message",
    title: "Reika sent you a message",
    body: "\"Hey Epic, ready to get to work?\"",
    time: "5h ago",
    detailTime: "Today at 5:24 AM",
    tag: "Reika",
    tagTone: "blue",
    avatar: assets.reika.avatar,
    accent: "pink",
    badge: "heart"
  }
];

function DevicesView({ localDevices, pairingOpenRequest, onScanProviders }: { localDevices: Device[]; pairingOpenRequest: number; onScanProviders: () => void }) {
  const [selectedId, setSelectedId] = useState("epic-pc");
  const [filterOpen, setFilterOpen] = useState(false);
  const [relayStatus, setRelayStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [relayDevices, setRelayDevices] = useState<RelayDeviceRecord[]>([]);
  const [relayPairing, setRelayPairing] = useState<RelayPairing | null>(null);
  const [claimedDeviceName, setClaimedDeviceName] = useState<string | null>(null);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [relaySend, setRelaySend] = useState<ReturnType<typeof connectRelayApp>["send"] | null>(null);
  const relayRows = useMemo(() => relayDevices.map(mapRelayDeviceRecord), [relayDevices]);
  const localRows = useMemo(() => localDevices.map(mapLocalDeviceRecord), [localDevices]);
  const displayRows = relayRows.length > 0 ? relayRows : localRows.length > 0 ? localRows : deviceRows;
  const deviceSourceLabel =
    relayRows.length > 0
      ? `${relayRows.length} paired ${relayRows.length === 1 ? "device" : "devices"}`
      : localRows.length > 0
        ? "Local server device"
        : "Local preview fallback";
  const selectedDevice = displayRows.find((device) => device.id === selectedId) ?? displayRows[0];
  const onlineCount = displayRows.filter((device) => device.status === "online").length;
  const idleCount = displayRows.filter((device) => device.status === "busy" || device.statusLabel === "Idle").length;
  const offlineCount = displayRows.filter((device) => device.status === "offline").length;
  const issueCount = displayRows.filter((device) => device.status === "error").length;
  const stats = [
    { label: "Total Devices", value: displayRows.length, tone: "blue", icon: Monitor },
    { label: "Online", value: onlineCount, tone: "green", dot: true },
    { label: "Idle", value: idleCount, tone: "yellow", dot: true },
    { label: "Offline", value: offlineCount, tone: "muted", dot: true },
    { label: "Issues", value: issueCount, tone: "red", dot: true }
  ];

  useEffect(() => {
    const relay = connectRelayApp(
      (envelope) => {
        setRelayDevices((current) => {
          const next = applyRelayEnvelope(current, envelope);
          if (next.length > 0) setSelectedId((currentId) => (next.some((record) => record.device.id === currentId) ? currentId : next[0].device.id));
          return next;
        });
      },
      (status) => setRelayStatus(status)
    );
    setRelaySend(() => relay.send);
    return () => relay.close();
  }, []);

  const handleCreatePairing = () => {
    createRelayPairingCode()
      .then((pairing) => {
        setRelayPairing(pairing);
        setClaimedDeviceName(null);
        setRelayError(null);
      })
      .catch((error) => {
        setRelayError(error instanceof Error ? error.message : String(error));
      });
  };

  useEffect(() => {
    if (pairingOpenRequest > 0) handleCreatePairing();
  }, [pairingOpenRequest]);

  const handleApprovePairing = () => {
    if (!relayPairing) return;
    approveRelayPairingCode(relayPairing.code)
      .then(({ pairing, device }) => {
        setRelayPairing(pairing);
        setClaimedDeviceName(device?.name ?? claimedDeviceName);
        setRelayError(null);
      })
      .catch((error) => {
        setRelayError(error instanceof Error ? error.message : String(error));
      });
  };

  const handleDevClaimPairing = () => {
    if (!relayPairing) return;
    claimRelayPairingCode(relayPairing.code, {
      name: "Windows Agent Preview",
      type: "pc",
      location: "local",
      agentVersion: "dev-ui-preview",
      fingerprint: `dev-ui-preview-${relayPairing.code}`
    })
      .then(({ pairing, device }) => {
        setRelayPairing(pairing);
        setClaimedDeviceName(device?.name ?? null);
        setRelayError(null);
      })
      .catch((error) => {
        setRelayError(error instanceof Error ? error.message : String(error));
      });
  };

  const handleRelayRequest = (type: "device.state.request" | "provider.refresh.request" | "agent.roster.request") => {
    if (!selectedDevice || !relaySend) return;
    const sent = relaySend(type, selectedDevice.id);
    if (!sent) setRelayError("Relay app socket is not connected.");
    else setRelayError(null);
  };

  return (
    <main className="page devices-page">
      <header className="workbench-header">
        <div className="workbench-title">
          <Monitor size={30} />
          <span>
            <h1>Devices</h1>
            <p>
              Relay {statusLabels[relayStatus]}
              {" \u2022 "}
              {deviceSourceLabel}
            </p>
          </span>
        </div>
        <div className="workbench-actions">
          <label className="search-field compact">
            <input placeholder="Search devices..." />
            <Search size={18} />
          </label>
          <button className={filterOpen ? "secondary-action small selected" : "secondary-action small"} onClick={() => setFilterOpen((open) => !open)}>
            <FilterIcon />
            Filter
          </button>
          <button className="secondary-action small" onClick={onScanProviders}>
            <Activity size={18} />
            Scan Local
          </button>
          <button className="primary-action small" onClick={handleCreatePairing}>
            <Plus size={18} />
            Pair Device
          </button>
        </div>
      </header>

      {relayPairing || relayError ? (
        <PairingPanel
          pairing={relayPairing}
          claimedDeviceName={claimedDeviceName}
          error={relayError}
          relayUrl={reikaRelayDeviceUrl}
          onCreate={handleCreatePairing}
          onDevClaim={handleDevClaimPairing}
          onApprove={handleApprovePairing}
        />
      ) : null}

      <div className="devices-layout">
        <section className="devices-left">
          <div className="device-stats-panel">
            {stats.map((stat) => {
              const Icon = stat.icon;
              return (
                <article className="device-stat" key={stat.label}>
                  {Icon ? <Icon size={28} /> : <StatusDot status={stat.tone === "green" ? "online" : stat.tone === "red" ? "error" : stat.tone === "yellow" ? "busy" : "offline"} />}
                  <span>
                    <strong>{stat.value}</strong>
                    <small>{stat.label}</small>
                  </span>
                </article>
              );
            })}
          </div>

          <section className="device-list-panel" aria-label="Devices">
            {displayRows.map((device) => (
              <button
                className={device.id === selectedId ? "device-list-row selected" : `device-list-row status-row-${device.status}`}
                key={device.id}
                onClick={() => setSelectedId(device.id)}
              >
                <span className="device-list-icon">
                  <img src={device.icon} alt="" />
                </span>
                <span className="device-list-copy">
                  <strong>
                    {device.name}
                    {device.tag ? <b className={`mini-tag ${device.tagTone ?? "blue"}`}>{device.tag}</b> : null}
                  </strong>
                  <small>
                    {device.system}
                    <i />
                    {device.connection}
                  </small>
                  <em className={`device-state-text status-${device.status}`}>
                    <StatusDot status={device.status} />
                    {device.statusLabel ?? statusLabels[device.status]}
                  </em>
                </span>
                <DeviceMetricStack metrics={device.metrics} />
                <ChevronRight size={22} />
              </button>
            ))}
            <footer className="device-list-footer">Showing {displayRows.length} of {displayRows.length} devices</footer>
          </section>
        </section>

        <DeviceDetailPanel device={selectedDevice} relayConnected={relayStatus === "online"} onRelayRequest={handleRelayRequest} />
      </div>
    </main>
  );
}

function FilterIcon() {
  return (
    <span className="filter-icon" aria-hidden="true">
      <ChevronDown size={16} />
    </span>
  );
}

function PairingPanel({
  pairing,
  claimedDeviceName,
  error,
  relayUrl,
  onCreate,
  onDevClaim,
  onApprove
}: {
  pairing: RelayPairing | null;
  claimedDeviceName: string | null;
  error: string | null;
  relayUrl: string;
  onCreate: () => void;
  onDevClaim: () => void;
  onApprove: () => void;
}) {
  const linuxCommand = pairing ? linuxInstallCommand(pairing.code) : "";
  const canApprove = pairing?.status === "claimed";

  const copyLinuxCommand = () => {
    if (!linuxCommand || !navigator.clipboard) return;
    void navigator.clipboard.writeText(linuxCommand);
  };

  return (
    <section className="relay-pairing-panel">
      <div className="relay-pairing-header">
        <span>
          <Link2 size={20} />
          Pair New Device
        </span>
        <button className="secondary-action small" onClick={onCreate}>
          <Plus size={18} />
          New Code
        </button>
      </div>

      {pairing ? (
        <div className="relay-pairing-grid">
          <article>
            <small>Pairing Code</small>
            <strong>{pairing.code}</strong>
          </article>
          <article>
            <small>Status</small>
            <strong>{pairing.status}</strong>
          </article>
          <article>
            <small>Claimed Device</small>
            <strong>{claimedDeviceName ?? pairing.deviceId ?? "Waiting for device"}</strong>
          </article>
          <article>
            <small>Relay URL</small>
            <strong>{relayUrl}</strong>
          </article>
        </div>
      ) : null}

      {pairing ? (
        <div className="relay-pairing-instructions">
          <div>
            <h3>Linux CLI</h3>
            <code>{linuxCommand}</code>
            <button className="secondary-action small" onClick={copyLinuxCommand}>
              <Terminal size={18} />
              Copy Command
            </button>
          </div>
          <div>
            <h3>Windows Agent</h3>
            <p>Run `reika-agent-server.exe`, paste this code into the local pairing UI, then approve the claimed device here.</p>
            <button className="secondary-action small" onClick={onDevClaim}>
              <Monitor size={18} />
              Test Claim
            </button>
          </div>
        </div>
      ) : null}

      <div className="relay-pairing-actions">
        <button className="primary-action small" disabled={!canApprove} onClick={onApprove}>
          <Check size={18} />
          Approve Claimed Device
        </button>
        {error ? <em>{error}</em> : null}
      </div>
    </section>
  );
}

function DeviceMetricStack({ metrics }: { metrics?: DevicePageRow["metrics"] }) {
  const metricRows = metrics
    ? [
        ["CPU", metrics.cpu],
        ["RAM", metrics.ram],
        ["Disk", metrics.disk]
      ]
    : [
        ["-", undefined],
        ["-", undefined],
        ["-", undefined]
      ];

  return (
    <span className="device-metrics">
      {metricRows.map(([label, value], index) => (
        <span className="metric-row" key={`${label}-${index}`}>
          <small>{label}</small>
          <b>{typeof value === "number" ? `${value}%` : "-"}</b>
          <i>
            {typeof value === "number" ? <em style={{ width: `${value}%` }} /> : null}
          </i>
        </span>
      ))}
    </span>
  );
}

function DeviceDetailPanel({
  device,
  relayConnected,
  onRelayRequest
}: {
  device: DevicePageRow;
  relayConnected: boolean;
  onRelayRequest: (type: "device.state.request" | "provider.refresh.request" | "agent.roster.request") => void;
}) {
  const [startupStatus, setStartupStatus] = useState<LocalAgentStartupStatus | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupBusy, setStartupBusy] = useState(false);
  const canManageStartup = Boolean(device.relayUrl && device.startupDeviceId);
  const startupEnabledForDevice = Boolean(startupStatus?.enabled && startupMatchesDevice(startupStatus, device));

  useEffect(() => {
    let active = true;
    setStartupStatus(null);
    setStartupError(null);

    if (!canManageStartup) return () => {
      active = false;
    };

    getLocalAgentStartup()
      .then((status) => {
        if (!active) return;
        setStartupStatus(status);
      })
      .catch(() => {
        if (!active) return;
        setStartupError("Selected device agent is not reachable.");
      });

    return () => {
      active = false;
    };
  }, [canManageStartup, device.id]);

  const updateStartup = async () => {
    if (!startupStatus?.supported || startupBusy || !device.relayUrl || !device.startupDeviceId) return;
    setStartupBusy(true);
    setStartupError(null);
    try {
      const next = await setLocalAgentStartup(!startupEnabledForDevice, {
        relayUrl: device.relayUrl,
        deviceId: device.startupDeviceId
      });
      setStartupStatus(next);
    } catch {
      setStartupError("Could not update startup for this device.");
    } finally {
      setStartupBusy(false);
    }
  };

  const startupDetail =
    startupError ??
    startupStatus?.message ??
    (startupStatus
      ? startupEnabledForDevice
        ? `Startup is enabled for ${device.name}.`
        : startupStatus.enabled
          ? "Startup is enabled for a different device context."
          : `Startup is disabled for ${device.name}.`
      : canManageStartup
        ? "Checking startup registration for this device."
        : "Pair this device through the relay before managing startup.");

  const overview = [
    { label: "CPU Usage", value: `${device.metrics?.cpu ?? 0}%`, icon: Cpu, bar: device.metrics?.cpu ?? 0 },
    { label: "RAM Usage", value: `${device.metrics?.ram ?? 0}%`, detail: "5.1 GB / 15.9 GB", icon: Activity, bar: device.metrics?.ram ?? 0 },
    { label: "Disk Usage", value: `${device.metrics?.disk ?? 0}%`, detail: "196 GB / 476 GB", icon: Database, bar: device.metrics?.disk ?? 0 },
    { label: "Uptime", value: device.status === "online" ? "2d 14h 32m" : "-", icon: Activity }
  ];

  return (
    <aside className="device-detail-panel">
      <div className="device-detail-hero">
        <img src={assets.room.full} alt="" />
        <span>
          <img src={device.icon} alt="" />
        </span>
      </div>
      <section className="device-detail-content">
        <header>
          <h2>{device.name}</h2>
          <StatusPill status={device.status} />
          <p>
            {device.system}
            {" \u2022 "}
            {device.connection}
          </p>
        </header>

        <div className="device-action-grid">
          <button disabled={!relayConnected} onClick={() => onRelayRequest("device.state.request")}>
            <Monitor size={22} />
            Request State
          </button>
          <button disabled={!relayConnected} onClick={() => onRelayRequest("provider.refresh.request")}>
            <Activity size={22} />
            Refresh Providers
          </button>
          <button disabled={!relayConnected} onClick={() => onRelayRequest("agent.roster.request")}>
            <Bot size={22} />
            Request Roster
          </button>
        </div>

        <section className="device-detail-section">
          <h3>System Overview</h3>
          {overview.map((item) => {
            const Icon = item.icon;
            return (
              <div className="overview-row" key={item.label}>
                <Icon size={18} />
                <span>{item.label}</span>
                {typeof item.bar === "number" ? (
                  <i>
                    <em style={{ width: `${item.bar}%` }} />
                  </i>
                ) : null}
                <strong>
                  {item.value}
                  {item.detail ? <small>{item.detail}</small> : null}
                </strong>
              </div>
            );
          })}
        </section>

        <section className="device-detail-section">
          <h3>Connection Details</h3>
          <DetailRow label="Provider" value={device.provider} image={assets.icons.providers[device.provider]} />
          <DetailRow label="Last Connected" value={device.lastConnected} icon={Activity} />
          <DetailRow label="Local IP" value={device.localIp} icon={Globe2} />
          <DetailRow label="Agent Version" value={device.version} icon={Info} />
          {device.relayUrl ? <DetailRow label="Startup Relay" value={device.relayUrl} icon={Link2} /> : null}
          {device.lastCommand ? <DetailRow label="Relay" value={device.lastCommand} icon={ShieldCheck} /> : null}
        </section>

        <section className="device-detail-section">
          <h3>Startup</h3>
          <div className="startup-device-row">
            <span>
              <strong>Auto Start Agent</strong>
              <small>{startupDetail}</small>
            </span>
            <Toggle checked={startupEnabledForDevice} disabled={!canManageStartup || !startupStatus?.supported || startupBusy} onClick={updateStartup} />
          </div>
        </section>

        <section className="device-detail-section">
          <h3>Providers</h3>
          <div className="relay-provider-list">
            {(device.providers ?? []).length > 0 ? (
              device.providers?.map((provider) => (
                <div className={provider.id === device.activeProviderId ? "relay-provider-row active" : "relay-provider-row"} key={provider.id}>
                  <img src={assets.icons.providers[provider.name]} alt="" />
                  <span>
                    <strong>{provider.name}</strong>
                    <small>{provider.agents.length} {provider.agents.length === 1 ? "agent" : "agents"}</small>
                  </span>
                  <StatusPill status={provider.status} />
                </div>
              ))
            ) : (
              <div className="empty-agent-row">No provider snapshot yet</div>
            )}
          </div>
        </section>

        <section className="device-detail-section">
          <h3>Agent Roster</h3>
          <div className="relay-agent-list">
            {(device.agents ?? []).length > 0 ? (
              device.agents?.map((agent) => (
                <div className="relay-agent-row" key={agent.id}>
                  <img src={getAgentAvatar(agent)} alt="" />
                  <span>
                    <strong>{agent.name}</strong>
                    <small>{agent.role}</small>
                  </span>
                  <StatusPill status={agent.status} />
                </div>
              ))
            ) : (
              <div className="empty-agent-row">No roster snapshot yet</div>
            )}
          </div>
        </section>
      </section>
    </aside>
  );
}

function DetailRow({
  label,
  value,
  icon,
  image
}: {
  label: string;
  value: string;
  icon?: ElementType;
  image?: string;
}) {
  const Icon = icon;
  return (
    <div className="detail-row">
      {image ? <img src={image} alt="" /> : Icon ? <Icon size={17} /> : null}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NotificationsView({
  notifications,
  onRefresh,
  onUpdateNotifications,
  onOpenChat
}: {
  notifications: ReikaNotification[];
  onRefresh: () => void;
  onUpdateNotifications: (notifications: ReikaNotification[]) => void;
  onOpenChat: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const visibleItems = useMemo(() => {
    const source = notifications.length > 0 ? notifications : [];
    return filter === "all" ? source : source.filter((item) => item.unread);
  }, [filter, notifications]);
  const selected = notifications.find((item) => item.id === selectedId) ?? visibleItems[0] ?? null;

  useEffect(() => {
    onRefresh();
  }, []);

  useEffect(() => {
    if (!selectedId && visibleItems[0]) setSelectedId(visibleItems[0].id);
  }, [selectedId, visibleItems]);

  const selectNotification = (item: ReikaNotification) => {
    setSelectedId(item.id);
    if (!item.unread) return;
    markNotificationRead(item.id)
      .then(({ notification }) => {
        onUpdateNotifications(notifications.map((current) => (current.id === notification.id ? notification : current)));
      })
      .catch(() => undefined);
  };

  const markAllRead = () => {
    markAllNotificationsRead()
      .then(({ notifications }) => onUpdateNotifications(notifications))
      .catch(() => undefined);
  };

  const removeSelected = () => {
    if (!selected) return;
    deleteNotification(selected.id)
      .then(({ notifications }) => {
        onUpdateNotifications(notifications);
        setSelectedId(notifications[0]?.id ?? "");
      })
      .catch(() => undefined);
  };

  return (
    <main className="page notifications-page">
      <header className="workbench-header">
        <div className="workbench-title">
          <span>
            <h1>Notifications</h1>
            <p>Stay updated on everything that matters.</p>
          </span>
        </div>
        <div className="workbench-actions">
          <button className="secondary-action small" onClick={markAllRead}>
            <Check size={18} />
            Mark all as read
          </button>
          <button className="secondary-action small" onClick={() => setFilter((current) => (current === "all" ? "unread" : "all"))}>
            <FilterIcon />
            {filter === "all" ? "All" : "Unread"}
            <ChevronDown size={16} />
          </button>
          <button className="icon-button compact" aria-label="More notification actions">
            <MoreHorizontal size={20} />
          </button>
        </div>
      </header>

      <div className="notifications-layout">
        <section className="notification-list-panel" aria-label="Notifications">
          {visibleItems.length > 0 ? visibleItems.map((item) => (
            <button
              className={item.id === selectedId ? "notification-row selected" : "notification-row"}
              key={item.id}
              onClick={() => selectNotification(item)}
            >
              {item.unread ? <span className="unread-dot" /> : null}
              <NotificationIcon item={item} />
              <span className="notification-copy">
                <strong>{item.title}</strong>
                <small>{item.body}</small>
                <b className={`mini-tag ${notificationTagTone(item)}`}>{notificationTag(item)}</b>
              </span>
              <time>{relativeTime(item.createdAt)}</time>
              {item.unread ? <span className="notification-blue-dot" /> : null}
            </button>
          )) : <div className="empty-agent-row">No notifications yet</div>}
          <footer className="notification-list-footer">
            <strong>You've reached the end</strong>
            <small>{filter === "all" ? "Showing all notifications" : "Showing unread notifications"}</small>
          </footer>
        </section>

        <NotificationDetailPanel item={selected} onOpenChat={onOpenChat} onDelete={removeSelected} />
      </div>
    </main>
  );
}

function NotificationIcon({ item }: { item: ReikaNotification }) {
  return (
    <span className={`notification-icon accent-${item.tone}`}>
      <img src={notificationIcon(item)} alt="" />
      <em className={`notification-badge ${notificationBadge(item)}`}>
          {notificationBadge(item) === "check" ? <CheckCircle2 size={13} /> : notificationBadge(item) === "warning" ? <TriangleAlert size={13} /> : notificationBadge(item) === "heart" ? <Heart size={12} fill="currentColor" /> : <Activity size={12} />}
        </em>
    </span>
  );
}

function NotificationDetailPanel({ item, onOpenChat, onDelete }: { item: ReikaNotification | null; onOpenChat: () => void; onDelete: () => void }) {
  if (!item) {
    return (
      <aside className="notification-detail-panel">
        <section className="notification-detail-content">
          <h2>No notification selected</h2>
          <p>The inbox is quiet.</p>
        </section>
      </aside>
    );
  }

  return (
    <aside className="notification-detail-panel">
      <div className="notification-detail-hero">
        <img src={assets.room.hero} alt="" />
        <span>
          <StatusDot status="online" />
          Online
        </span>
      </div>

      <section className="notification-detail-content">
        <h2>{item.title}</h2>
        <time>{absoluteTime(item.createdAt)}</time>
        <p>
          {item.body}
        </p>

        <div className="notification-info-card">
          <DetailRow label="Type" value={notificationTag(item)} icon={Bot} />
          <DetailRow label="Time" value={absoluteTime(item.createdAt)} icon={Activity} />
          <DetailRow label="Source" value={item.source} icon={Box} />
          <button>View Profile</button>
        </div>

        <section className="quick-actions">
          <h3>Quick Actions</h3>
          <button className="primary-action" onClick={onOpenChat}>
            <MessageCircle size={20} />
            Start Chat with Reika
          </button>
          <button className="secondary-action">
            <Database size={20} />
            View Reika's Memory
          </button>
        </section>

        <button className="danger-action" onClick={onDelete}>
          <Trash2 size={18} />
          Delete Notification
        </button>
      </section>
    </aside>
  );
}

function notificationTag(item: ReikaNotification) {
  if (item.kind === "provider") return "Provider";
  if (item.kind === "device") return "Device";
  if (item.kind === "chat") return "Chat";
  if (item.kind === "file") return "Files";
  if (item.kind === "warning") return "Warning";
  if (item.kind === "agent") return "Reika";
  return "System";
}

function notificationTagTone(item: ReikaNotification): NotificationItem["tagTone"] {
  if (item.tone === "red") return "orange";
  if (item.tone === "pink") return "blue";
  return item.tone;
}

function notificationBadge(item: ReikaNotification): "check" | "warning" | "heart" | "spark" {
  if (item.kind === "warning" || item.tone === "orange" || item.tone === "red") return "warning";
  if (item.kind === "chat" || item.kind === "agent") return "heart";
  if (item.kind === "provider" || item.kind === "device") return "check";
  return "spark";
}

function notificationIcon(item: ReikaNotification) {
  if (item.kind === "provider") {
    const source = item.source.toLowerCase();
    if (source.includes("openclaw")) return assets.icons.providers.OpenClaw;
    if (source.includes("command")) return assets.icons.providers.CommandCenter;
    if (source.includes("mock")) return assets.icons.providers.Mock;
    return assets.icons.providers.Hermes;
  }
  if (item.kind === "device") return assets.icons.devices.pc;
  if (item.kind === "file") return assets.brand.logoSmall;
  if (item.kind === "warning") return assets.icons.devices.server;
  return assets.reika.avatar;
}

function relativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "now";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function absoluteTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

function SettingsView({
  settings,
  backendMode,
  backendError,
  onSettingsChange
}: {
  settings: ReikaSettings;
  backendMode: BackendMode;
  backendError: string | null;
  onSettingsChange: (settings: ReikaSettings, state?: ReikaStateResponse) => void;
}) {
  const [activeTab, setActiveTab] = useState("General");
  const [busySetting, setBusySetting] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [startupStatus, setStartupStatus] = useState<LocalAgentStartupStatus | null>(null);
  const [startupBusy, setStartupBusy] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<ReikaUpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
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

  const updateSetting = (key: keyof Omit<ReikaSettings, "version" | "updatedAt">, value: string | boolean) => {
    setBusySetting(key);
    setSettingsError(null);
    patchSettings({ [key]: value } as Partial<Omit<ReikaSettings, "version" | "updatedAt">>)
      .then(({ settings, state }) => onSettingsChange(settings, state))
      .catch((error) => setSettingsError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusySetting(null));
  };

  const toggleStartup = () => {
    setStartupBusy(true);
    setSettingsError(null);
    setLocalAgentStartup(!startupStatus?.enabled)
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

  return (
    <main className="settings-screen">
      <aside className="settings-scene">
        <img src={assets.reika.splash} alt="" />
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
          <button className="secondary-action">
            <Info size={18} />
            About AgentHub
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-tabs" aria-label="Settings sections">
            {settingsTabs.map((item) => {
              const Icon = item.icon;
              return (
                <button className={activeTab === item.title ? "settings-tab active" : "settings-tab"} key={item.title} onClick={() => setActiveTab(item.title)}>
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
                <SettingRow title="Language" detail="Choose your preferred language.">
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
                  <button className="secondary-action small" onClick={() => updateSetting("mockEnabled", settings.mockEnabled)} disabled={Boolean(busySetting)}>Recheck</button>
                </SettingRow>
              </>
            ) : null}
            {activeTab === "Devices" ? (
              <>
                <SettingRow title="Relay Pairing" detail="Use Devices to pair Windows or Linux agents safely through the relay.">
                  <button className="secondary-action small">Configured</button>
                </SettingRow>
                <SettingRow title="Startup Agent" detail={startupStatus?.command ?? "No startup command registered."}>
                  <StatusPill status={startupStatus?.enabled ? "online" : "offline"} />
                </SettingRow>
              </>
            ) : null}
            {activeTab === "Appearance" ? (
              <>
                <SettingRow title="Theme" detail="Dark AgentHub theme is active for Phase 1.">
                  <button className="select-button">
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
                  <button className="secondary-action small">Manage</button>
                </SettingRow>
                <button className="security-row">
                  <Shield size={28} />
                  <span>
                    <strong>Security</strong>
                    <small>Pairing-code approval only in Phase 1.</small>
                  </span>
                  <ChevronRight size={20} />
                </button>
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

function Toggle({ checked = false, disabled = false, onClick }: { checked?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button className={checked ? "toggle checked" : "toggle"} aria-pressed={checked} disabled={disabled} onClick={onClick}>
      <span />
    </button>
  );
}

function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`status-pill status-${status}`}>
      <StatusDot status={status} />
      {statusLabels[status]}
    </span>
  );
}

function StatusDot({ status }: { status: Status }) {
  return <i className={`status-dot status-${status}`} aria-hidden="true" />;
}

function mapReikaStateToDevice(state: ReikaStateResponse): Device {
  const deviceId = String(state.device.id ?? state.device.deviceId ?? "local-reika-device");
  return {
    id: deviceId,
    name: getReikaDeviceName(state) || "Project Reika Device",
    type: inferReikaDeviceType(state),
    status: "online",
    location: "Local",
    activeProviderId: state.activeProviderId,
    providers: state.providers.map((provider) => mapReikaProvider(provider, deviceId))
  };
}

function mapReikaProvider(provider: ReikaProviderRecord, deviceId: string): Provider {
  return {
    id: provider.id,
    name: labelReikaProvider(provider.kind),
    deviceId,
    status: mapProviderStatus(provider.status),
    latency: provider.endpointLabel || "local",
    agents: provider.agents.map((agent, index) => ({
      id: agent.id || `${provider.id}-agent-${index + 1}`,
      name: agent.name || agent.label || agent.id || "Reika",
      providerId: provider.id,
      deviceId,
      role: String(agent.role || agent.source || agent.model || provider.name),
      status: mapProviderStatus(provider.status),
      lastActivity: provider.notes || "Detected by Reika server",
      characterId: String(agent.id || agent.name || "").toLowerCase().includes("reika") ? "reika" : undefined
    }))
  };
}

function labelReikaProvider(kind: ReikaProviderRecord["kind"]): Provider["name"] {
  if (kind === "commandcenter") return "CommandCenter";
  if (kind === "openclaw") return "OpenClaw";
  if (kind === "hermes") return "Hermes";
  return "Mock";
}

function mapProviderStatus(status?: ReikaProviderRecord["status"]): Status {
  if (status === "preferred" || status === "available") return "online";
  if (status === "planned") return "connecting";
  if (status === "error") return "error";
  if (status === "offline") return "offline";
  return "unknown";
}

function getReikaDeviceName(state: ReikaStateResponse | null) {
  if (!state) return "";
  return String(state.device.name ?? state.device.hostname ?? state.device.id ?? "").trim();
}

function inferReikaDeviceType(state: ReikaStateResponse): Device["type"] {
  const label = String(state.device.platform ?? state.device.name ?? state.device.hostname ?? "").toLowerCase();
  if (label.includes("linux") || label.includes("server")) return "server";
  if (label.includes("laptop")) return "laptop";
  if (label.includes("phone") || label.includes("ios") || label.includes("android")) return "phone";
  return "pc";
}

function mapReikaMessage(message: ReikaChatMessage): ChatMessage {
  return {
    id: message.id,
    sender: message.role === "assistant" ? "agent" : message.role,
    body: message.text,
    time: formatClock(message.timestamp)
  };
}

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "now";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function getAgentAvatar(agent: Agent) {
  if (agent.characterId === "reika" || agent.id === "reika") return assets.reika.avatar;
  if (agent.id.toLowerCase().includes("astra")) return assets.reika.expressions.happy;
  if (agent.id.toLowerCase().includes("miyabi")) return assets.reika.expressions.playful;
  if (agent.id.toLowerCase().includes("nyxie")) return assets.reika.expressions.thinking;
  return assets.reika.chibi;
}

function mapLocalDeviceRecord(device: Device): DevicePageRow {
  const activeProvider =
    device.providers.find((provider) => provider.id === device.activeProviderId) ??
    device.providers.find((provider) => provider.status === "online") ??
    device.providers.find((provider) => provider.status !== "offline") ??
    device.providers[0];
  const agents = device.providers.flatMap((provider) => provider.agents);
  return {
    id: device.id,
    name: device.name,
    icon: getDeviceIcon(device.type),
    typeLabel: device.type,
    system: getSystemLabel(device),
    connection: `${device.location} Connection`,
    status: device.status,
    tag: device.location === "Local" ? "This Device" : "Detected",
    tagTone: device.location === "Local" ? "blue" : "green",
    metrics: makeDeviceMetrics(device.id),
    provider: activeProvider?.name ?? "Custom",
    providers: device.providers,
    agents,
    activeProviderId: activeProvider?.id,
    lastConnected: "Just now",
    localIp: device.location,
    version: "v0.1.0"
  };
}

function mapRelayDeviceRecord(record: RelayDeviceRecord): DevicePageRow {
  const device = mapDevice(record.device);
  const activeProvider =
    device.providers.find((provider) => provider.id === record.activeProviderId) ??
    device.providers.find((provider) => provider.status === "online") ??
    device.providers[0];
  const agentCount = device.providers.reduce((total, provider) => total + provider.agents.length, 0);
  const statusLabel = device.status === "busy" ? "Idle" : undefined;
  const lastConnected = formatRelativeTime(record.device.lastSeenAt);
  return {
    id: device.id,
    name: device.name,
    icon: getDeviceIcon(device.type),
    typeLabel: device.type,
    system: getSystemLabel(device),
    connection: device.location === "Local" ? "Local Connection" : "Relay Connection",
    status: device.status,
    statusLabel,
    tag: device.location === "Local" ? "This Device" : "Paired",
    tagTone: device.location === "Local" ? "blue" : "green",
    metrics: makeDeviceMetrics(device.id),
    provider: activeProvider?.name ?? "Custom",
    providers: device.providers,
    agents: record.agents.length > 0 ? record.agents.map(mapRelayAgent) : device.providers.flatMap((provider) => provider.agents),
    activeProviderId: record.activeProviderId ?? activeProvider?.id,
    lastCommand: record.lastCommand,
    lastConnected,
    localIp: record.device.location === "local" ? "Local relay" : "Outbound WSS",
    version: record.device.agentVersion,
    relayUrl: reikaRelayDeviceUrl,
    startupDeviceId: record.device.id
  };
}

function mapRelayAgent(agent: RelayDeviceRecord["agents"][number]): Agent {
  return {
    id: agent.id,
    name: agent.name,
    providerId: agent.providerId,
    deviceId: agent.deviceId,
    role: agent.role,
    status: agent.status,
    lastActivity: agent.lastActivity ?? "Relay roster",
    characterId: agent.characterId
  };
}

function startupMatchesDevice(status: LocalAgentStartupStatus, device: DevicePageRow) {
  if (!status.command || !device.startupDeviceId || !device.relayUrl) return false;
  return status.command.includes(device.startupDeviceId) && status.command.includes(device.relayUrl);
}

function getDeviceIcon(type: Device["type"]) {
  if (type === "server") return assets.icons.devices.server;
  if (type === "laptop") return assets.icons.devices.laptop;
  if (type === "phone") return assets.icons.devices.phone;
  return assets.icons.devices.pc;
}

function getSystemLabel(device: Device) {
  if (device.type === "server") return "Linux Server";
  if (device.type === "laptop") return "Windows Laptop";
  if (device.type === "phone") return "Mobile Companion";
  return "Windows PC";
}

function makeDeviceMetrics(seed: string) {
  const score = [...seed].reduce((total, character) => total + character.charCodeAt(0), 0);
  return {
    cpu: 8 + (score % 28),
    ram: 18 + (score % 42),
    disk: 24 + (score % 36)
  };
}

function formatRelativeTime(value: string) {
  const ms = Date.now() - Date.parse(value);
  if (!Number.isFinite(ms) || ms < 0) return "Just now";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function buildPresentationDevices(devices: Device[]) {
  if (devices !== mockDevices && devices.length > 0) return devices;

  const hasReferenceShape = devices.some((device) =>
    device.providers.some((provider) => provider.agents.some((agent) => agent.id === "reika"))
  );

  if (hasReferenceShape) return devices;

  const liveLocal = devices.find((device) => device.location.toLowerCase() === "local");
  if (!liveLocal) return mockDevices;

  return mockDevices.map((device, index) =>
    index === 0
      ? {
          ...device,
          id: liveLocal.id,
          name: liveLocal.name || device.name,
          status: liveLocal.status
        }
      : device
  );
}
