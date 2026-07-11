import type { ReactNode } from "react";
import { Crown, LogOut, Sun } from "lucide-react";
import { navItems, statusLabels } from "../app/constants";
import type { BackendMode } from "../app/types";
import { assets } from "../data/assets";
import type { ArtRuntime } from "../lib/artRuntime";
import { cx, motionDelay } from "../lib/motion";
import type { View } from "../types";
import { StatusDot } from "./status";

export function AppShell({
  activeView,
  backendMode,
  notificationCount,
  artRuntime,
  onNavigate,
  children
}: {
  activeView: View;
  backendMode: BackendMode;
  notificationCount: number;
  artRuntime: ArtRuntime;
  onNavigate: (view: View) => void;
  children: ReactNode;
}) {
  return (
    <div className={cx("shell", `shell-${activeView}`)}>
      <aside className="sidebar">
        <button className="brand-lockup" onClick={() => onNavigate("home")} aria-label="Go home">
          <img src={assets.brand.logoSmall} alt="" />
          <span>
            <strong>AGENTHUB</strong>
            <small>Your AI Agents. One Hub.</small>
          </span>
        </button>

        <nav className="nav-list" aria-label="Primary">
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const active = activeView === item.route;
            return (
              <button className={cx("nav-item", active && "active")} key={item.label} aria-label={item.label} onClick={() => onNavigate(item.route)} style={motionDelay(index, 38)}>
                <Icon size={22} />
                <span>{item.label}</span>
                {item.route === "notifications" && notificationCount > 0 ? <strong>{notificationCount}</strong> : null}
              </button>
            );
          })}
        </nav>

        <div className="account-card">
          <img src={artRuntime.agentAvatar("reika", "account-card")} alt="" />
          <span>
            <strong>Local profile</strong>
            <small>Stored on this device</small>
          </span>
          <button className="plan-button" disabled title="Plans are not wired in this local build.">
            <Crown size={14} />
            Local only
          </button>
        </div>

        <div className="sidebar-tools">
          <button className="icon-button" aria-label="Appearance settings" onClick={() => onNavigate("settings")}>
            <Sun size={20} />
          </button>
          <button className="icon-button" aria-label="Backend status" onClick={() => onNavigate("settings")} title={`Backend: ${statusLabels[backendMode === "live" ? "online" : backendMode === "loading" ? "connecting" : "offline"]}`}>
            <StatusDot status={backendMode === "live" ? "online" : backendMode === "loading" ? "connecting" : "offline"} />
          </button>
          <button className="icon-button" aria-label="Sign out unavailable" disabled title="Accounts are not implemented in local Phase 1.">
            <LogOut size={20} />
          </button>
        </div>
      </aside>

      <section className="page-shell">
        <div className="view-motion-frame" key={activeView}>
          {children}
        </div>
      </section>
    </div>
  );
}
