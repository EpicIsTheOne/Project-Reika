import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(process.cwd(), "client", "assets", "agenthub_phase1_webp");
const files = walk(root).filter((path) => path.endsWith(".webp"));
if (files.length < 25) throw new Error(`Expected generated WebP catalog, found ${files.length} files.`);

for (const path of files) {
  const name = relative(root, path).replaceAll("\\", "/");
  const bytes = statSync(path).size;
  const thumbnail = name.startsWith("icons/") || name.endsWith("_256.webp") || name.includes("wordmark") || name.includes("progress_bar");
  const large = name.startsWith("room/") || name.startsWith("loading/") || name.startsWith("empty_states/") || name.includes("splash");
  const budget = thumbnail ? 100_000 : large ? 500_000 : 300_000;
  if (bytes > budget) throw new Error(`${name} exceeds its ${budget}-byte budget at ${bytes} bytes.`);
}

console.log(`webp asset budgets ok (${files.length} files)`);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
