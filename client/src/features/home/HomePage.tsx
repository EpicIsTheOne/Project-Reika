import { useMemo, useState, type ReactNode } from "react";
import { Bell, Box, ChevronRight, Heart, MessageCircle, Monitor, MoreHorizontal, Plus, Search } from "lucide-react";
import { statusLabels } from "../../app/constants";
import type { BackendMode } from "../../app/types";
import { assets } from "../../data/assets";
import { deviceMatchesQuery, getAgentAvatarRender } from "../../domain/reikaMappers";
import type { ArtRuntime } from "../../lib/artRuntime";
import type { ReikaAgentSelectorSettings } from "../../lib/reikaApi";
import { motionDelay, pageMotionClass } from "../../lib/motion";
import type { Agent, Device, Provider } from "../../types";
import { StatusDot, StatusPill } from "../../components/status";

export function HomePage({
  devices,
  backendMode,
  selectorSettings,
  artRuntime,
  onOpenNotifications,
  onAddDevice,
  onOpenChat
}: {
  devices: Device[];
  backendMode: BackendMode;
  selectorSettings: ReikaAgentSelectorSettings;
  artRuntime: ArtRuntime;
  onScanProviders: () => void;
  onOpenNotifications: () => void;
  onAddDevice: () => void;
  onOpenChat: (agent: Agent | string) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleDevices = normalizedQuery ? devices.filter((device) => deviceMatchesQuery(device, normalizedQuery)) : devices;
  const featuredSeed = useMemo(() => Math.random(), []);
  const featuredAgents = devices.flatMap((device) => device.providers.flatMap((provider) => provider.agents));
  const featuredAgent = featuredAgents.length > 0 ? featuredAgents[Math.floor(featuredSeed * featuredAgents.length) % featuredAgents.length] : null;
  const featuredAgentName = formatAgentDisplayName(featuredAgent?.name ?? "Reika", featuredAgent?.role, selectorSettings.showRole);
  const featuredAgentArtKey = featuredAgent ?? "reika";
  const featuredArt = artRuntime.agentArtRender(featuredAgentArtKey, "hero-banner", assets.room.hero, "home-hero");
  const onlineAgents = devices
    .flatMap((device) => device.providers.flatMap((provider) => provider.agents))
    .filter((agent) => agent.status === "online" || agent.status === "busy" || agent.status === "thinking").length;

  return (
    <main className={pageMotionClass("page home-page")}>
      <HeaderBar
        title={
          <>
            Welcome back, <span>Epic.</span>
          </>
        }
        subtitle={
          <>
            <StatusDot status={backendMode === "fallback" ? "offline" : "online"} />
            {backendMode === "fallback" ? "Server degraded" : "All systems operational"}
            <b>{onlineAgents} agents online</b>
          </>
        }
        searchValue={query}
        onSearchChange={setQuery}
        action={<NotificationButton onClick={onOpenNotifications} />}
      />

      <section className="feature-hero motion-hero">
        <img src={featuredArt.src} alt="" style={featuredArt.style} />
        <div className="feature-copy">
          <p className="eyebrow">Featured Agent</p>
          <h2>
            {featuredAgentName}
          </h2>
          <p className="hero-quote">"{featuredAgentName === "Reika" ? "Hehe~ You're back." : "Ready when you are."}"</p>
          <p>Ready to get things done together?</p>
          <div className="hero-actions">
            <button className="primary-action" onClick={() => onOpenChat(featuredAgent ?? "reika")}>
              <MessageCircle size={20} />
              Chat Now
            </button>
            <button className="secondary-action" onClick={() => onOpenChat(featuredAgent ?? "reika")}>
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
        {visibleDevices.length > 0 ? visibleDevices.map((device, index) => (
          <DeviceCard device={device} key={device.id} selectorSettings={selectorSettings} artRuntime={artRuntime} onOpenChat={onOpenChat} motionIndex={index} />
        )) : <div className="empty-agent-row">No matching agents or devices.</div>}
      </section>

      <footer className="app-footer">
        Your AI agents. Anywhere. Anytime.
        <Heart size={14} fill="currentColor" />
      </footer>
    </main>
  );
}

function HeaderBar({
  title,
  subtitle,
  action,
  searchValue = "",
  onSearchChange
}: {
  title: ReactNode;
  subtitle: ReactNode;
  action?: ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="header-actions">
        <label className="search-field">
          <Search size={22} />
          <input value={searchValue} onChange={(event) => onSearchChange?.(event.target.value)} placeholder="Search agents, devices..." />
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

function DeviceCard({ device, selectorSettings, artRuntime, onOpenChat, motionIndex = 0 }: { device: Device; selectorSettings: ReikaAgentSelectorSettings; artRuntime: ArtRuntime; onOpenChat: (agent: Agent | string) => void; motionIndex?: number }) {
  const Icon = device.type === "server" ? Box : device.type === "laptop" ? Monitor : Monitor;
  const agentCount = device.providers.reduce((total, provider) => total + provider.agents.length, 0);

  return (
    <article className="device-card motion-card" style={motionDelay(motionIndex)}>
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
          <ProviderBlock provider={provider} key={provider.id} selectorSettings={selectorSettings} artRuntime={artRuntime} onOpenChat={onOpenChat} />
        ))}
      </div>

      <footer className="device-card-footer">
        <span>{device.status === "online" ? "Last seen: now" : agentCount > 0 ? "Last seen: 1m ago" : "Last seen: 2 days ago"}</span>
        <MoreHorizontal size={18} />
      </footer>
    </article>
  );
}

function ProviderBlock({ provider, selectorSettings, artRuntime, onOpenChat }: { provider: Provider; selectorSettings: ReikaAgentSelectorSettings; artRuntime: ArtRuntime; onOpenChat: (agent: Agent | string) => void }) {
  return (
    <section className="provider-block">
      <header>
        <img src={assets.icons.providers[provider.name]} alt="" />
        <strong>{provider.name}</strong>
        <span>{provider.agents.length} {provider.agents.length === 1 ? "agent" : "agents"}</span>
      </header>
      <div className="provider-agents">
        {provider.agents.length > 0 ? (
          provider.agents.map((agent, index) => {
            const avatar = getAgentAvatarRender(agent, artRuntime);
            return (
              <button className="agent-row motion-row" data-testid={`agent-row-${agent.id}`} key={agent.id} onClick={() => onOpenChat(agent)} style={motionDelay(index, 34, 80)}>
                <img src={avatar.src} alt="" style={avatar.style} />
                <span>
                  <strong>{formatAgentDisplayName(agent.name, agent.role, selectorSettings.showRole)}</strong>
                  <small>
                    <StatusDot status={agent.status} />
                    {statusLabels[agent.status]}
                  </small>
                </span>
                <ChevronRight size={18} />
              </button>
            );
          })
        ) : (
          <div className="empty-agent-row">No agents available</div>
        )}
      </div>
    </section>
  );
}

function formatAgentDisplayName(name: string, role: unknown, showRole: boolean) {
  const baseName = String(name || "Agent").split(/\s+\/\s+/u)[0]?.trim() || "Agent";
  if (!showRole) return baseName;
  const roleText = String(role ?? "").trim();
  if (!roleText || roleText.toLowerCase() === baseName.toLowerCase() || /^(agent|assistant)$/iu.test(roleText)) return String(name || baseName);
  return `${baseName} / ${roleText}`;
}
