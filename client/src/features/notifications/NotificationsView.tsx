import { useEffect, useMemo, useState } from "react";
import { Activity, Bot, Box, Check, CheckCircle2, ChevronDown, Database, Heart, MessageCircle, MoreHorizontal, Trash2, TriangleAlert } from "lucide-react";
import { DetailRow } from "../../components/DetailRow";
import { StatusDot } from "../../components/status";
import { assets } from "../../data/assets";
import {
  deleteNotification,
  markAllNotificationsRead,
  markNotificationRead,
  type ReikaNotification
} from "../../lib/reikaApi";
import type { ArtRuntime } from "../../lib/artRuntime";
import { cx, motionDelay, pageMotionClass } from "../../lib/motion";

type NotificationTagTone = "blue" | "green" | "purple" | "orange" | "gray";

export function NotificationsView({
  notifications,
  artRuntime,
  onRefresh,
  onUpdateNotifications,
  onOpenChat
}: {
  notifications: ReikaNotification[];
  artRuntime: ArtRuntime;
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
    <main className={pageMotionClass("page notifications-page")}>
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
          <button className="icon-button compact" aria-label="More notification actions unavailable" disabled title="More notification actions are not implemented yet.">
            <MoreHorizontal size={20} />
          </button>
        </div>
      </header>

      <div className="notifications-layout">
        <section className="notification-list-panel" aria-label="Notifications">
          {visibleItems.length > 0 ? visibleItems.map((item, index) => (
            <button
              className={cx("notification-row motion-row", item.id === selectedId && "selected")}
              key={item.id}
              onClick={() => selectNotification(item)}
              style={motionDelay(index, 36)}
            >
              {item.unread ? <span className="unread-dot" /> : null}
              <NotificationIcon item={item} artRuntime={artRuntime} />
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

        <NotificationDetailPanel item={selected} artRuntime={artRuntime} onOpenChat={onOpenChat} onDelete={removeSelected} />
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

function NotificationIcon({ item, artRuntime }: { item: ReikaNotification; artRuntime: ArtRuntime }) {
  return (
    <span className={`notification-icon accent-${item.tone}`}>
      <img src={notificationIcon(item, artRuntime)} alt="" />
      <em className={`notification-badge ${notificationBadge(item)}`}>
        {notificationBadge(item) === "check" ? <CheckCircle2 size={13} /> : notificationBadge(item) === "warning" ? <TriangleAlert size={13} /> : notificationBadge(item) === "heart" ? <Heart size={12} fill="currentColor" /> : <Activity size={12} />}
      </em>
    </span>
  );
}

function NotificationDetailPanel({ item, artRuntime, onOpenChat, onDelete }: { item: ReikaNotification | null; artRuntime: ArtRuntime; onOpenChat: () => void; onDelete: () => void }) {
  if (!item) {
    return (
      <aside className="notification-detail-panel motion-surface">
        <section className="notification-detail-content">
          <img className="empty-state-art" src={artRuntime.agentArt("reika", "chibi-small", artRuntime.globalArt("global-empty-states", assets.empty.noChat, "notifications-empty-global"), "notifications-empty")} alt="" />
          <h2>No notification selected</h2>
          <p>The inbox is quiet.</p>
        </section>
      </aside>
    );
  }

  return (
    <aside className="notification-detail-panel motion-surface" key={item.id}>
      <div className="notification-detail-hero">
        <img src={artRuntime.agentArt("reika", item.kind === "warning" ? "offline-error" : "hero-banner", assets.room.hero, `notification-${item.id}`)} alt="" />
        <span>
          <StatusDot status="online" />
          Online
        </span>
      </div>

      <section className="notification-detail-content">
        <h2>{item.title}</h2>
        <time>{absoluteTime(item.createdAt)}</time>
        <p>{item.body}</p>

        <div className="notification-info-card">
          <DetailRow label="Type" value={notificationTag(item)} icon={Bot} />
          <DetailRow label="Time" value={absoluteTime(item.createdAt)} icon={Activity} />
          <DetailRow label="Source" value={item.source} icon={Box} />
          <button onClick={onOpenChat}>View Profile</button>
        </div>

        <section className="quick-actions">
          <h3>Quick Actions</h3>
          <button className="primary-action" onClick={onOpenChat}>
            <MessageCircle size={20} />
            Start Chat with Reika
          </button>
          <button className="secondary-action" disabled title="Memory browsing is not implemented yet.">
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

function notificationTagTone(item: ReikaNotification): NotificationTagTone {
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

function notificationIcon(item: ReikaNotification, artRuntime: ArtRuntime) {
  if (item.kind === "provider") {
    const source = item.source.toLowerCase();
    if (source.includes("openclaw")) return assets.icons.providers.OpenClaw;
    if (source.includes("command")) return assets.icons.providers.CommandCenter;
    if (source.includes("mock")) return assets.icons.providers.Mock;
    return assets.icons.providers.Hermes;
  }
  if (item.kind === "device") return assets.icons.devices.pc;
  if (item.kind === "file") return assets.brand.logoSmall;
  if (item.kind === "warning") return artRuntime.agentArt("reika", "offline-error", assets.icons.devices.server, `warning-${item.id}`);
  return artRuntime.agentArt("reika", "notifications", artRuntime.agentPortrait("reika", `notification-fallback-${item.id}`), `notification-icon-${item.id}`);
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
