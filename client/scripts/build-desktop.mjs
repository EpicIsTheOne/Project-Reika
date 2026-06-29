import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const outdir = resolve("dist-desktop");
mkdirSync(outdir, { recursive: true });

await Promise.all([
  build({
    entryPoints: ["desktop/main.ts"],
    outfile: "dist-desktop/main.cjs",
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    external: ["electron"],
    sourcemap: true
  }),
  build({
    entryPoints: ["desktop/preload.ts"],
    outfile: "dist-desktop/preload.cjs",
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    external: ["electron"],
    sourcemap: true
  })
]);
