import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanProjects } from '../src/modules/projectDiscovery/projectScanner.js';

const root = mkdtempSync(join(tmpdir(), 'reika-project-discovery-'));
try {
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, '.git', 'config'), '[remote "origin"]\n  url = git@example.test:Epic/Workspace.git\n');
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');

  const gitProject = join(root, 'shared-app');
  mkdirSync(join(gitProject, '.git'), { recursive: true });
  writeFileSync(join(gitProject, '.git', 'config'), '[remote "origin"]\n  url = https://secret@example.test/Epic/Shared.git\n');
  writeFileSync(join(gitProject, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(gitProject, 'package.json'), JSON.stringify({ name: 'shared-app', description: 'Shared application' }));
  mkdirSync(join(gitProject, 'node_modules', 'fake-project', '.git'), { recursive: true });

  const explicitProject = join(root, 'special');
  mkdirSync(join(explicitProject, '.reika'), { recursive: true });
  writeFileSync(join(explicitProject, '.reika', 'project.json'), JSON.stringify({ id: 'special-project', name: 'Special Project', technologyStack: ['Python'] }));
  writeFileSync(join(explicitProject, 'pyproject.toml'), '[project]\nname = "special"\n');

  const result = await scanProjects('device-a', {
    enabled: true, roots: [root], excludeDirectories: ['node_modules', '.git'], maxDepth: 4, scanIntervalMinutes: 15
  });
  assert.equal(result.snapshot.projects.length, 3, 'scanner finds nested repositories beneath a configured project root and skips dependency trees');
  assert.ok(result.snapshot.projects.some((project) => project.identityKey === 'git:example.test/epic/workspace'), 'configured project root is retained');
  const git = result.snapshot.projects.find((project) => project.name === 'shared-app')!;
  assert.equal(git.branch, 'main');
  assert.equal(git.repositoryUrl, 'https://example.test/Epic/Shared.git', 'repository credentials are removed from manifests');
  assert.equal(git.confidence, 'high');
  assert.match(git.identityKey, /^git:example\.test\/epic\/shared$/i, 'HTTPS and SSH clones share a host-and-path repository identity');
  const explicit = result.snapshot.projects.find((project) => project.projectId === 'special-project')!;
  assert.equal(explicit.name, 'Special Project');
  assert.equal(explicit.confidence, 'explicit');
  assert.deepEqual(explicit.technologyStack.sort(), ['Python'], 'explicit metadata remains authoritative');
  console.log('Project discovery scanner tests passed.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
