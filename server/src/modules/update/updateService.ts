import { execFile } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import https from 'node:https';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ReikaSettings } from '../settings/settingsStore.js';

const execFileAsync = promisify(execFile);

const repoOwner = process.env.REIKA_UPDATE_REPO_OWNER || 'EpicIsTheOne';
const repoName = process.env.REIKA_UPDATE_REPO_NAME || 'Project-Reika';
const repoBranch = process.env.REIKA_UPDATE_BRANCH || 'main';
const githubApiBase = process.env.REIKA_GITHUB_API_BASE || 'https://api.github.com';
const packagedVersion = process.env.REIKA_APP_VERSION || process.env.npm_package_version || '0.1.0';
const packagedUpdateDir = process.env.REIKA_PACKAGED_UPDATE_DIR || join(homedir(), '.local', 'share', 'project-reika', 'updates');

export interface UpdateFileChange {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
}

export interface UpdateDescription {
  sha: string;
  title: string;
  body?: string;
  author?: string;
  date?: string;
}

export interface UpdateStatus {
  ok: true;
  supported: boolean;
  mode?: 'git' | 'packaged';
  repoRoot?: string;
  branch?: string;
  localSha?: string;
  remoteSha?: string;
  behindBy: number;
  aheadBy: number;
  available: boolean;
  files: UpdateFileChange[];
  descriptions: UpdateDescription[];
  message: string;
  checkedAt: string;
  installerAsset?: {
    name: string;
    url: string;
    size?: number;
    version?: string;
  };
  settings?: {
    autoUpdateServer: boolean;
    autoUpdateClient: boolean;
  };
}

export interface ApplyUpdateResult extends UpdateStatus {
  applied: boolean;
  applyOutput?: string;
}

async function runGit(args: string[], cwd: string) {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 8
  });
  return `${stdout || ''}${stderr || ''}`.trim();
}

function findRepoRoot(start = process.cwd()) {
  let current = resolve(start);
  for (;;) {
    if (existsSync(resolve(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return '';
    current = parent;
  }
}

function cleanMessage(message: string) {
  return message.replace(/\r\n/g, '\n').trim();
}

async function localGitInfo(repoRoot: string) {
  const [localSha, branch] = await Promise.all([
    runGit(['rev-parse', 'HEAD'], repoRoot),
    runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)
  ]);
  return { localSha: localSha.trim(), branch: branch.trim() };
}

function parseLogDescriptions(output: string): UpdateDescription[] {
  return output.split('\x1e').map((entry) => {
    const [sha = '', author = '', date = '', ...messageParts] = entry.trim().split('\x1f');
    const message = cleanMessage(messageParts.join('\x1f'));
    if (!sha && !message) return undefined;
    const [title, ...body] = message.split('\n');
    return {
      sha: sha.slice(0, 12),
      title: title || 'Update',
      body: body.join('\n').trim() || undefined,
      author: author || undefined,
      date: date || undefined
    };
  }).filter(Boolean) as UpdateDescription[];
}

function parseDiffFiles(output: string): UpdateFileChange[] {
  return output.split(/\r?\n/).map((line) => {
    const [status = '', ...pathParts] = line.split(/\t/);
    const path = pathParts.join('\t').trim();
    if (!path) return undefined;
    return { path, status: status.trim() || 'modified' };
  }).filter(Boolean) as UpdateFileChange[];
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
}

function httpsJson<T>(url: string): Promise<T> {
  return new Promise((resolveJson, reject) => {
    https.get(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Project-Reika-Updater'
      }
    }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        httpsJson<T>(response.headers.location).then(resolveJson, reject);
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => {
        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`GitHub release request failed: HTTP ${response.statusCode || 'unknown'}`));
          return;
        }
        try {
          resolveJson(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

function downloadFile(url: string, destination: string): Promise<void> {
  return new Promise((resolveDownload, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Project-Reika-Updater' } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadFile(response.headers.location, destination).then(resolveDownload, reject);
        return;
      }
      if (!response.statusCode || response.statusCode >= 400) {
        reject(new Error(`Installer download failed: HTTP ${response.statusCode || 'unknown'}`));
        return;
      }
      const stream = createWriteStream(destination);
      response.pipe(stream);
      stream.on('finish', () => stream.close(() => resolveDownload()));
      stream.on('error', reject);
    }).on('error', reject);
  });
}

function normalizeVersion(value?: string) {
  return String(value || '').replace(/^v/i, '').trim();
}

function compareVersions(a: string, b: string) {
  const left = normalizeVersion(a).split(/[.-]/).map((part) => Number(part) || 0);
  const right = normalizeVersion(b).split(/[.-]/).map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function getPackagedUpdateStatus(settings?: ReikaSettings): Promise<UpdateStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const release = await httpsJson<GitHubRelease>(`${githubApiBase}/repos/${repoOwner}/${repoName}/releases/latest`);
    const asset = (release.assets || []).find((candidate) => /\.exe$/i.test(candidate.name) && /setup|agenthub|reika/i.test(candidate.name));
    const releaseVersion = normalizeVersion(release.tag_name || release.name || '');
    const available = Boolean(asset && releaseVersion && compareVersions(releaseVersion, packagedVersion) > 0);
    return {
      ok: true,
      supported: Boolean(asset),
      mode: 'packaged',
      behindBy: available ? 1 : 0,
      aheadBy: 0,
      localSha: packagedVersion,
      remoteSha: releaseVersion || undefined,
      available,
      files: asset ? [{ path: asset.name, status: 'installer', additions: asset.size }] : [],
      descriptions: [{
        sha: releaseVersion || 'release',
        title: release.name || `Project Reika ${release.tag_name || 'release'}`,
        body: release.body || undefined,
        date: release.published_at
      }],
      message: asset
        ? available
          ? `Packaged Reika update ${release.tag_name || release.name} is available.`
          : 'Packaged Reika is up to date with the latest GitHub release.'
        : 'No Windows installer asset was found in the latest GitHub release.',
      checkedAt,
      installerAsset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size, version: releaseVersion } : undefined,
      settings: settings ? { autoUpdateServer: settings.autoUpdateServer, autoUpdateClient: settings.autoUpdateClient } : undefined
    };
  } catch (error) {
    return {
      ok: true,
      supported: false,
      mode: 'packaged',
      behindBy: 0,
      aheadBy: 0,
      available: false,
      files: [],
      descriptions: [],
      message: `Packaged update check failed: ${error instanceof Error ? error.message : String(error)}`,
      checkedAt,
      settings: settings ? { autoUpdateServer: settings.autoUpdateServer, autoUpdateClient: settings.autoUpdateClient } : undefined
    };
  }
}

export async function getUpdateStatus(settings?: ReikaSettings): Promise<UpdateStatus> {
  const checkedAt = new Date().toISOString();
  const repoRoot = findRepoRoot();
  if (!repoRoot) {
    return getPackagedUpdateStatus(settings);
  }

  await runGit(['fetch', 'origin', repoBranch], repoRoot);
  const { localSha, branch } = await localGitInfo(repoRoot);
  const remoteRef = `origin/${repoBranch}`;
  const remoteSha = (await runGit(['rev-parse', remoteRef], repoRoot)).trim();
  const [aheadText = '0', behindText = '0'] = (await runGit(['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`], repoRoot)).trim().split(/\s+/);
  const aheadBy = Number(aheadText || 0);
  const behindBy = Number(behindText || 0);
  const [filesOutput, logOutput] = await Promise.all([
    behindBy > 0 ? runGit(['diff', '--name-status', `HEAD..${remoteRef}`], repoRoot) : Promise.resolve(''),
    behindBy > 0 ? runGit(['log', '--format=%H%x1f%an%x1f%aI%x1f%B%x1e', `HEAD..${remoteRef}`], repoRoot) : Promise.resolve('')
  ]);

  return {
    ok: true,
    supported: true,
    mode: 'git',
    repoRoot,
    branch,
    localSha,
    remoteSha: remoteSha || localSha,
    behindBy,
    aheadBy,
    available: behindBy > 0,
    files: parseDiffFiles(filesOutput),
    descriptions: parseLogDescriptions(logOutput),
    message: behindBy > 0 ? `${behindBy} update ${behindBy === 1 ? 'commit is' : 'commits are'} available from GitHub.` : 'This clone is up to date with GitHub.',
    checkedAt,
    settings: settings ? { autoUpdateServer: settings.autoUpdateServer, autoUpdateClient: settings.autoUpdateClient } : undefined
  };
}

export async function applyGitHubUpdate(settings?: ReikaSettings): Promise<ApplyUpdateResult> {
  const before = await getUpdateStatus(settings);
  if (before.mode === 'packaged') return applyPackagedUpdate(before);
  if (!before.supported || !before.repoRoot) return { ...before, applied: false };
  if (!before.available) return { ...before, applied: false, applyOutput: 'No update available.' };
  if (before.aheadBy > 0) throw new Error('This clone has local commits ahead of GitHub. Refusing automatic pull.');
  const output = await runGit(['pull', '--ff-only', 'origin', repoBranch], before.repoRoot);
  const after = await getUpdateStatus(settings);
  return {
    ...after,
    applied: true,
    applyOutput: output || 'Updated from GitHub.',
    files: before.files,
    descriptions: before.descriptions,
    message: `Updated from GitHub. ${before.files.length} files changed.`
  };
}

async function applyPackagedUpdate(status: UpdateStatus): Promise<ApplyUpdateResult> {
  if (!status.supported || !status.installerAsset) return { ...status, applied: false, applyOutput: 'No packaged installer asset is available.' };
  if (!status.available) return { ...status, applied: false, applyOutput: 'No packaged update available.' };
  await mkdir(packagedUpdateDir, { recursive: true });
  const installerPath = join(packagedUpdateDir, basename(status.installerAsset.name));
  await downloadFile(status.installerAsset.url, installerPath);
  const manifestPath = join(packagedUpdateDir, 'latest-update.json');
  await writeFile(manifestPath, `${JSON.stringify({ downloadedAt: new Date().toISOString(), installerPath, status }, null, 2)}\n`, 'utf8');
  let launchMessage = `Downloaded installer to ${installerPath}.`;
  if (process.platform === 'win32') {
    await execFileAsync(installerPath, ['/S'], { timeout: 10000 }).catch(() => execFileAsync(installerPath, [], { timeout: 10000 }).catch(() => undefined));
    launchMessage = `Downloaded and launched installer: ${installerPath}`;
  }
  return {
    ...status,
    applied: true,
    applyOutput: `${launchMessage}\nManifest: ${manifestPath}`,
    message: `Packaged update staged. Restart Reika if the installer did not restart it automatically.`
  };
}

export function updateTargetsEnabled(settings: ReikaSettings) {
  return settings.autoUpdateServer || settings.autoUpdateClient;
}
