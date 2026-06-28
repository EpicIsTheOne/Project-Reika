import { useEffect, useMemo, useState } from "react";
import type { ElementType, ReactNode } from "react";
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
import { fetchAgentHubDevices, mapDevice, scanLocalAgentHubProviders } from "./data/api";
import {
  applyRelayEnvelope,
  approveRelayPairingCode,
  connectRelayApp,
  createRelayPairingCode,
  type RelayDeviceRecord,
  type RelayPairing
} from "./data/relay";
import { chatMessages, devices as mockDevices, reikaProfile } from "./data/mockData";
import type { Agent, Device, Provider, Status, View } from "./types";

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

const navItems = [
  { key: "home", route: "home" as const, label: "Home", icon: Home },
  { key: "chat", route: "chat" as const, label: "Chats", icon: MessageCircle },
  { key: "devices", route: "devices" as const, label: "Devices", icon: Monitor },
  { key: "notifications", route: "notifications" as const, label: "Notifications", icon: Bell, badge: "3" },
  { key: "settings", route: "settings" as const, label: "Settings", icon: Settings }
];

export function App() {
  const [view, setView] = useState<View>("loading");
  const [selectedAgentId, setSelectedAgentId] = useState("reika");
  const [appDevices, setAppDevices] = useState<Device[]>(mockDevices);
  const [backendMode, setBackendMode] = useState<BackendMode>("loading");
  const [backendError, setBackendError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchAgentHubDevices()
      .then((nextDevices) => {
        if (cancelled) return;
        setAppDevices(nextDevices.length > 0 ? nextDevices : mockDevices);
        setBackendMode("live");
        setBackendError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setAppDevices(mockDevices);
        setBackendMode("fallback");
        setBackendError(error instanceof Error ? error.message : String(error));
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
    scanLocalAgentHubProviders()
      .then((device) => {
        setAppDevices((current) => {
          const mappedDevice = mapDevice(device);
          const others = current.filter((item) => item.id !== mappedDevice.id);
          return [mappedDevice, ...others];
        });
        setBackendMode("live");
        setBackendError(null);
      })
      .catch((error) => {
        setBackendMode("fallback");
        setBackendError(error instanceof Error ? error.message : String(error));
      });
  };

  if (view === "loading") {
    return (
      <div className="app-root">
        <LoadingScreen mode={backendMode} error={backendError} onEnter={() => setView("home")} />
      </div>
    );
  }

  return (
    <div className="app-root">
      <AppShell activeView={view} backendMode={backendMode} onNavigate={setView}>
        {view === "home" && (
          <HomePage
            devices={presentationDevices}
            backendMode={backendMode}
            onScanProviders={handleScanProviders}
            onOpenChat={(agentId) => {
              setSelectedAgentId(agentId);
              setView("chat");
            }}
          />
        )}
        {view === "chat" && <ChatView agent={selectedAgent} onBack={() => setView("home")} />}
        {view === "devices" && <DevicesView onScanProviders={handleScanProviders} />}
        {view === "notifications" && (
          <NotificationsView
            onOpenChat={() => {
              setSelectedAgentId("reika");
              setView("chat");
            }}
          />
        )}
        {view === "settings" && <SettingsView backendMode={backendMode} backendError={backendError} />}
      </AppShell>
    </div>
  );
}

function LoadingScreen({
  mode,
  error,
  onEnter
}: {
  mode: BackendMode;
  error: string | null;
  onEnter: () => void;
}) {
  const bootSteps = [
    { label: "Initializing", icon: Activity, state: "active" },
    { label: "Connecting", icon: Link2, state: "idle" },
    { label: "Authenticating", icon: ShieldCheck, state: "idle" },
    { label: "Loading Agents", icon: Users, state: "idle" },
    { label: "Preparing Environment", icon: Box, state: "idle" },
    { label: "Finalizing", icon: CheckCircle2, state: "idle" }
  ];
  const systemStatus =
    mode === "fallback" ? "Fallback mode active" : mode === "live" ? "All systems nominal" : "Scanning local providers";

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
          {bootSteps.map((step) => {
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
            <span>Initializing secure connection...</span>
            <strong>72%</strong>
          </div>
          <div className="boot-progress-track">
            <span />
          </div>
        </div>

        <figure className="boot-quote">
          <blockquote>Connecting minds. Building tomorrow.</blockquote>
          <figcaption>Astra</figcaption>
        </figure>

        {error ? <p className="boot-note">{error}</p> : null}

        <button className="boot-enter" onClick={onEnter}>
          Enter AgentHub
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

function AppShell({
  activeView,
  backendMode,
  onNavigate,
  children
}: {
  activeView: View;
  backendMode: BackendMode;
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
              <button className={active ? "nav-item active" : "nav-item"} key={item.label} onClick={() => onNavigate(item.route)}>
                <Icon size={22} />
                <span>{item.label}</span>
                {item.badge ? <strong>{item.badge}</strong> : null}
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
  onOpenChat
}: {
  devices: Device[];
  backendMode: BackendMode;
  onScanProviders: () => void;
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
        action={<NotificationButton />}
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
        <button className="secondary-action small" onClick={onScanProviders}>
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

function NotificationButton() {
  return (
    <button className="notification-button" aria-label="Notifications">
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

function ChatView({ agent, onBack }: { agent: Agent; onBack: () => void }) {
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

function MessageBubble({ message }: { message: (typeof chatMessages)[number] }) {
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

function DevicesView({ onScanProviders }: { onScanProviders: () => void }) {
  const [selectedId, setSelectedId] = useState("epic-pc");
  const [filterOpen, setFilterOpen] = useState(false);
  const [relayStatus, setRelayStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [relayDevices, setRelayDevices] = useState<RelayDeviceRecord[]>([]);
  const [relayPairing, setRelayPairing] = useState<RelayPairing | null>(null);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [relaySend, setRelaySend] = useState<ReturnType<typeof connectRelayApp>["send"] | null>(null);
  const relayRows = useMemo(() => relayDevices.map(mapRelayDeviceRecord), [relayDevices]);
  const displayRows = relayRows.length > 0 ? relayRows : deviceRows;
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
        setRelayError(null);
      })
      .catch((error) => {
        setRelayError(error instanceof Error ? error.message : String(error));
      });
  };

  const handleApprovePairing = () => {
    if (!relayPairing) return;
    approveRelayPairingCode(relayPairing.code)
      .then((pairing) => {
        setRelayPairing(pairing);
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
              {relayRows.length > 0 ? ` • ${relayRows.length} paired ${relayRows.length === 1 ? "device" : "devices"}` : " • Local preview fallback"}
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
        <section className="relay-pairing-strip">
          {relayPairing ? (
            <>
              <span>
                Pairing code
                <strong>{relayPairing.code}</strong>
              </span>
              <span>
                Status
                <strong>{relayPairing.status}</strong>
              </span>
              <button className="secondary-action small" onClick={handleApprovePairing}>
                <Check size={18} />
                Approve
              </button>
            </>
          ) : null}
          {relayError ? <em>{relayError}</em> : null}
        </section>
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
          {device.lastCommand ? <DetailRow label="Relay" value={device.lastCommand} icon={ShieldCheck} /> : null}
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

function NotificationsView({ onOpenChat }: { onOpenChat: () => void }) {
  const [selectedId, setSelectedId] = useState("reika-online");
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const visibleItems = filter === "all" ? notificationItems : notificationItems.filter((item) => item.unread);
  const selected = notificationItems.find((item) => item.id === selectedId) ?? notificationItems[0];

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
          <button className="secondary-action small">
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
          {visibleItems.map((item) => (
            <button
              className={item.id === selectedId ? "notification-row selected" : "notification-row"}
              key={item.id}
              onClick={() => setSelectedId(item.id)}
            >
              {item.unread ? <span className="unread-dot" /> : null}
              <NotificationIcon item={item} />
              <span className="notification-copy">
                <strong>{item.title}</strong>
                <small>{item.body}</small>
                <b className={`mini-tag ${item.tagTone}`}>{item.tag}</b>
              </span>
              <time>{item.time}</time>
              {item.unread ? <span className="notification-blue-dot" /> : null}
            </button>
          ))}
          <footer className="notification-list-footer">
            <strong>You've reached the end</strong>
            <small>Showing all notifications</small>
          </footer>
        </section>

        <NotificationDetailPanel item={selected} onOpenChat={onOpenChat} />
      </div>
    </main>
  );
}

function NotificationIcon({ item }: { item: NotificationItem }) {
  return (
    <span className={`notification-icon accent-${item.accent}`}>
      {item.avatar ? <img src={item.avatar} alt="" /> : item.icon ? <img src={item.icon} alt="" /> : item.providerIcon ? <img src={item.providerIcon} alt="" /> : null}
      {item.badge ? (
        <em className={`notification-badge ${item.badge}`}>
          {item.badge === "check" ? <CheckCircle2 size={13} /> : item.badge === "warning" ? <TriangleAlert size={13} /> : item.badge === "heart" ? <Heart size={12} fill="currentColor" /> : <Activity size={12} />}
        </em>
      ) : null}
    </span>
  );
}

function NotificationDetailPanel({ item, onOpenChat }: { item: NotificationItem; onOpenChat: () => void }) {
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
        <time>{item.detailTime}</time>
        <p>
          {item.body} You can start a chat or ask her to check on your systems.
        </p>

        <div className="notification-info-card">
          <DetailRow label="Agent" value="Reika" icon={Bot} />
          <DetailRow label="Time" value={item.detailTime} icon={Activity} />
          <DetailRow label="Source" value="AgentHub System" icon={Box} />
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

        <button className="danger-action">
          <Trash2 size={18} />
          Delete Notification
        </button>
      </section>
    </aside>
  );
}

function SettingsView({ backendMode, backendError }: { backendMode: BackendMode; backendError: string | null }) {
  const settingsTabs = [
    { title: "General", detail: "Basic preferences", icon: Brush, active: true },
    { title: "Devices", detail: "Manage your devices", icon: Monitor },
    { title: "Providers", detail: "Manage providers", icon: Box },
    { title: "Appearance", detail: "Theme, colors, layout", icon: Palette },
    { title: "Audio", detail: "Voice & sound settings", icon: Mic },
    { title: "Developer", detail: "Logs, diagnostics, tools", icon: Code2 }
  ];

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
                <button className={item.active ? "settings-tab active" : "settings-tab"} key={item.title}>
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
            <h2>General</h2>
            <SettingRow title="Language" detail="Choose your preferred language.">
              <button className="select-button">
                <Globe2 size={18} />
                English
                <ChevronDown size={18} />
              </button>
            </SettingRow>
            <SettingRow title="Startup Behavior" detail="Choose what happens when AgentHub launches.">
              <button className="select-button">
                Open Home
                <ChevronDown size={18} />
              </button>
            </SettingRow>
            <SettingRow title="Minimize to Tray" detail="Keep AgentHub running in the background.">
              <Toggle checked />
            </SettingRow>
            <SettingRow title="Auto Start" detail="Start AgentHub when your system starts.">
              <Toggle />
            </SettingRow>
            <SettingRow title="Data & Cache" detail={backendError ?? `Backend mode: ${backendMode}.`}>
              <button className="secondary-action small">Manage</button>
            </SettingRow>
            <button className="security-row">
              <Shield size={28} />
              <span>
                <strong>Security</strong>
                <small>Manage your account security and sessions.</small>
              </span>
              <ChevronRight size={20} />
            </button>
          </section>
        </div>

        <footer className="settings-footer">
          AgentHub v0.1.0
          <StatusDot status="online" />
          You're on the latest version
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

function Toggle({ checked = false }: { checked?: boolean }) {
  return (
    <button className={checked ? "toggle checked" : "toggle"} aria-pressed={checked}>
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

function getAgentAvatar(agent: Agent) {
  if (agent.characterId === "reika" || agent.id === "reika") return assets.reika.avatar;
  if (agent.id.toLowerCase().includes("astra")) return assets.reika.expressions.happy;
  if (agent.id.toLowerCase().includes("miyabi")) return assets.reika.expressions.playful;
  if (agent.id.toLowerCase().includes("nyxie")) return assets.reika.expressions.thinking;
  return assets.reika.chibi;
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
    version: record.device.agentVersion
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
