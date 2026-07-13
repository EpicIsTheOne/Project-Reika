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

  const interrupted = createEnvelope({
    type: 'agent.chat.request',
    source: { kind: 'app', id: 'test-app' },
    target: { kind: 'device', id: 'device-test' },
    deviceId: 'device-test',
    payload: {
      providerId: 'openclaw-direct',
      agent: 'orchestrator',
      message: 'survive restart',
      sessionId: 'session-restart',
      providerSessionId: 'memory_mesh_restart',
      delivery: { idempotencyKey: 'restart', statusMetadataVersion: 1 as const }
    }
  });
  const pendingDispatcher = new CommandDispatcher(
    state as never,
    { kind: 'device', id: 'device-test' },
    async () => new Promise(() => undefined)
  );
  void pendingDispatcher.dispatch(interrupted);
  await Promise.resolve();
  const restartedDispatcher = new CommandDispatcher(
    state as never,
    { kind: 'device', id: 'device-test' },
    undefined,
    undefined,
    async (input) => ({
      providerId: input.providerId,
      agent: input.agent,
      sessionId: input.providerSessionId,
      text: 'recovered after restart',
      runtime: 'recovered-history'
    })
  );
  const status = createEnvelope({
    type: 'command.status.request',
    source: { kind: 'app', id: 'test-app' },
    target: { kind: 'device', id: 'device-test' },
    deviceId: 'device-test',
    payload: { requestId: interrupted.id, sessionId: 'session-restart' }
  });
  const recovered = await restartedDispatcher.dispatch(status);
  const recoveredResponse = recovered.find((item) => item.type === 'agent.chat.response');
  if (!recoveredResponse || (recoveredResponse.payload as { text?: string }).text !== 'recovered after restart') {
    throw new Error('Restarted dispatcher did not recover the durable provider result.');
  }
  const recoveredLedger = readFileSync(process.env.REIKA_IDEMPOTENCY_STORE_PATH, 'utf8');
  if (!recoveredLedger.includes('memory_mesh_restart') || !recoveredLedger.includes('recovered after restart')) {
    throw new Error('Recovered response metadata was not persisted in the ledger.');
  }
  console.log('agent idempotency ledger ok');
} finally {
  rmSync(stateDir, { recursive: true, force: true });
}
