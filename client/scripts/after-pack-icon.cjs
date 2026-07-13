const { existsSync, readdirSync } = require("node:fs");
const { homedir } = require("node:os");
const { join, resolve } = require("node:path");
const { execFileSync } = require("node:child_process");

exports.default = async function afterPackIcon(context) {
  if (context.electronPlatformName !== "win32") return;

  const iconPath = resolve(context.packager.projectDir, "assets", "reika_phase1", "brand", "reika_app_icon.ico");
  const exePath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const version = context.packager.appInfo.version;
  const rceditPath = findRcedit();

  if (!existsSync(iconPath)) throw new Error(`Reika icon not found: ${iconPath}`);
  if (!existsSync(exePath)) throw new Error(`Packaged Reika executable not found: ${exePath}`);
  if (!rceditPath) throw new Error("rcedit-x64.exe was not found in the electron-builder cache.");

  execFileSync(rceditPath, [
    exePath,
    "--set-icon", iconPath,
    "--set-file-version", version,
    "--set-product-version", version,
    "--set-version-string", "ProductName", "Reika",
    "--set-version-string", "FileDescription", "An operating system for AI agents.",
    "--set-version-string", "CompanyName", "Project Reika",
    "--set-version-string", "InternalName", "Reika",
    "--set-version-string", "OriginalFilename", "Reika.exe"
  ], { stdio: "inherit" });
};

function findRcedit() {
  const cacheRoot = join(homedir(), "AppData", "Local", "electron-builder", "Cache", "winCodeSign");
  if (!existsSync(cacheRoot)) return undefined;

  const candidates = [];
  for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(cacheRoot, entry.name, "rcedit-x64.exe");
    if (existsSync(file)) candidates.push(file);
  }

  candidates.sort();
  return candidates.at(-1);
}
