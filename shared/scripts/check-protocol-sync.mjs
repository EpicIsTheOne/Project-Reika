import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const copies = [
  ["shared/protocol/index.ts", "apps/desktop/src/shared/protocol/index.ts"],
  ["shared/protocol/index.ts", "Relay/src/shared/protocol/index.ts"],
  ["shared/agenthub.ts", "apps/desktop/src/shared/agenthub.ts"],
  ["shared/agenthub.ts", "Relay/src/shared/agenthub.ts"]
];

const mismatches = copies.filter(([from, to]) => readFileSync(resolve(root, from), "utf8") !== readFileSync(resolve(root, to), "utf8"));
if (mismatches.length > 0) {
  console.error("Shared protocol copies are out of sync:");
  for (const [, to] of mismatches) console.error(`- ${to}`);
  process.exit(1);
}
console.log("Shared protocol copies are in sync.");
