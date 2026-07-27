import { copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const copies = [
  ["shared/protocol/index.ts", "apps/desktop/src/shared/protocol/index.ts"],
  ["shared/protocol/index.ts", "Relay/src/shared/protocol/index.ts"],
  ["shared/agenthub.ts", "apps/desktop/src/shared/agenthub.ts"],
  ["shared/agenthub.ts", "Relay/src/shared/agenthub.ts"]
];

for (const [from, to] of copies) copyFileSync(resolve(root, from), resolve(root, to));
console.log(`Synced ${copies.length} shared protocol files.`);
