import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { app } from "electron";

export interface AgentRebuildResult {
  sourceRoot: string;
  builtAgentPath: string;
  logPath: string;
}

export async function rebuildAgentFromCheckout(targetAgentPath: string): Promise<AgentRebuildResult> {
  const sourceRoot = findSourceRoot();
  if (!sourceRoot) {
    throw new Error("Project Reika source checkout was not found. Set REIKA_SOURCE_ROOT to the repository folder and restart Reika.");
  }

  const serverDir = join(sourceRoot, "server");
  const builtAgentPath = join(serverDir, "release", "reika-node.exe");
  const logPath = join(app.getPath("userData"), "logs", "agent-rebuild.log");
  mkdirSync(dirname(logPath), { recursive: true });
  await runAgentBuild(serverDir, logPath);
  if (!existsSync(builtAgentPath)) throw new Error(`Agent build completed without producing ${builtAgentPath}.`);

  if (resolve(builtAgentPath).toLowerCase() !== resolve(targetAgentPath).toLowerCase()) {
    mkdirSync(dirname(targetAgentPath), { recursive: true });
    copyFileSync(builtAgentPath, targetAgentPath);
  }

  return { sourceRoot, builtAgentPath, logPath };
}

function findSourceRoot() {
  const candidates = [
    process.env.REIKA_SOURCE_ROOT,
    resolve(app.getAppPath(), ".."),
    join(app.getPath("documents"), "Project Reika")
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) =>
    existsSync(join(candidate, "client", "package.json")) &&
    existsSync(join(candidate, "server", "package.json")) &&
    existsSync(join(candidate, "server", "scripts", "build-windows-exe.mjs"))
  );
}

function runAgentBuild(serverDir: string, logPath: string) {
  return new Promise<void>((resolveBuild, rejectBuild) => {
    const log = createWriteStream(logPath, { flags: "a" });
    log.write(`\n[${new Date().toISOString()}] rebuilding Reika agent from ${serverDir}\n`);
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const build = spawn(npm, ["run", "build:windows-exe"], {
      cwd: serverDir,
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    build.stdout.pipe(log, { end: false });
    build.stderr.pipe(log, { end: false });
    build.once("error", (error) => {
      log.end(`[${new Date().toISOString()}] build failed to start: ${error.message}\n`);
      rejectBuild(new Error(`Could not start the agent build: ${error.message}`));
    });
    build.once("exit", (code) => {
      log.end(`[${new Date().toISOString()}] build exited with code ${code ?? "unknown"}\n`);
      if (code === 0) resolveBuild();
      else rejectBuild(new Error(`Agent build failed with exit code ${code ?? "unknown"}. See ${logPath}.`));
    });
  });
}
