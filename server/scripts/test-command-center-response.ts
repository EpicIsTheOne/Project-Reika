import assert from 'node:assert/strict';
import { extractCommandCenterResponseText } from '../src/modules/provider/providerRuntime.js';

assert.equal(extractCommandCenterResponseText({
  message: { role: 'user', text: 'repeat me' },
  response: { role: 'assistant', text: 'real agent reply' }
}), 'real agent reply');

assert.equal(extractCommandCenterResponseText({
  message: { role: 'user', text: 'never promote this' }
}), '');

assert.equal(extractCommandCenterResponseText({ message: 'legacy assistant reply' }), 'legacy assistant reply');
assert.equal(extractCommandCenterResponseText({ reply: { content: [{ type: 'text', text: 'structured reply' }] } }), 'structured reply');

console.log('Command Center response extraction contracts passed');
