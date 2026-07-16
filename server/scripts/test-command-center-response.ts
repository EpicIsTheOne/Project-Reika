import assert from 'node:assert/strict';
import { extractCommandCenterResponseText, extractCommandCenterSessionId } from '../src/modules/provider/providerRuntime.js';

assert.equal(extractCommandCenterResponseText({
  message: { role: 'user', text: 'repeat me' },
  response: { role: 'assistant', text: 'real agent reply' }
}), 'real agent reply');

assert.equal(extractCommandCenterResponseText({
  message: { role: 'user', text: 'never promote this' }
}), '');

assert.equal(extractCommandCenterResponseText({ message: 'never promote an ambiguous legacy message' }), '');
assert.equal(extractCommandCenterResponseText({ reply: { content: [{ type: 'text', text: 'structured reply' }] } }), 'structured reply');
assert.equal(extractCommandCenterSessionId({ session: { id: 'ccs_nested' } }), 'ccs_nested');
assert.equal(extractCommandCenterSessionId({ sessionId: 'ccs_top', session: { id: 'ccs_nested' } }), 'ccs_top');
assert.equal(extractCommandCenterSessionId({}, 'ccs_existing'), 'ccs_existing');

console.log('Command Center response extraction contracts passed');

assert.equal(extractCommandCenterResponseText({ response: { content: [{ type: 'text', text: 'roleplay reply' }] }, mode: 'roleplay', model: 'openrouter/test' }), 'roleplay reply');
