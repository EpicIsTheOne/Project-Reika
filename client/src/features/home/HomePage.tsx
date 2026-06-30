import { useState, type ReactNode } from "react";
import { Bell, Box, ChevronRight, Heart, MessageCircle, Monitor, MoreHorizontal, Plus, Search } from "lucide-react";
import { statusLabels } from "../../app/constants";
import type { BackendMode } from "../../app/types";
import { assets } from "../../data/assets";
import { deviceMatchesQuery, getAgentAvatar } from "../../domain/reikaMappers";
import type { ArtRuntime } from "../../lib/artRuntime";
import { motionDelay, pageMotionClass } from "../../lib/motion";
import type { Device, Provider } from "../../types";
import { StatusDot, StatusPill } from "../../components/status";

export function HomePage({
  devices,
  backendMode,
  artRuntime,
  onOpenNotifications,
  onAddDevice,
  onOpenChat
}: {
  devices: Device[];
  backendMode: BackendMode;
  artRuntime: ArtRuntime;
  onScanProviders: () => void;
  onOpenNotifications: () => void;
  onAddDevice: () => void;
  onOpenChat: (agentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleDevices = normalizedQuery ? devices.filter((device) => deviceMatchesQuery(device, normalizedQuery)) : devices;
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
        <img src={artRuntime.agentArt("reika", "hero-banner", assets.room.hero, "home-hero")} alt="" />
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
            <button className="secondary-action" onClick={() => onOpenChat("reika")}>
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
          <DeviceCard device={device} key={device.id} artRuntime={artRuntime} onOpenChat={onOpenChat} motionIndex={index} />
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

function DeviceCard({ device, artRuntime, onOpenChat, motionIndex = 0 }: { device: Device; artRuntime: ArtRuntime; onOpenChat: (agentId: string) => void; motionIndex?: number }) {
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
          <ProviderBlock provider={provider} key={provider.id} artRuntime={artRuntime} onOpenChat={onOpenChat} />
        ))}
      </div>

      <footer className="device-card-footer">
        <span>{device.status === "online" ? "Last seen: now" : agentCount > 0 ? "Last seen: 1m ago" : "Last seen: 2 days ago"}</span>
        <MoreHorizontal size={18} />
      </footer>
    </article>
  );
}

function ProviderBlock({ provider, artRuntime, onOpenChat }: { provider: Provider; artRuntime: ArtRuntime; onOpenChat: (agentId: string) => void }) {
  return (
    <section className="provider-block">
      <header>
        <img src={assets.icons.providers[provider.name]} alt="" />
        <strong>{provider.name}</strong>
        <span>{provider.agents.length} {provider.agents.length === 1 ? "agent" : "agents"}</span>
      </header>
      <div className="provider-agents">
        {provider.agents.length > 0 ? (
          provider.agents.map((agent, index) => (
            <button className="agent-row motion-row" key={agent.id} onClick={() => onOpenChat(agent.id)} style={motionDelay(index, 34, 80)}>
              <img src={getAgentAvatar(agent, artRuntime)} alt="" />
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
