const DEFAULT_REIKA_RELAY_DEVICE_URL = "wss://relay.techexplore.us/v1/device";
const INSTALL_SCRIPT_URL = "https://raw.githubusercontent.com/EpicIsTheOne/Project-Reika/main/server/scripts/install-linux.sh";

export const reikaRelayDeviceUrl = readRelayDeviceUrl();
export const reikaRelayHttpBaseUrl = deriveRelayUrl(reikaRelayDeviceUrl, "http", "");
export const reikaRelayAppWebSocketUrl = deriveRelayUrl(reikaRelayDeviceUrl, "ws", "app");

export function relayApiUrl(path: string) {
  return `${reikaRelayHttpBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export function linuxInstallCommand(pairingCode: string) {
  return `curl -fsSL ${INSTALL_SCRIPT_URL} | bash -s -- --code ${pairingCode} --relay ${reikaRelayDeviceUrl}`;
}

function readRelayDeviceUrl() {
  const configured = import.meta.env.VITE_REIKA_RELAY_URL;
  return typeof configured === "string" && configured.trim() ? configured.trim() : DEFAULT_REIKA_RELAY_DEVICE_URL;
}

function deriveRelayUrl(deviceRelayUrl: string, target: "http" | "ws", endpoint: "" | "app") {
  const url = new URL(deviceRelayUrl);
  const basePath = url.pathname.replace(/\/device\/?$/u, "").replace(/\/+$/u, "");

  url.protocol = target === "http" ? (url.protocol === "wss:" ? "https:" : "http:") : url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = endpoint ? `${basePath}/${endpoint}` : basePath || "/";
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/$/u, "");
}
