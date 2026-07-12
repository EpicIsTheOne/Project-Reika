import { randomUUID } from 'node:crypto';
import { MemoryMeshStore } from './memoryMeshStore.js';
import type {
  MemoryAccessContext,
  MemoryRecord,
  MemoryScope,
  ReikaMemoryToolCall,
  ReikaMemoryToolDefinition,
  ReikaMemoryToolName,
  ReikaMemoryToolResult,
  RoutingTask
} from './types.js';

type JsonSchema = Record<string, unknown>;

const objectSchema = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {})
});

const string = (description: string): JsonSchema => ({ type: 'string', description });
const stringArray = (description: string): JsonSchema => ({ type: 'array', items: { type: 'string' }, description });

export const reikaMemoryToolDefinitions: ReikaMemoryToolDefinition[] = [
  { name: 'reika.listAgents', description: 'List agents registered with Reika and their availability.', readOnly: true, inputSchema: objectSchema({}) },
  { name: 'reika.getAgent', description: 'Get one registered agent by its globally unique Reika ID.', readOnly: true, inputSchema: objectSchema({ agentId: string('Agent ID') }, ['agentId']) },
  { name: 'reika.listDevices', description: 'List devices registered with Reika and their availability.', readOnly: true, inputSchema: objectSchema({}) },
  { name: 'reika.getDevice', description: 'Get one registered device by ID.', readOnly: true, inputSchema: objectSchema({ deviceId: string('Device ID') }, ['deviceId']) },
  { name: 'reika.listProjects', description: 'List known projects and their agent and device assignments.', readOnly: true, inputSchema: objectSchema({}) },
  { name: 'reika.resolveProject', description: 'Resolve a project reference by exact name, alias, recent context, or lexical fallback.', readOnly: true, inputSchema: objectSchema({ query: string('Project name or alias'), recentProjectIds: stringArray('Recently referenced project IDs') }, ['query']) },
  { name: 'reika.getProjectContext', description: 'Get compact permission-filtered project context for a task.', readOnly: true, inputSchema: objectSchema({ projectId: string('Resolved project ID'), task: string('Current task used to rank memories'), limit: { type: 'integer', minimum: 1, maximum: 20 } }, ['projectId', 'task']) },
  { name: 'reika.searchMemory', description: 'Search memories visible to the acting user or agent.', readOnly: true, inputSchema: objectSchema({ q: string('Search text'), scope: { type: 'string', enum: ['global', 'agent', 'project', 'device', 'session'] }, projectId: string('Project filter'), agentId: string('Agent filter'), deviceId: string('Device filter'), sessionId: string('Session filter'), tags: stringArray('Required tags'), limit: { type: 'integer', minimum: 1, maximum: 50 } }) },
  { name: 'reika.addMemory', description: 'Create a scoped memory. Permissions are checked by Reika, not the model.', readOnly: false, inputSchema: objectSchema({ content: string('Memory content'), scope: { type: 'string', enum: ['global', 'agent', 'project', 'device', 'session'] }, agentId: string('Owning agent ID'), projectId: string('Owning project ID'), deviceId: string('Owning device ID'), sessionId: string('Session ID'), source: string('Traceable source'), tags: stringArray('Search tags'), confidence: { type: 'number', minimum: 0, maximum: 1 }, importance: { type: 'number', minimum: 0, maximum: 1 }, visibility: { type: 'string', enum: ['global', 'private_agent', 'private_device', 'project', 'user_only'] }, access: { type: 'string', enum: ['read_only', 'read_write'] } }, ['content', 'scope', 'source']) },
  { name: 'reika.updateMemory', description: 'Update a memory visible and writable by the acting identity.', readOnly: false, inputSchema: objectSchema({ memoryId: string('Memory ID'), content: string('Replacement content'), source: string('Updated source'), tags: stringArray('Replacement tags'), confidence: { type: 'number', minimum: 0, maximum: 1 }, importance: { type: 'number', minimum: 0, maximum: 1 } }, ['memoryId']) },
  { name: 'reika.promoteSessionMemory', description: 'Promote temporary session memory into an authorized durable scope.', readOnly: false, inputSchema: objectSchema({ memoryId: string('Session memory ID'), scope: { type: 'string', enum: ['global', 'agent', 'project', 'device'] }, agentId: string('Target agent ID'), projectId: string('Target project ID'), deviceId: string('Target device ID') }, ['memoryId', 'scope']) },
  { name: 'reika.planRoute', description: 'Resolve a project and explain the best eligible agent and device without executing.', readOnly: true, inputSchema: objectSchema({ projectQuery: string('Project name or alias'), task: string('Requested work'), requiredCapabilities: stringArray('Capabilities required for the task'), recentProjectIds: stringArray('Recently referenced project IDs') }, ['projectQuery', 'task']) },
  { name: 'reika.delegateTask', description: 'Delegate project work through Reika and return the persisted routing task.', readOnly: false, inputSchema: objectSchema({ projectQuery: string('Project name or alias'), task: string('Requested work'), requiredCapabilities: stringArray('Capabilities required for the task'), recentProjectIds: stringArray('Recently referenced project IDs') }, ['projectQuery', 'task']) },
  { name: 'reika.getTaskStatus', description: 'Get persisted status, result, route explanation, or failure for a delegated task.', readOnly: true, inputSchema: objectSchema({ taskId: string('Routing task ID') }, ['taskId']) },
  { name: 'reika.cancelTask', description: 'Cancel a queued or running routing task. Completed tasks remain unchanged.', readOnly: false, inputSchema: objectSchema({ taskId: string('Routing task ID') }, ['taskId']) }
];

export interface ReikaToolExecutionContext {
  actor: MemoryAccessContext;
  sessionId?: string;
  currentAgentId?: string;
  currentDeviceId?: string;
}

export interface ReikaMemoryToolRuntimeOptions {
  delegateTask: (input: { projectQuery: string; task: string; requiredCapabilities?: string[]; currentAgentId?: string; currentDeviceId?: string; recentProjectIds?: string[] }) => Promise<RoutingTask>;
  cancelTask?: (taskId: string) => RoutingTask | undefined;
}

export class ReikaMemoryToolRuntime {
  constructor(private readonly store: MemoryMeshStore, private readonly options: ReikaMemoryToolRuntimeOptions) {}

  definitions() { return reikaMemoryToolDefinitions; }

  async execute(call: ReikaMemoryToolCall, context: ReikaToolExecutionContext): Promise<ReikaMemoryToolResult> {
    try {
      const data = await this.dispatch(call.name, call.arguments || {}, context);
      return { toolCallId: call.id, name: call.name, ok: true, data };
    } catch (error) {
      return { toolCallId: call.id, name: call.name, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async dispatch(name: ReikaMemoryToolName, args: Record<string, unknown>, context: ReikaToolExecutionContext): Promise<unknown> {
    const actor = context.actor;
    switch (name) {
      case 'reika.listAgents': return this.store.listAgents();
      case 'reika.getAgent': return requireFound(this.store.getAgent(requiredString(args.agentId, 'agentId')), 'Agent');
      case 'reika.listDevices': return this.store.listDevices();
      case 'reika.getDevice': return requireFound(this.store.getDevice(requiredString(args.deviceId, 'deviceId')), 'Device');
      case 'reika.listProjects': return this.store.listProjects().filter((project) => actor.isUser || project.agentAssignments.some((assignment) => assignment.agentId === actor.agentId));
      case 'reika.resolveProject': {
        const resolution = this.store.resolveProject(requiredString(args.query, 'query'), { recentProjectIds: stringList(args.recentProjectIds), agentId: context.currentAgentId || actor.agentId });
        if (!actor.isUser) {
          resolution.candidates = resolution.candidates.filter((candidate) => candidate.project.agentAssignments.some((assignment) => assignment.agentId === actor.agentId));
          if (resolution.project && !resolution.project.agentAssignments.some((assignment) => assignment.agentId === actor.agentId)) return { status: 'not_found', query: resolution.query, candidates: [] };
        }
        return resolution;
      }
      case 'reika.getProjectContext': {
        const project = requireFound(this.store.getProject(requiredString(args.projectId, 'projectId')), 'Project');
        assertProjectRead(project.agentAssignments, actor);
        const task = requiredString(args.task, 'task');
        const memories = this.store.getRelevantMemories({ task, projectId: project.id, agentId: actor.agentId, deviceId: actor.deviceId, sessionId: context.sessionId, limit: boundedNumber(args.limit, 8, 1, 20) }, actor);
        return { project, memories, retrievedAt: new Date().toISOString() };
      }
      case 'reika.searchMemory': return this.store.searchMemory({ q: optionalString(args.q), scope: optionalScope(args.scope), projectId: optionalString(args.projectId), agentId: optionalString(args.agentId), deviceId: optionalString(args.deviceId), sessionId: optionalString(args.sessionId), tags: stringList(args.tags), limit: boundedNumber(args.limit, 20, 1, 50) }, actor);
      case 'reika.addMemory': {
        const scope = requiredScope(args.scope);
        return this.store.addMemory({
          content: requiredString(args.content, 'content'), scope, agentId: optionalString(args.agentId), projectId: optionalString(args.projectId), deviceId: optionalString(args.deviceId), sessionId: optionalString(args.sessionId) || (scope === 'session' ? context.sessionId : undefined),
          createdBy: actor.isUser ? 'user' : requiredString(actor.agentId, 'acting agent'), source: requiredString(args.source, 'source'), tags: stringList(args.tags), confidence: boundedNumber(args.confidence, 0.8, 0, 1), importance: boundedNumber(args.importance, 0.5, 0, 1),
          permissions: { visibility: validVisibility(args.visibility, scope), access: args.access === 'read_only' ? 'read_only' : 'read_write' }
        }, actor);
      }
      case 'reika.updateMemory': {
        const memoryId = requiredString(args.memoryId, 'memoryId');
        const patch: Partial<MemoryRecord> = {};
        if (typeof args.content === 'string') patch.content = args.content;
        if (typeof args.source === 'string') patch.source = args.source;
        if (Array.isArray(args.tags)) patch.tags = stringList(args.tags);
        if (args.confidence !== undefined) patch.confidence = boundedNumber(args.confidence, 0.8, 0, 1);
        if (args.importance !== undefined) patch.importance = boundedNumber(args.importance, 0.5, 0, 1);
        return requireFound(this.store.updateMemory(memoryId, patch, actor), 'Memory');
      }
      case 'reika.promoteSessionMemory': return requireFound(this.store.promoteSessionMemory(requiredString(args.memoryId, 'memoryId'), { scope: requiredDurableScope(args.scope), agentId: optionalString(args.agentId), projectId: optionalString(args.projectId), deviceId: optionalString(args.deviceId) }, actor), 'Session memory');
      case 'reika.planRoute': return this.store.routeTask({ projectQuery: requiredString(args.projectQuery, 'projectQuery'), task: requiredString(args.task, 'task'), requiredCapabilities: stringList(args.requiredCapabilities), currentAgentId: context.currentAgentId || actor.agentId, currentDeviceId: context.currentDeviceId || actor.deviceId, recentProjectIds: stringList(args.recentProjectIds) });
      case 'reika.delegateTask': return this.options.delegateTask({ projectQuery: requiredString(args.projectQuery, 'projectQuery'), task: requiredString(args.task, 'task'), requiredCapabilities: stringList(args.requiredCapabilities), currentAgentId: context.currentAgentId || actor.agentId, currentDeviceId: context.currentDeviceId || actor.deviceId, recentProjectIds: stringList(args.recentProjectIds) });
      case 'reika.getTaskStatus': return requireFound(this.store.getRoutingTask(requiredString(args.taskId, 'taskId')), 'Routing task');
      case 'reika.cancelTask': {
        const taskId = requiredString(args.taskId, 'taskId');
        return requireFound(this.options.cancelTask?.(taskId) ?? this.store.cancelRoutingTask(taskId), 'Routing task');
      }
    }
  }
}

export function createReikaToolCall(name: ReikaMemoryToolName, args: Record<string, unknown>): ReikaMemoryToolCall {
  return { id: randomUUID(), name, arguments: args };
}

export function toOpenAiToolSchemas(definitions = reikaMemoryToolDefinitions) {
  return definitions.map((definition) => ({ type: 'function', function: { name: definition.name.replace(/\./g, '__'), description: definition.description, parameters: definition.inputSchema }, 'x-reika-tool-name': definition.name }));
}

export function toCommandCenterToolSchemas(definitions = reikaMemoryToolDefinitions) {
  return definitions.map((definition) => ({ name: definition.name, description: definition.description, inputSchema: definition.inputSchema, readOnly: definition.readOnly }));
}

export function toHermesToolManifest(definitions = reikaMemoryToolDefinitions) {
  return definitions.map((definition) => `${definition.name}${definition.readOnly ? ' [read]' : ' [write]'}: ${definition.description}`).join('\n');
}

function assertProjectRead(assignments: Array<{ agentId: string }>, actor: MemoryAccessContext) {
  if (!actor.isUser && !assignments.some((assignment) => assignment.agentId === actor.agentId)) throw new Error('This actor is not assigned to the project.');
}
function requiredString(value: unknown, name: string) { const result = optionalString(value); if (!result) throw new Error(`${name} is required.`); return result; }
function optionalString(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function stringList(value: unknown) { return Array.from(new Set((Array.isArray(value) ? value : []).map((item) => String(item).trim()).filter(Boolean))); }
function boundedNumber(value: unknown, fallback: number, min: number, max: number) { const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback; }
function optionalScope(value: unknown): MemoryScope | undefined { return ['global', 'agent', 'project', 'device', 'session'].includes(String(value)) ? value as MemoryScope : undefined; }
function requiredScope(value: unknown): MemoryScope { const scope = optionalScope(value); if (!scope) throw new Error('scope is required.'); return scope; }
function requiredDurableScope(value: unknown): Exclude<MemoryScope, 'session'> { const scope = requiredScope(value); if (scope === 'session') throw new Error('Promotion target must be durable.'); return scope; }
function validVisibility(value: unknown, scope: MemoryScope): MemoryRecord['permissions']['visibility'] { if (['global', 'private_agent', 'private_device', 'project', 'user_only'].includes(String(value))) return value as MemoryRecord['permissions']['visibility']; return scope === 'agent' ? 'private_agent' : scope === 'project' ? 'project' : scope === 'device' ? 'private_device' : scope === 'global' ? 'global' : 'private_agent'; }
function requireFound<T>(value: T | undefined, label: string): T { if (value === undefined) throw new Error(`${label} not found.`); return value; }
