import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("agentHubDesktop", {
  platform: process.platform,
  version: process.env.npm_package_version ?? "0.1.0"
});
