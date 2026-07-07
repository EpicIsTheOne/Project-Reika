const DEFAULT_REIKA_RELAY_DEVICE_URL = "wss://relay.techexplore.us/v1/device";
const INSTALL_SCRIPT_URL = "https://raw.githubusercontent.com/EpicIsTheOne/Project-Reika/main/server/scripts/install-linux.sh";

export const defaultReikaRelayDeviceUrl = readRelayDeviceUrl();

export function normalizeRelayDeviceUrl(value?: string) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : defaultReikaRelayDeviceUrl;
  try {
    const url = new URL(raw);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return defaultReikaRelayDeviceUrl;
    return raw;
  } catch {
    return defaultReikaRelayDeviceUrl;
  }
}

export function relayApiUrl(path: string, relayDeviceUrl?: string) {
  const relayHttpBaseUrl = deriveRelayUrl(normalizeRelayDeviceUrl(relayDeviceUrl), "http", "");
  return `${relayHttpBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export function relayAppWebSocketUrl(relayDeviceUrl?: string) {
  return deriveRelayUrl(normalizeRelayDeviceUrl(relayDeviceUrl), "ws", "app");
}

export function sameOriginRelayAppWebSocketUrl() {
  if (typeof window === "undefined") return undefined;
  const url = new URL("/v1/app", window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString().replace(/\/$/u, "");
}

export function relayDeviceWebSocketUrl(relayDeviceUrl?: string) {
  return deriveRelayUrl(normalizeRelayDeviceUrl(relayDeviceUrl), "ws", "device");
}

export function linuxInstallCommand(pairingCode: string, relayDeviceUrl?: string) {
  return `curl -fsSL ${INSTALL_SCRIPT_URL} | bash -s -- --code ${pairingCode} --relay ${normalizeRelayDeviceUrl(relayDeviceUrl)}`;
}

function readRelayDeviceUrl() {
  const configured = import.meta.env.VITE_REIKA_RELAY_URL;
  return typeof configured === "string" && configured.trim() ? configured.trim() : DEFAULT_REIKA_RELAY_DEVICE_URL;
}

function deriveRelayUrl(deviceRelayUrl: string, target: "http" | "ws", endpoint: "" | "app" | "device") {
  const url = new URL(deviceRelayUrl);
  const basePath = url.pathname.replace(/\/device\/?$/u, "").replace(/\/+$/u, "");

  url.protocol = target === "http" ? (url.protocol === "wss:" ? "https:" : "http:") : url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = endpoint ? `${basePath}/${endpoint}` : basePath || "/";
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/$/u, "");
}
