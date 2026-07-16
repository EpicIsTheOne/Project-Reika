import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../desktop/localCommandCenter.ts', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies?: Record<string, string> };

assert.match(source, /COMMANDCENTER_RELAY_ONLY:\s*"true"/, 'embedded CommandCenter should enable relay-only mode');
assert.match(source, /resolveEmbeddedRelayUrl\(/, 'embedded provisioning should resolve relay URLs explicitly');
assert.match(source, /normalizeCommandCenterRelayUrl\(/, 'embedded provisioning should normalize relay URLs to \/v1\/app');
assert.match(source, /isLocalLoopbackUrl\(/, 'embedded provisioning should detect loopback relay URLs');
assert.ok(source.includes('replace(/\\/v1\\/device\\/?$/iu, "/v1/app")'), 'device relay URLs should be rewritten to app relay URLs');
assert.match(source, /if \(configured && !isLocalLoopbackUrl\(configured\)\) return configured;/, 'configured public relay should win over discovered loopback relay');
assert.match(source, /if \(discovered && !isLocalLoopbackUrl\(discovered\)\) return discovered;/, 'discovered public relay should be accepted');
assert.equal(typeof packageJson.dependencies?.['openclaw-command-center'], 'string');
assert.match(String(packageJson.dependencies?.['openclaw-command-center'] || ''), /^github:EpicIsTheOne\/CommandCenter#/, 'desktop client should pin CommandCenter dependency to GitHub commit');

console.log('Embedded CommandCenter relay contract passed');
