import { createElement, useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { pageMotionClass } from "../../lib/motion";

type CommandCenterWebview = HTMLElement & {
  reload: () => void;
  getURL: () => string;
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
};

export function CommandCenterView() {
  const webviewRef = useRef<CommandCenterWebview | null>(null);
  const [commandCenterUrl, setCommandCenterUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.reikaDesktop?.commandCenter?.url()
      .then((url) => {
        if (!url) throw new Error("The local Command Center runtime is unavailable.");
        setCommandCenterUrl(url);
      })
      .catch((cause) => {
        setLoading(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, []);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !commandCenterUrl) return;
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
  }, [commandCenterUrl]);

  return (
    <main className={pageMotionClass("command-center-native-page")}>
      <header className="command-center-native-toolbar">
        <span><strong>Command Center</strong><small>Local runtime · Reika roster enabled</small></span>
        <div>
          <button className="icon-button" type="button" title="Reload Command Center" onClick={() => webviewRef.current?.reload()}><RefreshCw size={18} /></button>
        </div>
      </header>
      <section className="command-center-native-frame">
        {commandCenterUrl ? createElement("webview", {
          ref: webviewRef,
          src: commandCenterUrl,
          partition: "persist:reika-command-center",
          webpreferences: "contextIsolation=yes,nodeIntegration=no,sandbox=yes",
          className: "command-center-webview"
        }) : null}
        {loading ? <div className="command-center-native-state"><LoaderCircle className="spin" size={30} /><span>Loading Command Center…</span></div> : null}
        {error ? <div className="command-center-native-state error"><strong>Command Center unavailable</strong><span>{error}</span><button className="secondary-action small" onClick={() => webviewRef.current?.reload()}>Try again</button></div> : null}
      </section>
    </main>
  );
}
