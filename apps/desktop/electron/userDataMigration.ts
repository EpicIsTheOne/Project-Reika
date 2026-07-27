import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function migrateLegacyUserData(appDataDir: string, reikaUserDataDir: string, legacyName = "AgentHub") {
  const legacyUserDataDir = join(appDataDir, legacyName);
  const markerPath = join(reikaUserDataDir, ".reika-migration.json");
  if (existsSync(markerPath) || !existsSync(legacyUserDataDir)) return false;

  if (existsSync(reikaUserDataDir)) {
    cpSync(legacyUserDataDir, reikaUserDataDir, {
      recursive: true,
      errorOnExist: false,
      force: false,
      preserveTimestamps: true
    });
    writeMigrationMarker(markerPath, legacyName);
    console.info(`[Reika] Imported missing files from legacy ${legacyName} user data. Existing Reika files were preserved and the legacy directory remains available as a rollback copy.`);
    return true;
  }

  const stagingDir = `${reikaUserDataDir}.migration-${process.pid}`;
  try {
    mkdirSync(stagingDir, { recursive: false });
    cpSync(legacyUserDataDir, stagingDir, {
      recursive: true,
      errorOnExist: false,
      force: false,
      preserveTimestamps: true
    });
    writeMigrationMarker(join(stagingDir, ".reika-migration.json"), legacyName);
    renameSync(stagingDir, reikaUserDataDir);
    console.info(`[Reika] Migrated legacy ${legacyName} user data to the Reika data directory. The legacy directory was retained as a rollback copy.`);
    return true;
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw new Error(`Reika could not migrate legacy user data: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeMigrationMarker(markerPath: string, legacyName: string) {
  writeFileSync(
    markerPath,
    `${JSON.stringify({ source: legacyName, migratedAt: new Date().toISOString(), policy: "copy-missing-only" }, null, 2)}\n`,
    "utf8"
  );
}
