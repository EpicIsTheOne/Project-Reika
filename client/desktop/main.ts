import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { startDesktopServer, type DesktopServer } from "./localServer.js";

const isDev = process.env.AGENTHUB_DESKTOP_DEV === "1";

let desktopServer: DesktopServer | undefined;
let mainWindow: BrowserWindow | undefined;

async function createWindow() {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "assets/brand/agenthub_app_icon.png")
    : join(__dirname, "../assets/agenthub_phase1/brand/agenthub_app_icon.png");
  const preload = join(__dirname, "preload.cjs");

  mainWindow = new BrowserWindow({
    width: 1540,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#020813",
    title: "AgentHub",
    icon: iconPath,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.AGENTHUB_DESKTOP_DEV_URL ?? "http://127.0.0.1:5173");
    return;
  }

  const distDir = app.isPackaged
    ? join(process.resourcesPath, "client-dist")
    : join(__dirname, "../dist");

  desktopServer = await startDesktopServer({
    distDir,
    port: Number(process.env.AGENTHUB_DESKTOP_PORT ?? 0) || 0,
    agentTarget: process.env.AGENTHUB_AGENT_TARGET,
    relayTarget: process.env.AGENTHUB_RELAY_TARGET,
    apiTarget: process.env.AGENTHUB_API_TARGET
  });
  await mainWindow.loadURL(desktopServer.url);
}

app.setName("AgentHub");

app.whenReady().then(async () => {
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
});
