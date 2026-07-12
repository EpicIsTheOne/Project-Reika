import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryMeshStore } from '../src/modules/memoryMesh/memoryMeshStore.js';
import { ReikaMemoryToolRuntime, createReikaToolCall, reikaMemoryToolDefinitions, toCommandCenterToolSchemas, toHermesToolManifest, toOpenAiToolSchemas } from '../src/modules/memoryMesh/toolRuntime.js';

const root = mkdtempSync(join(tmpdir(), 'reika-memory-mesh-test-'));
const store = new MemoryMeshStore(join(root, 'mesh.sqlite'));

try {
  store.registerDevice({ id: 'desktop-a', name: 'Main Desktop', operatingSystem: 'windows', status: 'online' });
  store.registerDevice({ id: 'server-b', name: 'Server', operatingSystem: 'linux', status: 'online' });

  store.registerAgent({
    id: 'reika', displayName: 'Reika', providerId: 'hermes-a', providerAgentId: 'reika', deviceId: 'desktop-a',
    status: 'online', capabilities: ['chat', 'tools'], supportedTools: ['filesystem']
  });
  store.registerAgent({
    id: 'astra', displayName: 'Astra', providerId: 'openclaw-b', providerAgentId: 'astra', deviceId: 'server-b',
    status: 'online', capabilities: ['chat', 'tools', 'git'], supportedTools: ['filesystem', 'git']
  });
  store.registerAgent({
    id: 'nyxie', displayName: 'Nyxie', providerId: 'openclaw-b', providerAgentId: 'nyxie', deviceId: 'server-b',
    status: 'online', capabilities: ['chat'], supportedTools: []
  });

  const project = store.createProject({
    id: 'command-center',
    name: 'Command Center',
    aliases: ['CCO', 'Project Command Center'],
    description: 'Desktop agent command center.',
    technologyStack: ['TypeScript', 'Electron']
  });
  store.assignAgentToProject(project.id, 'astra', { role: 'primary', access: 'read_write' });
  store.assignAgentToProject(project.id, 'reika', { role: 'collaborator', access: 'read_write' });
  store.assignDeviceToProject(project.id, 'server-b', { isPrimary: true, path: '/srv/command-center' });

  assert.equal(store.resolveProject('Command Center').project?.id, project.id, 'resolves exact project name');
  assert.equal(store.resolveProject('CCO').project?.id, project.id, 'resolves exact alias');
  assert.equal(store.resolveProject('desktop command center').project?.id, project.id, 'resolves semantic token overlap');

  const globalMemory = store.addMemory({ content: 'Prefer concise verification.', scope: 'global', createdBy: 'user', source: 'user' });
  const astraPrivate = store.addMemory({ content: 'Astra private note.', scope: 'agent', agentId: 'astra', createdBy: 'user', source: 'conversation' });
  const reikaPrivate = store.addMemory({ content: 'Reika private note.', scope: 'agent', agentId: 'reika', createdBy: 'user', source: 'conversation' });
  const projectMemory = store.addMemory({ content: 'Login uses a device-local OAuth callback.', scope: 'project', projectId: project.id, createdBy: 'user', source: 'architecture-decision' });

  const astraView = store.searchMemory({}, { agentId: 'astra', deviceId: 'server-b' });
  assert(astraView.some((memory) => memory.id === globalMemory.id), 'agents can read global memory');
  assert(astraView.some((memory) => memory.id === astraPrivate.id), 'agent can read its own private memory');
  assert(astraView.some((memory) => memory.id === projectMemory.id), 'assigned agent can read project memory');
  assert(!astraView.some((memory) => memory.id === reikaPrivate.id), 'agent-private memories stay isolated');
  const nyxieView = store.searchMemory({}, { agentId: 'nyxie', deviceId: 'server-b' });
  assert(!nyxieView.some((memory) => memory.id === projectMemory.id), 'unassigned agents cannot read project memory');
  assert.throws(() => store.addMemory({ content: 'Unauthorized project write.', scope: 'project', projectId: project.id, createdBy: 'nyxie', source: 'agent' }, { agentId: 'nyxie', deviceId: 'server-b' }), /cannot write/, 'unassigned agents cannot write project memory');
  store.assignAgentToProject(project.id, 'nyxie', { role: 'collaborator', access: 'read_only' });
  assert(store.searchMemory({}, { agentId: 'nyxie', deviceId: 'server-b' }).some((memory) => memory.id === projectMemory.id), 'read-only assigned agents can read project memory');
  assert.throws(() => store.updateMemory(projectMemory.id, { content: 'Unauthorized edit.' }, { agentId: 'nyxie', deviceId: 'server-b' }), /read-only/, 'read-only project agents cannot edit memory');

  const decision = store.routeTask({
    projectQuery: 'Project Command Center',
    task: 'Fix the login page.',
    requiredCapabilities: ['git', 'tools'],
    currentAgentId: 'reika',
    currentDeviceId: 'desktop-a'
  });
  assert.equal(decision.status, 'selected');
  assert.equal(decision.agent?.id, 'astra', 'project owner with required capabilities is selected');
  assert.equal(decision.device?.id, 'server-b');
  assert.equal(decision.localPath, '/srv/command-center');
  assert.equal(decision.executeLocally, false, 'device-qualified path forces relay from another device');
  assert(decision.reasons.some((reason) => reason.includes('project owner')), 'routing decision explains ownership');

  const routedTask = store.createRoutingTask({ request: 'Fix the login page.', requiredCapabilities: ['git', 'tools'], sourceAgentId: 'reika', sourceDeviceId: 'desktop-a', decision });
  store.updateRoutingTask(routedTask.id, { status: 'running' });
  const result = store.updateRoutingTask(routedTask.id, { status: 'completed', result: 'Mock Astra updated and verified the login page.' });
  assert.equal(result?.status, 'completed');
  assert.match(result?.result || '', /verified the login page/);
  assert.equal(store.listRoutingTasks()[0].id, routedTask.id, 'result returns through routing history');

  store.updateAgentStatus('astra', 'offline');
  assert.equal(store.routeTask({ projectQuery: 'CCO', task: 'Deploy', requiredCapabilities: ['git'], currentDeviceId: 'desktop-a' }).status, 'unavailable', 'offline ownership fails closed');

  const sessionMemory = store.addMemory({ content: 'Temporary confirmed plan.', scope: 'session', sessionId: 'session-1', agentId: 'reika', createdBy: 'user', source: 'session' });
  const promoted = store.promoteSessionMemory(sessionMemory.id, { scope: 'project', projectId: project.id });
  assert.equal(promoted?.scope, 'project');
  assert.equal(promoted?.sessionId, undefined);
  const manualSession = store.addMemory({ content: 'Manual temporary note.', scope: 'session', createdBy: 'user', source: 'ui' });
  assert.match(manualSession.sessionId || '', /^manual:/, 'manual session memories receive an isolated session id');
  assert.equal(manualSession.permissions.visibility, 'user_only');
  assert(manualSession.expiresAt, 'manual session memories expire by default');
  const updated = store.updateMemory(projectMemory.id, { content: 'Login uses the verified device-local OAuth callback.' });
  assert.equal(updated?.version, 2, 'memory edits retain version history metadata');
  assert.equal(store.deleteMemory(updated!.id), true, 'user can delete an incorrect memory');

  store.updateAgentStatus('astra', 'online');
  const toolRuntime = new ReikaMemoryToolRuntime(store, {
    delegateTask: async (input) => store.createRoutingTask({
      request: input.task,
      sourceAgentId: input.currentAgentId,
      sourceDeviceId: input.currentDeviceId,
      requiredCapabilities: input.requiredCapabilities,
      decision: store.routeTask(input)
    })
  });
  assert.equal(reikaMemoryToolDefinitions.length, 15, 'canonical tool catalog exposes the requested contract');
  assert.equal(toOpenAiToolSchemas().length, 15, 'OpenAI-style provider adapter covers every common tool');
  assert.equal(toCommandCenterToolSchemas().length, 15, 'Command Center adapter covers every common tool');
  assert.match(toHermesToolManifest(), /reika\.delegateTask/, 'Hermes adapter exposes the common tool names');
  const contextResult = await toolRuntime.execute(createReikaToolCall('reika.getProjectContext', { projectId: project.id, task: 'login callback' }), { actor: { agentId: 'astra', deviceId: 'server-b' }, currentAgentId: 'astra', currentDeviceId: 'server-b' });
  assert.equal(contextResult.ok, true, 'assigned agent receives compact project context');
  assert.equal((contextResult.data as { project: { id: string } }).project.id, project.id);
  const deniedContext = await toolRuntime.execute(createReikaToolCall('reika.getProjectContext', { projectId: project.id, task: 'login callback' }), { actor: { agentId: 'outsider', deviceId: 'server-b' } });
  assert.equal(deniedContext.ok, false, 'unassigned tool callers cannot read project context');
  const delegated = await toolRuntime.execute(createReikaToolCall('reika.delegateTask', { projectQuery: 'CCO', task: 'Check login', requiredCapabilities: ['git'] }), { actor: { agentId: 'reika', deviceId: 'desktop-a' }, currentAgentId: 'reika', currentDeviceId: 'desktop-a' });
  assert.equal(delegated.ok, true, 'provider-independent delegation tool creates a persisted task');
  const delegatedTask = delegated.data as { id: string };
  const cancelled = await toolRuntime.execute(createReikaToolCall('reika.cancelTask', { taskId: delegatedTask.id }), { actor: { agentId: 'reika', deviceId: 'desktop-a' } });
  assert.equal((cancelled.data as { status: string }).status, 'cancelled', 'queued tasks can be cancelled through the common tool runtime');

  const persistencePath = join(root, 'persistence.sqlite');
  const persistenceWriter = new MemoryMeshStore(persistencePath);
  persistenceWriter.registerDevice({ id: 'persisted', name: 'Persisted Device', status: 'online' });
  persistenceWriter.close();
  const persistenceReader = new MemoryMeshStore(persistencePath);
  assert.equal(persistenceReader.getDevice('persisted')?.name, 'Persisted Device', 'registry survives a database reopen');
  persistenceReader.close();

  console.log('Memory Mesh focused tests passed: registry, scope isolation, project resolution, permissions, tools, routing, cancellation, persistence, and promotion.');
} finally {
  store.close();
  rmSync(root, { recursive: true, force: true });
}
