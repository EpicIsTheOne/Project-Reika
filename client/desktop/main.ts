import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { startDesktopServer, type DesktopServer } from "./localServer.js";
import { ensureLocalAgent, stopLocalAgent, type LocalAgentRuntime } from "./localAgent.js";
import { migrateLegacyUserData } from "./userDataMigration.js";
import { registerVoiceRuntime } from "./voiceRuntime.js";

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
      sandbox: true
    }
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

app.whenReady().then(async () => {
  migrateLegacyUserData(app.getPath("appData"), app.getPath("userData"));
  registerVoiceRuntime();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void desktopServer?.close();
  if (localAgent?.started) stopLocalAgent();
});
