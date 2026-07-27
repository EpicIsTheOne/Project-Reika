import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const builder = JSON.parse(read("apps/desktop/electron-builder.json"));
assert.equal(builder.productName, "Reika");
assert.equal(builder.artifactName, "${productName} Setup ${version}.${ext}");
assert.equal(builder.nsis.shortcutName, "Reika");
assert(builder.files.includes("!dist-desktop/**/*.map"));
assert.equal(builder.appId, "dev.agenthub.reika", "The legacy app ID must remain stable for installed-app compatibility.");
assert(builder.extraResources.some((item) => item.to === "reika-node/reika-node.exe"));
assert(read("apps/desktop/electron/main.ts").includes('app.setName("Reika")'));
assert(read("apps/desktop/scripts/after-pack-icon.cjs").includes('"FileDescription", "An operating system for AI agents."'));
assert(read("apps/desktop/scripts/after-pack-icon.cjs").includes('"--set-product-version", version'));
assert(read("README.md").includes("## Product Naming"));

const visibleRoots = [
  "apps/desktop/src/features",
  "apps/desktop/src/components",
  "apps/desktop/index.html",
  "server/src/ui/pairingPage.ts",
  "server/src/cli/args.ts"
];
const visibleFiles = visibleRoots.flatMap((path) => collectTextFiles(join(root, path)));
const legacyVisible = visibleFiles.flatMap((path) =>
  readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .map((line, index) => ({ path, line, number: index + 1 }))
    .filter(({ line }) => /agent[ _-]?hub|agenthub/iu.test(line) && !line.includes("agenthub:relay-chat:"))
);
assert.deepEqual(legacyVisible, [], `Visible legacy branding remains in: ${legacyVisible.map((item) => `${item.path}:${item.number}`).join(", ")}`);

console.log("Reika branding and packaging contract checks passed.");

function collectTextFiles(path) {
  const stat = readdirSafe(path);
  if (!stat) return [path];
  return stat.flatMap((entry) => {
    const candidate = join(path, entry.name);
    if (entry.isDirectory()) return collectTextFiles(candidate);
    return [".ts", ".tsx", ".html"].includes(extname(entry.name)) ? [candidate] : [];
  });
}

function readdirSafe(path) {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return null;
  }
}
