import { copyFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const releaseDir = resolve(root, 'release');
const releaseExePath = 'release/reika-node.exe';
const releaseBlobPath = 'release/reika-node.blob';
const bundlePath = resolve(releaseDir, 'reika-node.cjs');
const blobPath = resolve(releaseDir, 'reika-node.blob');
const seaConfigPath = resolve(releaseDir, 'sea-config.json');
const exePath = resolve(releaseDir, 'reika-node.exe');

function run(command, args) {
  const usesCmdShim = process.platform === 'win32' && ['npm', 'npx'].includes(command);
  const file = command;
  const result = spawnSync(file, args, {
    cwd: root,
    stdio: 'inherit',
    shell: usesCmdShim
  });

  if (result.error) {
    console.error(result.error);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

mkdirSync(releaseDir, { recursive: true });
run('npm', ['run', 'build']);
run('npx', [
  'esbuild',
  'src/main.ts',
  '--bundle',
  '--platform=node',
  '--target=node22',
  '--format=cjs',
  '--outfile=release/reika-node.cjs'
]);

await import('node:fs/promises').then(({ writeFile }) => writeFile(seaConfigPath, JSON.stringify({
  main: bundlePath,
  output: blobPath,
  disableExperimentalSEAWarning: true
}, null, 2)));

run(process.execPath, ['--experimental-sea-config', seaConfigPath]);
copyFileSync(process.execPath, exePath);
run('npx', [
  'postject',
  releaseExePath,
  'NODE_SEA_BLOB',
  releaseBlobPath,
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
]);

console.log(`Built ${exePath}`);
