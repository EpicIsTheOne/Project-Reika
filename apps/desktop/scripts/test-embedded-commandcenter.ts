import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../electron/localCommandCenter.ts', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies?: Record<string, string> };
const packageLock = JSON.parse(readFileSync(new URL('../../../package-lock.json', import.meta.url), 'utf8')) as {
  packages?: Record<string, { resolved?: string; link?: boolean }>;
};
const vendoredCommit = readFileSync(new URL('../../../vendor/openclaw-command-center/REIKA_VENDOR_COMMIT', import.meta.url), 'utf8').trim();
const vendoredConfig = readFileSync(new URL('../../../vendor/openclaw-command-center/server/config.js', import.meta.url), 'utf8');
const vendoredApp = readFileSync(new URL('../../../vendor/openclaw-command-center/public/js/app.js', import.meta.url), 'utf8');

assert.match(source, /COMMANDCENTER_RELAY_ONLY:\s*"true"/, 'embedded CommandCenter should enable relay-only mode');
assert.match(source, /resolveEmbeddedRelayUrl\(/, 'embedded provisioning should resolve relay URLs explicitly');
assert.match(source, /normalizeCommandCenterRelayUrl\(/, 'embedded provisioning should normalize relay URLs to \/v1\/app');
assert.match(source, /isLocalLoopbackUrl\(/, 'embedded provisioning should detect loopback relay URLs');
assert.ok(source.includes('replace(/\\/v1\\/device\\/?$/iu, "/v1/app")'), 'device relay URLs should be rewritten to app relay URLs');
assert.match(source, /if \(configured && !isLocalLoopbackUrl\(configured\)\) return configured;/, 'configured public relay should win over discovered loopback relay');
assert.match(source, /if \(discovered && !isLocalLoopbackUrl\(discovered\)\) return discovered;/, 'discovered public relay should be accepted');
assert.equal(packageJson.dependencies?.['openclaw-command-center'], 'file:../../vendor/openclaw-command-center', 'desktop client should use the reproducible vendored CommandCenter runtime');
const lockedCommandCenter = packageLock.packages?.['node_modules/openclaw-command-center'];
assert.equal(lockedCommandCenter?.resolved, 'vendor/openclaw-command-center', 'package lock should resolve the vendored CommandCenter runtime');
assert.equal(lockedCommandCenter?.link, true, 'vendored CommandCenter should be represented as a local package link');
assert.match(vendoredCommit, /^[0-9a-f]{40}$/i, 'vendored CommandCenter should record its exact upstream commit');
assert.match(vendoredConfig, /relayOnlyMode:\s*relayOnlyRequested \|\| reikaEmbeddedRuntime/, 'vendored CommandCenter should force relay-only mode for Reika embeds');
assert.match(vendoredApp, /Connecting to Reika Relay/, 'vendored CommandCenter should use relay-specific boot messaging');

console.log('Embedded CommandCenter relay contract passed');
