import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ReikaSettings } from '../settings/settingsStore.js';

const execFileAsync = promisify(execFile);

const repoOwner = process.env.REIKA_UPDATE_REPO_OWNER || 'EpicIsTheOne';
const repoName = process.env.REIKA_UPDATE_REPO_NAME || 'Project-Reika';
const repoBranch = process.env.REIKA_UPDATE_BRANCH || 'main';
const githubApiBase = process.env.REIKA_GITHUB_API_BASE || 'https://api.github.com';

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

export async function getUpdateStatus(settings?: ReikaSettings): Promise<UpdateStatus> {
  const checkedAt = new Date().toISOString();
  const repoRoot = findRepoRoot();
  if (!repoRoot) {
    return {
      ok: true,
      supported: false,
      behindBy: 0,
      aheadBy: 0,
      available: false,
      files: [],
      descriptions: [],
      message: 'This install is not running from a git clone, so GitHub auto-update cannot apply changes here.',
      checkedAt,
      settings: settings ? { autoUpdateServer: settings.autoUpdateServer, autoUpdateClient: settings.autoUpdateClient } : undefined
    };
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

export function updateTargetsEnabled(settings: ReikaSettings) {
  return settings.autoUpdateServer || settings.autoUpdateClient;
}
