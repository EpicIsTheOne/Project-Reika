import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacyUserData } from "../desktop/userDataMigration";

const root = mkdtempSync(join(tmpdir(), "reika-user-data-migration-"));

try {
  const appData = join(root, "AppData");
  const legacy = join(appData, "AgentHub");
  const reika = join(appData, "Reika");
  mkdirSync(join(legacy, "data"), { recursive: true });
  writeFileSync(join(legacy, "settings.json"), '{"theme":"blue"}\n');
  writeFileSync(join(legacy, "data", "memory-mesh.sqlite"), "legacy-mesh");

  assert.equal(migrateLegacyUserData(appData, reika), true);
  assert.equal(readFileSync(join(reika, "settings.json"), "utf8"), '{"theme":"blue"}\n');
  assert.equal(readFileSync(join(reika, "data", "memory-mesh.sqlite"), "utf8"), "legacy-mesh");
  assert.equal(readFileSync(join(legacy, "data", "memory-mesh.sqlite"), "utf8"), "legacy-mesh");

  writeFileSync(join(reika, "settings.json"), '{"theme":"contrast"}\n');
  writeFileSync(join(legacy, "settings.json"), '{"theme":"dark"}\n');
  assert.equal(migrateLegacyUserData(appData, reika), false);
  assert.equal(readFileSync(join(reika, "settings.json"), "utf8"), '{"theme":"contrast"}\n');

  const precreatedAppData = join(root, "PrecreatedAppData");
  const precreatedLegacy = join(precreatedAppData, "AgentHub");
  const precreatedReika = join(precreatedAppData, "Reika");
  mkdirSync(join(precreatedLegacy, "data"), { recursive: true });
  mkdirSync(join(precreatedReika, "Cache"), { recursive: true });
  writeFileSync(join(precreatedLegacy, "data", "sessions.sqlite"), "legacy-sessions");
  writeFileSync(join(precreatedLegacy, "Preferences"), "legacy-preferences");
  writeFileSync(join(precreatedReika, "Preferences"), "new-preferences");
  assert.equal(migrateLegacyUserData(precreatedAppData, precreatedReika), true);
  assert.equal(readFileSync(join(precreatedReika, "data", "sessions.sqlite"), "utf8"), "legacy-sessions");
  assert.equal(readFileSync(join(precreatedReika, "Preferences"), "utf8"), "new-preferences");
  assert.equal(migrateLegacyUserData(precreatedAppData, precreatedReika), false);
  console.log("Reika user-data migration checks passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
