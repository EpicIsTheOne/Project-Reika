import { createElement, useEffect, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { pageMotionClass } from "../../lib/motion";

const commandCenterUrl = "https://techexplore.us/commandcenter/";

type CommandCenterWebview = HTMLElement & {
  reload: () => void;
  getURL: () => string;
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
};

export function CommandCenterView() {
  const webviewRef = useRef<CommandCenterWebview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    const started = () => { setLoading(true); setError(null); };
    const finished = () => { setLoading(false); setError(null); };
    const failed = (event: Event) => {
      const detail = event as Event & { errorDescription?: string; validatedURL?: string; errorCode?: number };
      if (detail.errorCode === -3) return;
      setLoading(false);
      setError(detail.errorDescription || "Command Center could not be loaded.");
    };
    webview.addEventListener("did-start-loading", started);
    webview.addEventListener("did-stop-loading", finished);
    webview.addEventListener("did-fail-load", failed);
    return () => {
      webview.removeEventListener("did-start-loading", started);
      webview.removeEventListener("did-stop-loading", finished);
      webview.removeEventListener("did-fail-load", failed);
    };
  }, []);

  const openExternal = () => {
    window.open(webviewRef.current?.getURL() || commandCenterUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <main className={pageMotionClass("command-center-native-page")}>
      <header className="command-center-native-toolbar">
        <span><strong>Command Center</strong><small>Native UI · Reika relay roster enabled</small></span>
        <div>
          <button className="icon-button" type="button" title="Reload Command Center" onClick={() => webviewRef.current?.reload()}><RefreshCw size={18} /></button>
          <button className="icon-button" type="button" title="Open Command Center in browser" onClick={openExternal}><ExternalLink size={18} /></button>
        </div>
      </header>
      <section className="command-center-native-frame">
        {createElement("webview", {
          ref: webviewRef,
          src: commandCenterUrl,
          partition: "persist:reika-command-center",
          webpreferences: "contextIsolation=yes,nodeIntegration=no,sandbox=yes",
          className: "command-center-webview"
        })}
        {loading ? <div className="command-center-native-state"><LoaderCircle className="spin" size={30} /><span>Loading Command Center…</span></div> : null}
        {error ? <div className="command-center-native-state error"><strong>Command Center unavailable</strong><span>{error}</span><button className="secondary-action small" onClick={() => webviewRef.current?.reload()}>Try again</button></div> : null}
      </section>
    </main>
  );
}
