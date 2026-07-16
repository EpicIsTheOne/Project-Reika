import assert from 'node:assert/strict';

type Activity = Record<string, unknown>;

function reduceTurnActivity(current: Activity[], envelopes: Array<{ payload: Record<string, unknown>; id?: string }>) {
  const next = [...current];
  for (const envelope of envelopes) {
    const payload = envelope.payload;
    const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata as Record<string, unknown> : {};
    const key = String(payload.toolCallId || metadata.toolCallId || `${payload.status}:${payload.tool || payload.message || payload.timestamp || envelope.id || ''}`);
    const item: Activity = {
      key,
      status: payload.status,
      message: payload.message,
      tool: payload.tool,
      toolCallId: payload.toolCallId,
      requestId: payload.requestId,
      sessionId: payload.sessionId,
      providerSessionId: payload.providerSessionId,
      timestamp: payload.timestamp,
      metadata
    };
    const index = next.findIndex((entry) => String(entry.key || '') === key);
    if (index >= 0) next[index] = { ...next[index], ...item };
    else next.push(item);
  }
  return next.slice(-24);
}

const first = reduceTurnActivity([], [{ payload: { status: 'tool_use', tool: 'bash', toolCallId: 'call_1', message: 'requested', timestamp: '2026-07-16T00:00:00.000Z' } }]);
assert.equal(first.length, 1);
assert.equal(first[0].message, 'requested');

const merged = reduceTurnActivity(first, [{ payload: { status: 'tool_use', tool: 'bash', toolCallId: 'call_1', message: 'completed', timestamp: '2026-07-16T00:00:01.000Z' } }]);
assert.equal(merged.length, 1);
assert.equal(merged[0].message, 'completed');

const isolated = reduceTurnActivity([], [
  { payload: { status: 'thinking', requestId: 'req_a', sessionId: 'sess_a', message: 'working', timestamp: '2026-07-16T00:00:00.000Z' } },
  { payload: { status: 'thinking', requestId: 'req_b', sessionId: 'sess_b', message: 'other', timestamp: '2026-07-16T00:00:02.000Z' } }
]);
assert.equal(isolated.length, 2);

console.log('Chat activity contract passed');
