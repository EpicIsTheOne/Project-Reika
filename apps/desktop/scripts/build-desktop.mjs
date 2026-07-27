import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const outdir = resolve(root, "dist-desktop");
mkdirSync(outdir, { recursive: true });

await Promise.all([
  build({
    entryPoints: [resolve(root, "electron/main.ts")],
    outfile: resolve(outdir, "main.cjs"),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    external: ["electron"],
    sourcemap: true
  }),
  build({
    entryPoints: [resolve(root, "electron/preload.ts")],
    outfile: resolve(outdir, "preload.cjs"),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    external: ["electron"],
    sourcemap: true
  })
]);
