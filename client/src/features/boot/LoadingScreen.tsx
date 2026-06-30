import { Activity, ChevronRight, Heart } from "lucide-react";
import { assets } from "../../data/assets";
import type { ArtRuntime } from "../../lib/artRuntime";
import type { BackendMode, BootStep } from "../../app/types";

export function LoadingScreen({
  steps,
  ready,
  mode,
  error,
  artRuntime,
  artReady,
  onEnter
}: {
  steps: BootStep[];
  ready: boolean;
  mode: BackendMode;
  error: string | null;
  artRuntime: ArtRuntime;
  artReady: boolean;
  onEnter: () => void;
}) {
  const doneCount = steps.filter((step) => step.state === "done").length;
  const completeCount = steps.filter((step) => step.state === "done" || step.state === "error").length;
  const progress = Math.max(8, Math.round((completeCount / Math.max(steps.length, 1)) * 100));
  const activeStep = steps.find((step) => step.state === "active") ?? [...steps].reverse().find((step) => step.state === "done") ?? steps[0];
  const systemStatus =
    mode === "fallback" ? "Fallback mode active" : mode === "live" ? "All systems nominal" : activeStep?.detail ?? "Scanning local providers";
  const backgroundUrl = artReady
    ? artRuntime.agentArt("reika", "loading-screen", artRuntime.globalArt("global-loading", assets.loading.bootBackdrop, "loading-backdrop-global"), "loading-backdrop")
    : "";

  return (
    <main className="loading-screen">
      {backgroundUrl ? <img className="loading-bg" src={backgroundUrl} alt="" /> : null}
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
