import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const vite = spawn("npm", ["run", "dev:ui"], {
  shell: true,
  stdio: "inherit",
  env: { ...process.env, BROWSER: "none" }
});

let electron;

try {
  await waitForUrl("http://127.0.0.1:5173");
  await import(pathToFileURL(new URL("./build-desktop.mjs", import.meta.url)).href);
  electron = spawn("npx", ["electron", "."], {
    shell: true,
    stdio: "inherit",
    env: {
      ...process.env,
      REIKA_DESKTOP_DEV: "1",
      REIKA_DESKTOP_DEV_URL: "http://127.0.0.1:5173"
    }
  });
  electron.on("exit", (code) => {
    vite.kill();
    process.exit(code ?? 0);
  });
} catch (error) {
  vite.kill();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

process.on("SIGINT", () => {
  electron?.kill();
  vite.kill();
  process.exit(130);
});

async function waitForUrl(url) {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still warming up.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}
