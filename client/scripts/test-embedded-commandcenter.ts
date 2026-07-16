import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../desktop/localCommandCenter.ts', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies?: Record<string, string> };
const packageLock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')) as {
  packages?: Record<string, { resolved?: string }>;
};

assert.match(source, /COMMANDCENTER_RELAY_ONLY:\s*"true"/, 'embedded CommandCenter should enable relay-only mode');
assert.match(source, /resolveEmbeddedRelayUrl\(/, 'embedded provisioning should resolve relay URLs explicitly');
assert.match(source, /normalizeCommandCenterRelayUrl\(/, 'embedded provisioning should normalize relay URLs to \/v1\/app');
assert.match(source, /isLocalLoopbackUrl\(/, 'embedded provisioning should detect loopback relay URLs');
assert.ok(source.includes('replace(/\\/v1\\/device\\/?$/iu, "/v1/app")'), 'device relay URLs should be rewritten to app relay URLs');
assert.match(source, /if \(configured && !isLocalLoopbackUrl\(configured\)\) return configured;/, 'configured public relay should win over discovered loopback relay');
assert.match(source, /if \(discovered && !isLocalLoopbackUrl\(discovered\)\) return discovered;/, 'discovered public relay should be accepted');
assert.equal(typeof packageJson.dependencies?.['openclaw-command-center'], 'string');
const commandCenterSpec = String(packageJson.dependencies?.['openclaw-command-center'] || '');
assert.match(commandCenterSpec, /^github:EpicIsTheOne\/CommandCenter#[0-9a-f]+$/i, 'desktop client should pin CommandCenter dependency to a GitHub commit');
const expectedCommit = commandCenterSpec.split('#')[1];
const lockedCommandCenter = packageLock.packages?.['node_modules/openclaw-command-center'];
assert.ok(lockedCommandCenter?.resolved, 'package lock should resolve the embedded CommandCenter dependency');
assert.ok(lockedCommandCenter.resolved.includes(`#${expectedCommit}`), `package lock must resolve the declared CommandCenter commit ${expectedCommit}`);

console.log('Embedded CommandCenter relay contract passed');
