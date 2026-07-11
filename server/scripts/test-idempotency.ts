import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const stateDir = mkdtempSync(join(tmpdir(), 'project-reika-idempotency-'));
process.env.REIKA_IDEMPOTENCY_STORE_PATH = join(stateDir, 'ledger.json');

try {
  const [{ CommandDispatcher }, { createEnvelope }] = await Promise.all([
    import('../src/modules/commands/dispatcher.js'),
    import('../src/shared/protocol/envelope.js')
  ]);
  let executions = 0;
  const state = {
    snapshot: () => ({ activeProviderId: 'mock-local', providers: [{ id: 'mock-local', agents: [{ id: 'reika' }] }] }),
    refreshProviders: async () => undefined
  };
  const dispatcher = new CommandDispatcher(
    state as never,
    { kind: 'device', id: 'device-test' },
    async (payload) => {
      executions += 1;
      return { providerId: 'mock-local', agent: payload.agent || 'reika', sessionId: payload.sessionId || 'session-test', text: 'done', runtime: 'mock' };
    }
  );
  const request = createEnvelope({
    type: 'agent.chat.request',
    source: { kind: 'app', id: 'test-app' },
    target: { kind: 'device', id: 'device-test' },
    deviceId: 'device-test',
    payload: { message: 'execute once', sessionId: 'session-test', delivery: { idempotencyKey: 'fixed', statusMetadataVersion: 1 } }
  });
  const first = await dispatcher.dispatch(request);
  const duplicate = await dispatcher.dispatch(request);
  if (executions !== 1) throw new Error(`Expected one provider execution, received ${executions}.`);
  if (!first.some((item) => item.type === 'agent.chat.response') || !duplicate.some((item) => item.type === 'agent.chat.response')) {
    throw new Error('Completed duplicate must return the durable existing response.');
  }
  const persisted = readFileSync(process.env.REIKA_IDEMPOTENCY_STORE_PATH, 'utf8');
  if (!persisted.includes('"state": "completed"') || !persisted.includes(request.id)) throw new Error('Completed request was not persisted in the ledger.');
  console.log('agent idempotency ledger ok');
} finally {
  rmSync(stateDir, { recursive: true, force: true });
}
