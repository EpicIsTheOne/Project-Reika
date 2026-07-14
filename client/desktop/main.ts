import { app, BrowserWindow, session, shell } from "electron";
import { join } from "node:path";
import { startDesktopServer, type DesktopServer } from "./localServer.js";
import { ensureLocalAgent, stopLocalAgent, type LocalAgentRuntime } from "./localAgent.js";
import { migrateLegacyUserData } from "./userDataMigration.js";
import { getDesktopSecret, registerVoiceRuntime, saveDesktopSecret } from "./voiceRuntime.js";

const isDev = (process.env.REIKA_DESKTOP_DEV ?? process.env.AGENTHUB_DESKTOP_DEV) === "1";

let desktopServer: DesktopServer | undefined;
let localAgent: LocalAgentRuntime | undefined;
let mainWindow: BrowserWindow | undefined;

async function createWindow() {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "assets/brand/reika_app_icon.png")
    : join(__dirname, "../assets/reika_phase1/brand/reika_app_icon.png");
  const preload = join(__dirname, "preload.cjs");

  mainWindow = new BrowserWindow({
    width: 1540,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#020813",
    title: "Reika",
    icon: iconPath,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  });

  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    if (!isAllowedCommandCenterUrl(params.src)) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL();
    if (!currentUrl || new URL(url).origin !== new URL(currentUrl).origin) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:") void shell.openExternal(parsed.toString());
    } catch {
      // Reject malformed external URLs.
    }
    return { action: "deny" };
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.REIKA_DESKTOP_DEV_URL ?? process.env.AGENTHUB_DESKTOP_DEV_URL ?? "http://127.0.0.1:5173");
    return;
  }

  const distDir = app.isPackaged
    ? join(process.resourcesPath, "client-dist")
    : join(__dirname, "../dist");
  localAgent = await ensureLocalAgent({
    target: process.env.REIKA_NODE_TARGET ?? process.env.AGENTHUB_AGENT_TARGET,
    waitMs: 10000
  });

  desktopServer = await startDesktopServer({
    distDir,
    port: Number(process.env.REIKA_DESKTOP_PORT ?? process.env.AGENTHUB_DESKTOP_PORT ?? 0) || 0,
    agentTarget: localAgent.url,
    recoverAgentTarget: recoverLocalAgent,
    relayTarget: process.env.REIKA_RELAY_TARGET ?? process.env.AGENTHUB_RELAY_TARGET,
    apiTarget: process.env.REIKA_API_TARGET ?? process.env.AGENTHUB_API_TARGET
  });
  await mainWindow.loadURL(desktopServer.url);
}

async function recoverLocalAgent() {
  if (localAgent?.started) stopLocalAgent();
  localAgent = await ensureLocalAgent({
    target: process.env.REIKA_NODE_TARGET ?? process.env.AGENTHUB_AGENT_TARGET,
    waitMs: 10000
  });
  return localAgent.url;
}

app.setName("Reika");

app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "webview") return;
  contents.on("will-navigate", (event, url) => {
    if (!isAllowedCommandCenterUrl(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});

function isAllowedCommandCenterUrl(value: string) {
  try {
    const url = new URL(value);
    return url.origin === "https://techexplore.us" && url.pathname.startsWith("/commandcenter");
  } catch {
    return false;
  }
}

app.whenReady().then(async () => {
  migrateLegacyUserData(app.getPath("appData"), app.getPath("userData"));
  registerVoiceRuntime();
  await configureCommandCenterSession();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

async function configureCommandCenterSession() {
  const partition = session.fromPartition("persist:reika-command-center");
  const provisionedToken = String(process.env.REIKA_COMMANDCENTER_EMBED_TOKEN || "").trim();
  if (provisionedToken) {
    await saveDesktopSecret("commandCenterEmbed", provisionedToken);
    delete process.env.REIKA_COMMANDCENTER_EMBED_TOKEN;
  }
  partition.webRequest.onBeforeSendHeaders(
    { urls: ["https://techexplore.us/commandcenter/api/auth/reika"] },
    async (details, callback) => {
      try {
        const token = await getDesktopSecret("commandCenterEmbed", "Command Center integration");
        callback({ requestHeaders: { ...details.requestHeaders, "X-Reika-Embed-Token": token } });
      } catch {
        callback({ requestHeaders: details.requestHeaders });
      }
    }
  );
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void desktopServer?.close();
  if (localAgent?.started) stopLocalAgent();
});
