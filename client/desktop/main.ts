import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import { join } from "node:path";
import { startDesktopServer, type DesktopServer } from "./localServer.js";
import { ensureLocalAgent, getLocalAgentExecutablePath, stopLocalAgent, stopLocalAgentAndWait, type LocalAgentRuntime } from "./localAgent.js";
import { rebuildAgentFromCheckout } from "./agentMaintenance.js";
import { migrateLegacyUserData } from "./userDataMigration.js";
import { registerVoiceRuntime } from "./voiceRuntime.js";
import { ensureLocalCommandCenter, stopLocalCommandCenter, type LocalCommandCenterRuntime } from "./localCommandCenter.js";

const isDev = (process.env.REIKA_DESKTOP_DEV ?? process.env.AGENTHUB_DESKTOP_DEV) === "1";

let desktopServer: DesktopServer | undefined;
let localAgent: LocalAgentRuntime | undefined;
let commandCenter: LocalCommandCenterRuntime | undefined;
let mainWindow: BrowserWindow | undefined;
let agentMaintenance: Promise<{ message: string; logPath: string }> | undefined;

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
  commandCenter = await ensureLocalCommandCenter(localAgent.url);
  configureCommandCenterSession(commandCenter.url, commandCenter.embedToken);

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

async function rebuildAndRestartLocalAgent() {
  if (agentMaintenance) return agentMaintenance;
  agentMaintenance = performAgentMaintenance().finally(() => {
    agentMaintenance = undefined;
  });
  return agentMaintenance;
}

async function performAgentMaintenance() {
  if (!localAgent) throw new Error("Rebuild and restart is available in the packaged Reika desktop app.");
  if (!localAgent.started) throw new Error("This agent is managed outside Reika, so Reika cannot safely replace or restart it.");

  const target = localAgent.url;
  const targetAgentPath = getLocalAgentExecutablePath();
  await stopLocalAgentAndWait();
  let rebuildResult: Awaited<ReturnType<typeof rebuildAgentFromCheckout>> | undefined;
  let rebuildError: unknown;
  try {
    rebuildResult = await rebuildAgentFromCheckout(targetAgentPath);
  } catch (error) {
    rebuildError = error;
  }

  localAgent = await ensureLocalAgent({ target, exePath: targetAgentPath, waitMs: 12_000 });
  if (!await localAgentIsHealthy(target)) {
    throw new Error("Agent restart did not become healthy. Check the Reika node and agent rebuild logs.");
  }
  if (rebuildError) {
    const message = rebuildError instanceof Error ? rebuildError.message : String(rebuildError);
    throw new Error(`${message} The previous agent was restarted.`);
  }
  return {
    message: "Agent rebuilt and restarted successfully.",
    logPath: rebuildResult?.logPath ?? ""
  };
}

async function localAgentIsHealthy(url: string) {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
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
    return Boolean(commandCenter) && url.origin === new URL(commandCenter.url).origin;
  } catch {
    return false;
  }
}

app.whenReady().then(async () => {
  migrateLegacyUserData(app.getPath("appData"), app.getPath("userData"));
  registerVoiceRuntime();
  ipcMain.handle("reika-command-center:url", () => commandCenter?.url || "");
  ipcMain.handle("reika-agent:rebuild-and-restart", () => rebuildAndRestartLocalAgent());
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

function configureCommandCenterSession(commandCenterUrl: string, embedToken: string) {
  const partition = session.fromPartition("persist:reika-command-center");
  const authUrl = new URL("api/auth/reika", commandCenterUrl).toString();
  partition.webRequest.onBeforeSendHeaders(
    { urls: [authUrl] },
    (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, "X-Reika-Embed-Token": embedToken } });
    }
  );
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void desktopServer?.close();
  stopLocalCommandCenter();
  if (localAgent?.started) stopLocalAgent();
});
