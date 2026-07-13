import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type { ProjectDiscoverySettings } from '../settings/settingsStore.js';
import type { ProjectDiscoveryEntry, ProjectDiscoverySnapshotPayload } from '../../shared/protocol/messages.js';

const descriptorNames = new Set([
  'package.json', 'pyproject.toml', 'cargo.toml', 'go.mod', 'composer.json',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'gemfile', 'mix.exs', 'pubspec.yaml'
]);

const stackByMarker: Record<string, string[]> = {
  'package.json': ['Node.js'], 'pyproject.toml': ['Python'], 'cargo.toml': ['Rust'], 'go.mod': ['Go'],
  'composer.json': ['PHP'], 'pom.xml': ['Java', 'Maven'], 'build.gradle': ['Java', 'Gradle'],
  'build.gradle.kts': ['Kotlin', 'Gradle'], 'gemfile': ['Ruby'], 'mix.exs': ['Elixir'],
  'pubspec.yaml': ['Dart', 'Flutter']
};

export interface ProjectScanResult {
  snapshot: ProjectDiscoverySnapshotPayload;
  warnings: string[];
}

export async function scanProjects(deviceId: string, settings: ProjectDiscoverySettings): Promise<ProjectScanResult> {
  const scannedAt = new Date().toISOString();
  const projects: ProjectDiscoveryEntry[] = [];
  const warnings: string[] = [];
  let complete = true;
  const excluded = new Set(settings.excludeDirectories.map((name) => name.toLowerCase()));
  const seenPaths = new Set<string>();
  const skippedPaths: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [];
  const deadline = Date.now() + 12_000;
  const maxDirectories = 4_000;
  let scannedDirectories = 0;

  if (!settings.enabled) return { snapshot: { deviceId, scannedAt, complete: false, roots: settings.roots, defaultAgentId: settings.defaultAgentId, projects: [] }, warnings };

  for (const configuredRoot of settings.roots) {
    if (!configuredRoot || !isAbsolute(configuredRoot)) {
      warnings.push(`Skipped non-absolute project discovery root: ${configuredRoot || '(empty)'}`);
      complete = false;
      continue;
    }
    let root: string;
    try {
      root = await realpath(configuredRoot);
      if (!(await stat(root)).isDirectory()) continue;
    } catch {
      warnings.push(`Project discovery root is unavailable: ${configuredRoot}`);
      skippedPaths.push(resolve(configuredRoot));
      continue;
    }
    queue.push({ path: root, depth: 0 });
  }

  while (queue.length > 0 && projects.length < 500 && scannedDirectories < maxDirectories && Date.now() < deadline) {
    const batch = queue.splice(0, 12).filter((item) => !seenPaths.has(item.path));
    for (const item of batch) seenPaths.add(item.path);
    scannedDirectories += batch.length;
    const results = await Promise.all(batch.map(async ({ path, depth }) => {
      const listing = await readDirectory(path, warnings);
      if (!listing) return { complete: true, skippedPath: path, children: [] as Array<{ path: string; depth: number }> };
      const { entries, truncated } = listing;
      const names = new Set(entries.map((entry) => entry.name.toLowerCase()));
      const explicit = names.has('.reika') ? await readExplicitProject(path) : undefined;
      const git = names.has('.git');
      const markers = Array.from(names).filter((name) => descriptorNames.has(name) || name.endsWith('.sln') || name.endsWith('.csproj'));
      if (explicit || git || markers.length > 0) {
        return { complete: true, project: await describeProject(path, deviceId, scannedAt, explicit, git, markers), children: [] as Array<{ path: string; depth: number }> };
      }
      if (truncated) warnings.push(`Skipped descending into large non-project directory with more than 1000 entries: ${path}`);
      const children = depth >= settings.maxDepth ? [] : entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !excluded.has(entry.name.toLowerCase()))
        .map((entry) => ({ path: join(path, entry.name), depth: depth + 1 }));
      return { complete: true, skippedPath: truncated ? path : undefined, children: truncated ? [] : children };
    }));
    for (const result of results) {
      if (!result.complete) complete = false;
      if (result.skippedPath) skippedPaths.push(result.skippedPath);
      if (result.project && projects.length < 500) projects.push(result.project);
      queue.push(...result.children);
    }
  }

  if (queue.length > 0) {
    skippedPaths.push(...queue.map((item) => item.path));
    warnings.push(`Project discovery stopped at its safety budget after scanning ${scannedDirectories} directories.`);
  }

  return { snapshot: { deviceId, scannedAt, complete, roots: settings.roots, skippedPaths: Array.from(new Set(skippedPaths)), defaultAgentId: settings.defaultAgentId, projects }, warnings };
}

async function readDirectory(path: string, warnings: string[]) {
  try {
    const allEntries = await readdir(path, { withFileTypes: true });
    const truncated = allEntries.length > 1_000;
    const entries = allEntries;
    return { entries, truncated };
  } catch (error) {
    warnings.push(`Could not scan ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function readExplicitProject(projectPath: string) {
  try {
    const raw = await readFile(join(projectPath, '.reika', 'project.json'), 'utf8');
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Record<string, unknown>;
    return {
      id: text(parsed.id), name: text(parsed.name), description: text(parsed.description),
      aliases: list(parsed.aliases), technologyStack: list(parsed.technologyStack)
    };
  } catch {
    return undefined;
  }
}

async function describeProject(
  projectPath: string,
  deviceId: string,
  discoveredAt: string,
  explicit: Awaited<ReturnType<typeof readExplicitProject>>,
  hasGit: boolean,
  markers: string[]
): Promise<ProjectDiscoveryEntry> {
  const packageMetadata = markers.includes('package.json') ? await readPackageMetadata(projectPath) : undefined;
  const git = hasGit ? await readGitMetadata(projectPath) : undefined;
  const repositoryUrl = sanitizeRepositoryUrl(git?.repositoryUrl || packageMetadata?.repositoryUrl);
  const identityKey = explicit?.id
    ? `explicit:${explicit.id.toLowerCase()}`
    : repositoryUrl
      ? `git:${normalizeRepositoryUrl(repositoryUrl)}`
      : `path:${deviceId}:${normalizePath(projectPath)}`;
  const technologyStack = Array.from(new Set([
    ...(explicit?.technologyStack || []),
    ...markers.flatMap((marker) => stackByMarker[marker] || (marker.endsWith('.sln') || marker.endsWith('.csproj') ? ['.NET'] : []))
  ]));
  const source = explicit?.id ? 'explicit' : repositoryUrl ? 'git' : 'marker';
  return {
    projectId: explicit?.id ? cleanId(explicit.id) : `project-${digest(identityKey).slice(0, 16)}`,
    identityKey,
    name: explicit?.name || packageMetadata?.name || basename(projectPath),
    description: explicit?.description || packageMetadata?.description || '',
    aliases: explicit?.aliases || [], path: projectPath, repositoryUrl, branch: git?.branch,
    technologyStack, source,
    confidence: explicit?.id ? 'explicit' : repositoryUrl || hasGit ? 'high' : 'medium',
    discoveredAt
  };
}

async function readPackageMetadata(projectPath: string) {
  try {
    const parsed = JSON.parse((await readFile(join(projectPath, 'package.json'), 'utf8')).replace(/^\uFEFF/, '')) as Record<string, unknown>;
    const repository = typeof parsed.repository === 'string'
      ? parsed.repository
      : parsed.repository && typeof parsed.repository === 'object' ? text((parsed.repository as Record<string, unknown>).url) : undefined;
    return { name: text(parsed.name), description: text(parsed.description), repositoryUrl: repository };
  } catch {
    return undefined;
  }
}

async function readGitMetadata(projectPath: string) {
  try {
    let gitDir = join(projectPath, '.git');
    if ((await stat(gitDir)).isFile()) {
      const target = /^gitdir:\s*(.+)$/im.exec(await readFile(gitDir, 'utf8'))?.[1]?.trim();
      if (!target) return undefined;
      gitDir = resolve(projectPath, target);
    }
    let configPath = join(gitDir, 'config');
    try {
      const commonDir = (await readFile(join(gitDir, 'commondir'), 'utf8')).trim();
      if (commonDir) configPath = join(resolve(gitDir, commonDir), 'config');
    } catch {
      // Normal repositories do not have a commondir file.
    }
    const config = await readFile(configPath, 'utf8');
    const originSection = /\[remote\s+"origin"\]([\s\S]*?)(?=\n\[|$)/i.exec(config)?.[1] || '';
    const repositoryUrl = /^\s*url\s*=\s*(.+)$/im.exec(originSection)?.[1]?.trim();
    const head = await readFile(join(gitDir, 'HEAD'), 'utf8').catch(() => '');
    return { repositoryUrl, branch: /^ref:\s+refs\/heads\/(.+)$/i.exec(head.trim())?.[1] };
  } catch {
    return undefined;
  }
}

function sanitizeRepositoryUrl(value: unknown) {
  const raw = text(value)?.replace(/^git\+/, '');
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw.replace(/\/\/[^/@\s]+@/u, '//');
  }
}

function normalizeRepositoryUrl(value: string) {
  const normalized = value.trim().replace(/^git@([^:]+):/u, 'ssh://git@$1/');
  try {
    const url = new URL(normalized);
    return `${url.hostname}${url.pathname}`.toLowerCase().replace(/\.git$/u, '').replace(/\/$/u, '');
  } catch {
    return normalized.toLowerCase().replace(/\.git$/u, '').replace(/\/$/u, '');
  }
}

function normalizePath(value: string) { return resolve(value).replace(/\\/g, '/').toLowerCase(); }
function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
function cleanId(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/(^-|-$)/g, '') || `project-${digest(value).slice(0, 16)}`; }
function text(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function list(value: unknown) { return Array.isArray(value) ? Array.from(new Set(value.map(text).filter((item): item is string => Boolean(item)))) : []; }
