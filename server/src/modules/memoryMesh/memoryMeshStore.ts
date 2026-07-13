import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  MemoryAccess,
  MemoryAccessContext,
  MemoryPermission,
  MemoryRecord,
  MemoryScope,
  MeshAgent,
  MeshDevice,
  MeshProject,
  MeshStatus,
  ProjectAgentAssignment,
  ProjectDeviceAssignment,
  ProjectPath,
  ProjectResolution,
  RouteDecision,
  RoutingTask
} from './types.js';

const defaultStorePath = join(homedir(), '.local', 'share', 'project-reika', 'memory-mesh.sqlite');

function storagePath() {
  return process.env.REIKA_MEMORY_MESH_PATH || defaultStorePath;
}

type Row = Record<string, unknown>;

export class MemoryMeshStore {
  private readonly path: string;
  private readonly db: DatabaseSync;

  constructor(path = storagePath()) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
    this.recoverInterruptedTasks();
  }

  close() {
    this.db.close();
  }

  snapshot() {
    return {
      path: this.path,
      schemaVersion: Number((this.db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM mesh_schema_migrations').get() as Row).version || 0),
      agentCount: this.count('mesh_agents'),
      deviceCount: this.count('mesh_devices'),
      projectCount: this.count('mesh_projects'),
      memoryCount: this.count('mesh_memories'),
      taskCount: this.count('mesh_routing_tasks')
    };
  }

  registerAgent(input: Partial<MeshAgent> & Pick<MeshAgent, 'id' | 'displayName'>): MeshAgent {
    const existing = this.getAgent(input.id);
    const now = new Date().toISOString();
    const agent: MeshAgent = {
      id: cleanId(input.id),
      displayName: cleanText(input.displayName) || input.id,
      description: cleanText(input.description ?? existing?.description),
      capabilities: cleanList(input.capabilities ?? existing?.capabilities),
      providerId: cleanText(input.providerId ?? existing?.providerId) || 'unknown-provider',
      providerAgentId: cleanText(input.providerAgentId ?? existing?.providerAgentId) || input.id,
      deviceId: cleanText(input.deviceId ?? existing?.deviceId) || 'unknown-device',
      status: cleanStatus(input.status ?? existing?.status),
      supportedTools: cleanList(input.supportedTools ?? existing?.supportedTools),
      permissions: cleanList(input.permissions ?? existing?.permissions),
      relayEndpoint: optionalText(input.relayEndpoint ?? existing?.relayEndpoint),
      lastSeenAt: optionalText(input.lastSeenAt ?? existing?.lastSeenAt),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.db.prepare(`
      INSERT INTO mesh_agents (id, display_name, description, capabilities_json, provider_id, provider_agent_id, device_id, status, supported_tools_json, permissions_json, relay_endpoint, last_seen_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, description=excluded.description, capabilities_json=excluded.capabilities_json,
        provider_id=excluded.provider_id, provider_agent_id=excluded.provider_agent_id, device_id=excluded.device_id, status=excluded.status, supported_tools_json=excluded.supported_tools_json,
        permissions_json=excluded.permissions_json, relay_endpoint=excluded.relay_endpoint, last_seen_at=excluded.last_seen_at, updated_at=excluded.updated_at
    `).run(agent.id, agent.displayName, agent.description, json(agent.capabilities), agent.providerId, agent.providerAgentId, agent.deviceId, agent.status, json(agent.supportedTools), json(agent.permissions), agent.relayEndpoint ?? null, agent.lastSeenAt ?? null, agent.createdAt, agent.updatedAt);
    return agent;
  }

  updateAgentStatus(id: string, status: MeshStatus, lastSeenAt = new Date().toISOString()) {
    const current = this.getAgent(id);
    if (!current) return undefined;
    return this.registerAgent({ ...current, status, lastSeenAt });
  }

  getAgent(id: string) {
    const row = this.db.prepare('SELECT * FROM mesh_agents WHERE id = ?').get(id) as Row | undefined;
    return row ? mapAgent(row) : undefined;
  }

  listAgents() {
    return (this.db.prepare('SELECT * FROM mesh_agents ORDER BY display_name COLLATE NOCASE').all() as Row[]).map(mapAgent);
  }

  registerDevice(input: Partial<MeshDevice> & Pick<MeshDevice, 'id' | 'name'>): MeshDevice {
    const existing = this.getDevice(input.id);
    const now = new Date().toISOString();
    const device: MeshDevice = {
      id: cleanId(input.id),
      name: cleanText(input.name) || input.id,
      operatingSystem: cleanText(input.operatingSystem ?? existing?.operatingSystem) || 'unknown',
      status: cleanStatus(input.status ?? existing?.status),
      availableProviders: cleanList(input.availableProviders ?? existing?.availableProviders),
      availableTools: cleanList(input.availableTools ?? existing?.availableTools),
      relayEndpoint: optionalText(input.relayEndpoint ?? existing?.relayEndpoint),
      lastSeenAt: optionalText(input.lastSeenAt ?? existing?.lastSeenAt),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.db.prepare(`
      INSERT INTO mesh_devices (id, name, operating_system, status, available_providers_json, available_tools_json, relay_endpoint, last_seen_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, operating_system=excluded.operating_system, status=excluded.status,
        available_providers_json=excluded.available_providers_json, available_tools_json=excluded.available_tools_json,
        relay_endpoint=excluded.relay_endpoint, last_seen_at=excluded.last_seen_at, updated_at=excluded.updated_at
    `).run(device.id, device.name, device.operatingSystem, device.status, json(device.availableProviders), json(device.availableTools), device.relayEndpoint ?? null, device.lastSeenAt ?? null, device.createdAt, device.updatedAt);
    return device;
  }

  updateDeviceStatus(id: string, status: MeshStatus, lastSeenAt = new Date().toISOString()) {
    const current = this.getDevice(id);
    if (!current) return undefined;
    return this.registerDevice({ ...current, status, lastSeenAt });
  }

  getDevice(id: string) {
    const row = this.db.prepare('SELECT * FROM mesh_devices WHERE id = ?').get(id) as Row | undefined;
    return row ? mapDevice(row) : undefined;
  }

  listDevices() {
    return (this.db.prepare('SELECT * FROM mesh_devices ORDER BY name COLLATE NOCASE').all() as Row[]).map(mapDevice);
  }

  createProject(input: Partial<MeshProject> & Pick<MeshProject, 'name'>): MeshProject {
    const id = cleanId(input.id || slug(input.name) || randomUUID());
    const existing = this.getProject(id);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO mesh_projects (id, name, aliases_json, description, status, repository_url, technology_stack_json, permissions_json, primary_agent_id, primary_device_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, aliases_json=excluded.aliases_json, description=excluded.description, status=excluded.status,
        repository_url=excluded.repository_url, technology_stack_json=excluded.technology_stack_json, permissions_json=excluded.permissions_json,
        primary_agent_id=excluded.primary_agent_id, primary_device_id=excluded.primary_device_id, updated_at=excluded.updated_at
    `).run(
      id,
      cleanText(input.name) || existing?.name || id,
      json(cleanList(input.aliases ?? existing?.aliases)),
      cleanText(input.description ?? existing?.description),
      cleanText(input.status ?? existing?.status) || 'active',
      optionalText(input.repositoryUrl ?? existing?.repositoryUrl) ?? null,
      json(cleanList(input.technologyStack ?? existing?.technologyStack)),
      json(cleanList(input.permissions ?? existing?.permissions)),
      optionalText(input.primaryAgentId ?? existing?.primaryAgentId) ?? null,
      optionalText(input.primaryDeviceId ?? existing?.primaryDeviceId) ?? null,
      existing?.createdAt ?? now,
      now
    );
    return this.getProject(id)!;
  }

  updateProject(id: string, input: Partial<MeshProject>) {
    const existing = this.getProject(id);
    if (!existing) return undefined;
    return this.createProject({ ...existing, ...input, id, name: input.name ?? existing.name });
  }

  deleteProject(id: string) {
    return this.db.prepare('DELETE FROM mesh_projects WHERE id = ?').run(id).changes > 0;
  }

  assignAgentToProject(projectId: string, agentId: string, options: { role?: 'primary' | 'collaborator'; access?: MemoryAccess } = {}) {
    this.requireProject(projectId);
    if (!this.getAgent(agentId)) throw new Error(`Agent not found: ${agentId}`);
    const role = options.role === 'primary' ? 'primary' : 'collaborator';
    const access = options.access === 'read_only' ? 'read_only' : 'read_write';
    this.db.prepare(`INSERT INTO mesh_project_agents (project_id, agent_id, role, access) VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id, agent_id) DO UPDATE SET role=excluded.role, access=excluded.access`).run(projectId, agentId, role, access);
    if (role === 'primary') this.db.prepare('UPDATE mesh_projects SET primary_agent_id = ?, updated_at = ? WHERE id = ?').run(agentId, new Date().toISOString(), projectId);
    return this.getProject(projectId)!;
  }

  unassignAgentFromProject(projectId: string, agentId: string) {
    this.db.prepare('DELETE FROM mesh_project_agents WHERE project_id = ? AND agent_id = ?').run(projectId, agentId);
    this.db.prepare('UPDATE mesh_projects SET primary_agent_id = NULL, updated_at = ? WHERE id = ? AND primary_agent_id = ?').run(new Date().toISOString(), projectId, agentId);
    return this.getProject(projectId);
  }

  assignDeviceToProject(projectId: string, deviceId: string, options: { isPrimary?: boolean; path?: string } = {}) {
    this.requireProject(projectId);
    if (!this.getDevice(deviceId)) throw new Error(`Device not found: ${deviceId}`);
    const primary = options.isPrimary ? 1 : 0;
    this.db.prepare(`INSERT INTO mesh_project_devices (project_id, device_id, is_primary) VALUES (?, ?, ?)
      ON CONFLICT(project_id, device_id) DO UPDATE SET is_primary=excluded.is_primary`).run(projectId, deviceId, primary);
    if (options.path?.trim()) {
      this.db.prepare(`INSERT INTO mesh_project_paths (project_id, device_id, local_path, is_primary) VALUES (?, ?, ?, ?)
        ON CONFLICT(project_id, device_id, local_path) DO UPDATE SET is_primary=excluded.is_primary`).run(projectId, deviceId, options.path.trim(), primary);
    }
    if (primary) this.db.prepare('UPDATE mesh_projects SET primary_device_id = ?, updated_at = ? WHERE id = ?').run(deviceId, new Date().toISOString(), projectId);
    return this.getProject(projectId)!;
  }

  unassignDeviceFromProject(projectId: string, deviceId: string) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM mesh_project_paths WHERE project_id = ? AND device_id = ?').run(projectId, deviceId);
      this.db.prepare('DELETE FROM mesh_project_devices WHERE project_id = ? AND device_id = ?').run(projectId, deviceId);
      this.db.prepare('UPDATE mesh_projects SET primary_device_id = NULL, updated_at = ? WHERE id = ? AND primary_device_id = ?').run(new Date().toISOString(), projectId, deviceId);
    });
    return this.getProject(projectId);
  }

  getProject(id: string) {
    const row = this.db.prepare('SELECT * FROM mesh_projects WHERE id = ?').get(id) as Row | undefined;
    return row ? this.hydrateProject(row) : undefined;
  }

  listProjects() {
    return (this.db.prepare('SELECT * FROM mesh_projects ORDER BY updated_at DESC, name COLLATE NOCASE').all() as Row[]).map((row) => this.hydrateProject(row));
  }

  resolveProject(query: string, context: { recentProjectIds?: string[]; agentId?: string } = {}): ProjectResolution {
    const normalized = normalizeSearch(query);
    if (!normalized) return { status: 'not_found', query, candidates: [] };
    const scored = this.listProjects().map((project) => scoreProject(project, normalized, context)).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || b.project.updatedAt.localeCompare(a.project.updatedAt));
    if (!scored.length) return { status: 'not_found', query, candidates: [] };
    const exact = scored.filter((item) => item.score >= 900);
    if (exact.length === 1) return { status: 'resolved', query, project: exact[0].project, candidates: scored.slice(0, 5) };
    if (exact.length > 1 || (scored.length > 1 && scored[0].score - scored[1].score < 15)) return { status: 'ambiguous', query, candidates: scored.slice(0, 5) };
    return { status: 'resolved', query, project: scored[0].project, candidates: scored.slice(0, 5) };
  }

  addMemory(input: Partial<MemoryRecord> & Pick<MemoryRecord, 'content' | 'scope' | 'createdBy' | 'source'>, actor: MemoryAccessContext = { isUser: true }): MemoryRecord {
    const now = new Date().toISOString();
    const scope = cleanScope(input.scope);
    const permissions = scope === 'session'
      ? { visibility: actor.isUser ? 'user_only' as const : 'private_agent' as const, access: input.permissions?.access === 'read_only' ? 'read_only' as const : 'read_write' as const }
      : normalizePermission(input.permissions, scope);
    const record: MemoryRecord = {
      id: cleanId(input.id || randomUUID()),
      content: cleanText(input.content),
      scope,
      agentId: optionalText(input.agentId) ?? (scope === 'session' ? actor.agentId : undefined),
      projectId: optionalText(input.projectId),
      deviceId: optionalText(input.deviceId),
      sessionId: optionalText(input.sessionId) ?? (scope === 'session' ? `manual:${randomUUID()}` : undefined),
      createdBy: cleanText(input.createdBy),
      source: cleanText(input.source),
      tags: cleanList(input.tags),
      createdAt: input.createdAt || now,
      updatedAt: now,
      confidence: clampNumber(input.confidence, 0, 1, 0.8),
      importance: clampNumber(input.importance, 0, 1, 0.5),
      permissions,
      provenance: normalizeProvenance(input.provenance),
      expiresAt: optionalText(input.expiresAt) ?? (scope === 'session' ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : undefined),
      version: Math.max(1, Number(input.version || 1))
    };
    validateMemory(record);
    if (!actor.isUser && record.createdBy !== actor.agentId) throw new Error('createdBy must match the acting agent.');
    if (!actor.isUser && !this.canWriteMemory(record, actor)) throw new Error('This actor cannot write to the requested memory scope.');
    this.db.prepare(`INSERT INTO mesh_memories
      (id, content, scope, agent_id, project_id, device_id, session_id, created_by, source, tags_json, created_at, updated_at, confidence, importance, permissions_json, provenance_json, expires_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(record.id, record.content, record.scope, record.agentId ?? null, record.projectId ?? null, record.deviceId ?? null, record.sessionId ?? null, record.createdBy, record.source, json(record.tags), record.createdAt, record.updatedAt, record.confidence, record.importance, json(record.permissions), json(record.provenance ?? {}), record.expiresAt ?? null, record.version);
    return record;
  }

  getMemory(id: string, actor: MemoryAccessContext = { isUser: true }) {
    const row = this.db.prepare('SELECT * FROM mesh_memories WHERE id = ?').get(id) as Row | undefined;
    if (!row) return undefined;
    const memory = mapMemory(row);
    return this.canReadMemory(memory, actor) ? memory : undefined;
  }

  updateMemory(id: string, input: Partial<MemoryRecord>, actor: MemoryAccessContext = { isUser: true }) {
    const current = this.getMemory(id, actor);
    if (!current) return undefined;
    if (!this.canWriteMemory(current, actor)) throw new Error('Memory is read-only for this actor.');
    const next = { ...current, ...input, id, updatedAt: new Date().toISOString(), version: current.version + 1 };
    validateMemory(next);
    this.db.prepare(`UPDATE mesh_memories SET content=?, scope=?, agent_id=?, project_id=?, device_id=?, session_id=?, source=?, tags_json=?, updated_at=?, confidence=?, importance=?, permissions_json=?, provenance_json=?, expires_at=?, version=? WHERE id=?`)
      .run(next.content, next.scope, next.agentId ?? null, next.projectId ?? null, next.deviceId ?? null, next.sessionId ?? null, next.source, json(next.tags), next.updatedAt, next.confidence, next.importance, json(next.permissions), json(next.provenance ?? {}), next.expiresAt ?? null, next.version, id);
    return next;
  }

  deleteMemory(id: string, actor: MemoryAccessContext = { isUser: true }) {
    const current = this.getMemory(id, actor);
    if (!current) return false;
    if (!this.canWriteMemory(current, actor)) throw new Error('Memory is read-only for this actor.');
    return this.db.prepare('DELETE FROM mesh_memories WHERE id = ?').run(id).changes > 0;
  }

  searchMemory(input: { q?: string; scope?: MemoryScope; projectId?: string; agentId?: string; deviceId?: string; sessionId?: string; tags?: string[]; limit?: number } = {}, actor: MemoryAccessContext = { isUser: true }) {
    const query = normalizeSearch(input.q || '');
    const now = new Date().toISOString();
    return (this.db.prepare('SELECT * FROM mesh_memories WHERE expires_at IS NULL OR expires_at > ? ORDER BY importance DESC, updated_at DESC').all(now) as Row[])
      .map(mapMemory)
      .filter((memory) => !input.scope || memory.scope === input.scope)
      .filter((memory) => !input.projectId || memory.projectId === input.projectId)
      .filter((memory) => !input.agentId || memory.agentId === input.agentId)
      .filter((memory) => !input.deviceId || memory.deviceId === input.deviceId)
      .filter((memory) => !input.sessionId || memory.sessionId === input.sessionId)
      .filter((memory) => !input.tags?.length || input.tags.every((tag) => memory.tags.map(normalizeSearch).includes(normalizeSearch(tag))))
      .filter((memory) => !query || normalizeSearch([memory.content, memory.source, memory.tags.join(' ')].join(' ')).includes(query))
      .filter((memory) => this.canReadMemory(memory, actor))
      .slice(0, Math.max(1, Math.min(200, input.limit ?? 50)));
  }

  getRelevantMemories(input: { task: string; projectId?: string; agentId?: string; deviceId?: string; sessionId?: string; limit?: number }, actor: MemoryAccessContext) {
    const terms = tokens(input.task);
    return this.searchMemory({ projectId: input.projectId, limit: 200 }, actor)
      .concat(this.searchMemory({ scope: 'global', limit: 100 }, actor))
      .concat(input.agentId ? this.searchMemory({ agentId: input.agentId, limit: 100 }, actor) : [])
      .concat(input.deviceId ? this.searchMemory({ deviceId: input.deviceId, limit: 100 }, actor) : [])
      .concat(input.sessionId ? this.searchMemory({ sessionId: input.sessionId, limit: 100 }, actor) : [])
      .filter(uniqueById)
      .map((memory) => ({ memory, score: memory.importance * 20 + overlapScore(terms, tokens(`${memory.content} ${memory.tags.join(' ')}`)) }))
      .sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt))
      .slice(0, Math.max(1, Math.min(30, input.limit ?? 8)))
      .map((item) => item.memory);
  }

  promoteSessionMemory(id: string, target: { scope: Exclude<MemoryScope, 'session'>; agentId?: string; projectId?: string; deviceId?: string }, actor: MemoryAccessContext = { isUser: true }) {
    const memory = this.getMemory(id, actor);
    if (!memory || memory.scope !== 'session') return undefined;
    return this.updateMemory(id, { ...target, sessionId: undefined, expiresAt: undefined, permissions: normalizePermission(undefined, target.scope) }, actor);
  }

  routeTask(input: { projectQuery: string; task: string; requiredCapabilities?: string[]; currentAgentId?: string; currentDeviceId?: string; recentProjectIds?: string[] }): RouteDecision {
    const resolution = this.resolveProject(input.projectQuery, { recentProjectIds: input.recentProjectIds, agentId: input.currentAgentId });
    if (resolution.status === 'not_found') return { status: 'project_not_found', executeLocally: false, reasons: [`No project matched "${input.projectQuery}".`], considered: [] };
    if (resolution.status === 'ambiguous') return { status: 'ambiguous_project', executeLocally: false, reasons: [`Multiple projects matched "${input.projectQuery}".`], considered: [] };
    const project = resolution.project!;
    const required = cleanList(input.requiredCapabilities).map(normalizeSearch);
    const considered = project.agentAssignments.map((assignment) => {
      const agent = this.getAgent(assignment.agentId);
      if (!agent) return { agentId: assignment.agentId, eligible: false, score: 0, reasons: ['Agent registry record is missing.'] };
      const device = this.getDevice(agent.deviceId);
      const paths = project.paths.filter((path) => path.deviceId === agent.deviceId);
      const reasons: string[] = [];
      let score = 0;
      const missing = required.filter((capability) => !agent.capabilities.map(normalizeSearch).includes(capability));
      if (missing.length) reasons.push(`Missing required capabilities: ${missing.join(', ')}.`);
      if (!device) reasons.push('Assigned device is missing from the registry.');
      if (!paths.length) reasons.push('No project path is registered on the agent device.');
      if (assignment.access === 'read_only') reasons.push('Project assignment is read-only.');
      if (agent.status === 'online') { score += 50; reasons.push('Agent is online.'); }
      else reasons.push(`Agent is ${agent.status}.`);
      if (device?.status === 'online') { score += 40; reasons.push('Device is online.'); }
      else if (device) reasons.push(`Device is ${device.status}.`);
      if (assignment.role === 'primary' || project.primaryAgentId === agent.id) { score += 100; reasons.push('Agent is the project owner.'); }
      if (project.primaryDeviceId === agent.deviceId) { score += 25; reasons.push('Project primary device matches.'); }
      if (agent.id === input.currentAgentId && agent.deviceId === input.currentDeviceId) { score += 15; reasons.push('Current agent can execute locally.'); }
      score += required.length * 10;
      const eligible = !missing.length && Boolean(device) && paths.length > 0 && assignment.access === 'read_write' && agent.status === 'online' && device?.status === 'online';
      return { agentId: agent.id, eligible, score, reasons };
    });
    const winner = considered.filter((item) => item.eligible).sort((a, b) => b.score - a.score)[0];
    if (!winner) return { status: 'unavailable', project, executeLocally: false, reasons: ['No assigned agent currently satisfies the capability, permission, device, path, and online checks.'], considered };
    const agent = this.getAgent(winner.agentId)!;
    const device = this.getDevice(agent.deviceId)!;
    const localPath = project.paths.find((path) => path.deviceId === device.id && path.isPrimary)?.path ?? project.paths.find((path) => path.deviceId === device.id)?.path;
    const approvalRequired = project.permissions.includes('route:approval') || agent.permissions.includes('route:approval');
    const approvalReason = approvalRequired ? `${project.name} requires user approval before delegated work begins.` : undefined;
    return {
      status: 'selected', project, agent, device, providerId: agent.providerId, localPath,
      executeLocally: device.id === input.currentDeviceId,
      score: winner.score, approvalRequired, approvalReason, reasons: winner.reasons, considered
    };
  }

  createRoutingTask(input: { request: string; requiredCapabilities?: string[]; sourceAgentId?: string; sourceDeviceId?: string; originConversationId?: string; originMessageId?: string; sharedContextRefs?: string[]; decision: RouteDecision }) {
    const now = new Date().toISOString();
    const task: RoutingTask = {
      id: randomUUID(),
      originConversationId: optionalText(input.originConversationId),
      originMessageId: optionalText(input.originMessageId),
      projectId: input.decision.project?.id,
      sourceAgentId: optionalText(input.sourceAgentId),
      sourceDeviceId: optionalText(input.sourceDeviceId),
      targetAgentId: input.decision.agent?.id,
      targetDeviceId: input.decision.device?.id,
      request: cleanText(input.request),
      requiredCapabilities: cleanList(input.requiredCapabilities),
      sharedContextRefs: cleanList(input.sharedContextRefs),
      status: input.decision.status === 'selected' ? (input.decision.approvalRequired ? 'awaiting_approval' : 'queued') : 'unavailable',
      decision: input.decision,
      memoryWritebackIds: [],
      lifecycle: [],
      approvalRequired: Boolean(input.decision.approvalRequired),
      createdAt: now,
      updatedAt: now
    };
    task.lifecycle = [
      { status: 'resolving', at: now, progress: `Resolving ${input.decision.project?.name || 'project'}.` },
      { status: 'planning', at: now, progress: input.decision.reasons[0] || 'Evaluating eligible agents and nodes.' },
      { status: task.status, at: now, ...(input.decision.approvalReason ? { progress: input.decision.approvalReason } : {}) }
    ];
    this.db.prepare(`INSERT INTO mesh_routing_tasks (id, origin_conversation_id, origin_message_id, project_id, source_agent_id, source_device_id, target_agent_id, target_device_id, request, required_capabilities_json, shared_context_refs_json, status, decision_json, result, error, memory_writeback_ids_json, lifecycle_json, approval_required, created_at, updated_at, sent_at, accepted_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '[]', ?, ?, ?, ?, NULL, NULL, NULL)`)
      .run(task.id, task.originConversationId ?? null, task.originMessageId ?? null, task.projectId ?? null, task.sourceAgentId ?? null, task.sourceDeviceId ?? null, task.targetAgentId ?? null, task.targetDeviceId ?? null, task.request, json(task.requiredCapabilities), json(task.sharedContextRefs), task.status, json(task.decision), json(task.lifecycle), task.approvalRequired ? 1 : 0, now, now);
    return task;
  }

  updateRoutingTask(id: string, input: { status: RoutingTask['status']; progress?: string; result?: string; error?: string; memoryWritebackIds?: string[]; sharedContextRefs?: string[] }) {
    const current = this.getRoutingTask(id);
    if (!current) return undefined;
    const now = new Date().toISOString();
    const terminal = ['completed', 'failed', 'unavailable', 'cancelled', 'timed_out'].includes(input.status);
    const lifecycle = [...current.lifecycle, { status: input.status, at: now, ...(input.progress ? { progress: cleanText(input.progress) } : {}) }];
    const memoryWritebackIds = cleanList(input.memoryWritebackIds ?? current.memoryWritebackIds);
    const sharedContextRefs = cleanList(input.sharedContextRefs ?? current.sharedContextRefs);
    const sentAt = current.sentAt ?? (input.status === 'sent' ? now : undefined);
    const acceptedAt = current.acceptedAt ?? (input.status === 'accepted' ? now : undefined);
    this.db.prepare('UPDATE mesh_routing_tasks SET status=?, progress=?, result=?, error=?, shared_context_refs_json=?, memory_writeback_ids_json=?, lifecycle_json=?, sent_at=?, accepted_at=?, updated_at=?, completed_at=? WHERE id=?')
      .run(input.status, input.progress ?? current.progress ?? null, input.result ?? current.result ?? null, input.error ?? current.error ?? null, json(sharedContextRefs), json(memoryWritebackIds), json(lifecycle), sentAt ?? null, acceptedAt ?? null, now, terminal ? now : null, id);
    return this.getRoutingTask(id);
  }

  cancelRoutingTask(id: string) {
    const task = this.getRoutingTask(id);
    if (!task) return undefined;
    if (['completed', 'failed', 'unavailable', 'cancelled', 'timed_out'].includes(task.status)) return task;
    return this.updateRoutingTask(id, { status: 'cancelled', error: 'Cancelled by request.' });
  }

  getRoutingTask(id: string) {
    const row = this.db.prepare('SELECT * FROM mesh_routing_tasks WHERE id = ?').get(id) as Row | undefined;
    return row ? mapRoutingTask(row) : undefined;
  }

  listRoutingTasks(limit = 50) {
    return (this.db.prepare('SELECT * FROM mesh_routing_tasks ORDER BY created_at DESC LIMIT ?').all(Math.max(1, Math.min(200, limit))) as Row[]).map(mapRoutingTask);
  }

  private canReadMemory(memory: MemoryRecord, actor: MemoryAccessContext) {
    if (actor.isUser) return true;
    const visibility = memory.permissions.visibility;
    if (visibility === 'global') return true;
    if (visibility === 'user_only') return false;
    if (visibility === 'private_agent') return Boolean(actor.agentId && actor.agentId === memory.agentId);
    if (visibility === 'private_device') return Boolean(actor.deviceId && actor.deviceId === memory.deviceId);
    if (visibility === 'project' && memory.projectId && actor.agentId) {
      return Boolean(this.db.prepare('SELECT 1 AS allowed FROM mesh_project_agents WHERE project_id = ? AND agent_id = ?').get(memory.projectId, actor.agentId));
    }
    return false;
  }

  private canWriteMemory(memory: MemoryRecord, actor: MemoryAccessContext) {
    if (actor.isUser) return true;
    if (memory.permissions.access === 'read_only') return false;
    const visibility = memory.permissions.visibility;
    if (visibility === 'user_only') return false;
    if (visibility === 'global') return Boolean(actor.agentId && this.getAgent(actor.agentId)?.permissions.includes('memory:global:write'));
    if (visibility === 'private_agent') return Boolean(actor.agentId && actor.agentId === memory.agentId);
    if (visibility === 'private_device') return Boolean(actor.deviceId && actor.deviceId === memory.deviceId);
    if (visibility === 'project' && memory.projectId && actor.agentId) {
      const assignment = this.db.prepare('SELECT access FROM mesh_project_agents WHERE project_id = ? AND agent_id = ?').get(memory.projectId, actor.agentId) as Row | undefined;
      return assignment?.access === 'read_write';
    }
    return false;
  }

  private hydrateProject(row: Row): MeshProject {
    const id = String(row.id);
    const paths = (this.db.prepare('SELECT * FROM mesh_project_paths WHERE project_id = ? ORDER BY is_primary DESC, local_path').all(id) as Row[]).map(mapProjectPath);
    const agentAssignments = (this.db.prepare('SELECT * FROM mesh_project_agents WHERE project_id = ? ORDER BY role DESC, agent_id').all(id) as Row[]).map(mapProjectAgentAssignment);
    const deviceAssignments = (this.db.prepare('SELECT * FROM mesh_project_devices WHERE project_id = ? ORDER BY is_primary DESC, device_id').all(id) as Row[]).map(mapProjectDeviceAssignment);
    return {
      id,
      name: String(row.name),
      aliases: parseList(row.aliases_json),
      description: String(row.description || ''),
      status: String(row.status || 'active'),
      repositoryUrl: optionalText(row.repository_url),
      technologyStack: parseList(row.technology_stack_json),
      permissions: parseList(row.permissions_json),
      primaryAgentId: optionalText(row.primary_agent_id),
      primaryDeviceId: optionalText(row.primary_device_id),
      paths,
      agentAssignments,
      deviceAssignments,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private requireProject(id: string) {
    const project = this.getProject(id);
    if (!project) throw new Error(`Project not found: ${id}`);
    return project;
  }

  private count(table: string) {
    return Number((this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as Row).count || 0);
  }

  private transaction<T>(run: () => T) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private recoverInterruptedTasks() {
    const rows = this.db.prepare("SELECT id FROM mesh_routing_tasks WHERE status IN ('sent', 'accepted', 'working')").all() as Row[];
    for (const row of rows) this.updateRoutingTask(String(row.id), { status: 'queued', progress: 'Queued for restart recovery.' });
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mesh_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    `);
    const version = Number((this.db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM mesh_schema_migrations').get() as Row).version || 0);
    if (version < 1) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE mesh_devices (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, operating_system TEXT NOT NULL, status TEXT NOT NULL,
            available_providers_json TEXT NOT NULL, available_tools_json TEXT NOT NULL, relay_endpoint TEXT,
            last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
          );
          CREATE TABLE mesh_agents (
            id TEXT PRIMARY KEY, display_name TEXT NOT NULL, description TEXT NOT NULL, capabilities_json TEXT NOT NULL,
            provider_id TEXT NOT NULL, provider_agent_id TEXT NOT NULL, device_id TEXT NOT NULL, status TEXT NOT NULL, supported_tools_json TEXT NOT NULL,
            permissions_json TEXT NOT NULL, relay_endpoint TEXT, last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
          );
          CREATE INDEX mesh_agents_device_idx ON mesh_agents(device_id);
          CREATE TABLE mesh_projects (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, aliases_json TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL,
            repository_url TEXT, technology_stack_json TEXT NOT NULL, permissions_json TEXT NOT NULL,
            primary_agent_id TEXT, primary_device_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
          );
          CREATE TABLE mesh_project_agents (
            project_id TEXT NOT NULL REFERENCES mesh_projects(id) ON DELETE CASCADE,
            agent_id TEXT NOT NULL REFERENCES mesh_agents(id) ON DELETE CASCADE,
            role TEXT NOT NULL, access TEXT NOT NULL, PRIMARY KEY(project_id, agent_id)
          );
          CREATE TABLE mesh_project_devices (
            project_id TEXT NOT NULL REFERENCES mesh_projects(id) ON DELETE CASCADE,
            device_id TEXT NOT NULL REFERENCES mesh_devices(id) ON DELETE CASCADE,
            is_primary INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(project_id, device_id)
          );
          CREATE TABLE mesh_project_paths (
            project_id TEXT NOT NULL REFERENCES mesh_projects(id) ON DELETE CASCADE,
            device_id TEXT NOT NULL REFERENCES mesh_devices(id) ON DELETE CASCADE,
            local_path TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(project_id, device_id, local_path)
          );
          CREATE TABLE mesh_memories (
            id TEXT PRIMARY KEY, content TEXT NOT NULL, scope TEXT NOT NULL, agent_id TEXT, project_id TEXT REFERENCES mesh_projects(id) ON DELETE CASCADE,
            device_id TEXT, session_id TEXT, created_by TEXT NOT NULL, source TEXT NOT NULL, tags_json TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, confidence REAL NOT NULL, importance REAL NOT NULL,
            permissions_json TEXT NOT NULL, expires_at TEXT, version INTEGER NOT NULL
          );
          CREATE INDEX mesh_memories_scope_idx ON mesh_memories(scope, project_id, agent_id, device_id);
          CREATE INDEX mesh_memories_updated_idx ON mesh_memories(updated_at DESC);
          CREATE TABLE mesh_routing_tasks (
            id TEXT PRIMARY KEY, project_id TEXT REFERENCES mesh_projects(id) ON DELETE SET NULL, source_agent_id TEXT, source_device_id TEXT,
            target_agent_id TEXT, target_device_id TEXT, request TEXT NOT NULL, required_capabilities_json TEXT NOT NULL,
            status TEXT NOT NULL, decision_json TEXT NOT NULL, result TEXT, error TEXT, created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL, completed_at TEXT
          );
          CREATE INDEX mesh_tasks_created_idx ON mesh_routing_tasks(created_at DESC);
        `);
        this.db.prepare('INSERT INTO mesh_schema_migrations (version, applied_at) VALUES (1, ?)').run(new Date().toISOString());
      });
    }
    if (version < 2) {
      this.transaction(() => {
        this.db.exec(`
          ALTER TABLE mesh_memories ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '{}';
          ALTER TABLE mesh_routing_tasks ADD COLUMN origin_conversation_id TEXT;
          ALTER TABLE mesh_routing_tasks ADD COLUMN origin_message_id TEXT;
          ALTER TABLE mesh_routing_tasks ADD COLUMN shared_context_refs_json TEXT NOT NULL DEFAULT '[]';
          ALTER TABLE mesh_routing_tasks ADD COLUMN progress TEXT;
          ALTER TABLE mesh_routing_tasks ADD COLUMN memory_writeback_ids_json TEXT NOT NULL DEFAULT '[]';
          ALTER TABLE mesh_routing_tasks ADD COLUMN lifecycle_json TEXT NOT NULL DEFAULT '[]';
          ALTER TABLE mesh_routing_tasks ADD COLUMN approval_required INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE mesh_routing_tasks ADD COLUMN sent_at TEXT;
          ALTER TABLE mesh_routing_tasks ADD COLUMN accepted_at TEXT;
        `);
        this.db.prepare('INSERT INTO mesh_schema_migrations (version, applied_at) VALUES (2, ?)').run(new Date().toISOString());
      });
    }
  }
}

function mapAgent(row: Row): MeshAgent {
  return { id: String(row.id), displayName: String(row.display_name), description: String(row.description || ''), capabilities: parseList(row.capabilities_json), providerId: String(row.provider_id), providerAgentId: String(row.provider_agent_id), deviceId: String(row.device_id), status: cleanStatus(row.status), supportedTools: parseList(row.supported_tools_json), permissions: parseList(row.permissions_json), relayEndpoint: optionalText(row.relay_endpoint), lastSeenAt: optionalText(row.last_seen_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function mapDevice(row: Row): MeshDevice {
  return { id: String(row.id), name: String(row.name), operatingSystem: String(row.operating_system), status: cleanStatus(row.status), availableProviders: parseList(row.available_providers_json), availableTools: parseList(row.available_tools_json), relayEndpoint: optionalText(row.relay_endpoint), lastSeenAt: optionalText(row.last_seen_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function mapProjectPath(row: Row): ProjectPath { return { projectId: String(row.project_id), deviceId: String(row.device_id), path: String(row.local_path), isPrimary: Number(row.is_primary) === 1 }; }
function mapProjectAgentAssignment(row: Row): ProjectAgentAssignment { return { projectId: String(row.project_id), agentId: String(row.agent_id), role: row.role === 'primary' ? 'primary' : 'collaborator', access: row.access === 'read_only' ? 'read_only' : 'read_write' }; }
function mapProjectDeviceAssignment(row: Row): ProjectDeviceAssignment { return { projectId: String(row.project_id), deviceId: String(row.device_id), isPrimary: Number(row.is_primary) === 1 }; }

function mapMemory(row: Row): MemoryRecord {
  return { id: String(row.id), content: String(row.content), scope: cleanScope(row.scope), agentId: optionalText(row.agent_id), projectId: optionalText(row.project_id), deviceId: optionalText(row.device_id), sessionId: optionalText(row.session_id), createdBy: String(row.created_by), source: String(row.source), tags: parseList(row.tags_json), createdAt: String(row.created_at), updatedAt: String(row.updated_at), confidence: Number(row.confidence), importance: Number(row.importance), permissions: parsePermission(row.permissions_json), provenance: normalizeProvenance(parseJson(row.provenance_json, {})), expiresAt: optionalText(row.expires_at), version: Number(row.version) };
}

function mapRoutingTask(row: Row): RoutingTask {
  return { id: String(row.id), originConversationId: optionalText(row.origin_conversation_id), originMessageId: optionalText(row.origin_message_id), projectId: optionalText(row.project_id), sourceAgentId: optionalText(row.source_agent_id), sourceDeviceId: optionalText(row.source_device_id), targetAgentId: optionalText(row.target_agent_id), targetDeviceId: optionalText(row.target_device_id), request: String(row.request), requiredCapabilities: parseList(row.required_capabilities_json), sharedContextRefs: parseList(row.shared_context_refs_json), status: String(row.status) as RoutingTask['status'], decision: parseJson(row.decision_json, {}) as RouteDecision, progress: optionalText(row.progress), result: optionalText(row.result), error: optionalText(row.error), memoryWritebackIds: parseList(row.memory_writeback_ids_json), lifecycle: parseJson(row.lifecycle_json, []) as RoutingTask['lifecycle'], approvalRequired: Number(row.approval_required) === 1, createdAt: String(row.created_at), updatedAt: String(row.updated_at), sentAt: optionalText(row.sent_at), acceptedAt: optionalText(row.accepted_at), completedAt: optionalText(row.completed_at) };
}

function validateMemory(memory: MemoryRecord) {
  if (!memory.content) throw new Error('Memory content is required.');
  if (!memory.createdBy) throw new Error('Memory createdBy is required.');
  if (!memory.source) throw new Error('Memory source is required.');
  if (memory.scope === 'agent' && !memory.agentId) throw new Error('Agent memories require agentId.');
  if (memory.scope === 'project' && !memory.projectId) throw new Error('Project memories require projectId.');
  if (memory.scope === 'device' && !memory.deviceId) throw new Error('Device memories require deviceId.');
  if (memory.scope === 'session' && !memory.sessionId) throw new Error('Session memories require sessionId.');
  if (memory.permissions.visibility === 'private_agent' && !memory.agentId) throw new Error('private_agent visibility requires agentId.');
  if (memory.permissions.visibility === 'private_device' && !memory.deviceId) throw new Error('private_device visibility requires deviceId.');
  if (memory.permissions.visibility === 'project' && !memory.projectId) throw new Error('project visibility requires projectId.');
}

function normalizePermission(value: Partial<MemoryPermission> | undefined, scope: MemoryScope): MemoryPermission {
  const defaultVisibility = scope === 'agent' ? 'private_agent' : scope === 'project' ? 'project' : scope === 'device' ? 'private_device' : scope === 'global' ? 'global' : 'private_agent';
  const visibility = ['global', 'private_agent', 'private_device', 'project', 'user_only'].includes(String(value?.visibility)) ? value!.visibility! : defaultVisibility;
  return { visibility, access: value?.access === 'read_only' ? 'read_only' : 'read_write' };
}

function parsePermission(value: unknown): MemoryPermission {
  const parsed = parseJson(value, {}) as Partial<MemoryPermission>;
  return normalizePermission(parsed, 'global');
}

function normalizeProvenance(value: unknown): MemoryRecord['provenance'] {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const provenance = {
    sourceConversationId: optionalText(input.sourceConversationId),
    sourceMessageId: optionalText(input.sourceMessageId),
    sourceTaskId: optionalText(input.sourceTaskId),
    sourceAgentId: optionalText(input.sourceAgentId),
    sourceDeviceId: optionalText(input.sourceDeviceId),
    verifiedAt: optionalText(input.verifiedAt)
  };
  return Object.values(provenance).some(Boolean) ? provenance : undefined;
}

function scoreProject(project: MeshProject, query: string, context: { recentProjectIds?: string[]; agentId?: string }) {
  const name = normalizeSearch(project.name);
  const aliases = project.aliases.map(normalizeSearch);
  let score = 0;
  let reason = 'Semantic name overlap';
  if (name === query) { score = 1000; reason = 'Exact project name'; }
  else if (aliases.includes(query)) { score = 950; reason = 'Exact project alias'; }
  else {
    score = overlapScore(tokens(query), tokens(`${project.name} ${project.aliases.join(' ')} ${project.description}`));
    if (name.includes(query) || query.includes(name)) { score += 120; reason = 'Partial project name'; }
  }
  if (context.recentProjectIds?.includes(project.id)) { score += 20; reason += ' + recent conversation context'; }
  if (context.agentId && project.agentAssignments.some((assignment) => assignment.agentId === context.agentId)) { score += 10; reason += ' + current agent assignment'; }
  return { project, score, reason };
}

function overlapScore(left: string[], right: string[]) {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  const matched = new Set(left.filter((term) => rightSet.has(term))).size;
  return Math.round((matched / new Set(left).size) * 100);
}

function uniqueById(value: MemoryRecord, index: number, array: MemoryRecord[]) { return array.findIndex((item) => item.id === value.id) === index; }
function tokens(value: string) { return normalizeSearch(value).split(/[^a-z0-9]+/u).filter((part) => part.length > 1); }
function normalizeSearch(value: unknown) { return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' '); }
function slug(value: string) { return normalizeSearch(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function cleanText(value: unknown) { return String(value ?? '').trim(); }
function cleanId(value: unknown) { const id = cleanText(value); if (!id) throw new Error('ID is required.'); return id; }
function optionalText(value: unknown) { const result = cleanText(value); return result || undefined; }
function cleanList(value: unknown) { return Array.from(new Set((Array.isArray(value) ? value : []).map(cleanText).filter(Boolean))); }
function cleanStatus(value: unknown): MeshStatus { return value === 'online' || value === 'offline' || value === 'busy' ? value : 'unknown'; }
function cleanScope(value: unknown): MemoryScope { return value === 'agent' || value === 'project' || value === 'device' || value === 'session' ? value : 'global'; }
function clampNumber(value: unknown, min: number, max: number, fallback: number) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback; }
function json(value: unknown) { return JSON.stringify(value); }
function parseJson(value: unknown, fallback: unknown) { try { return JSON.parse(String(value)) as unknown; } catch { return fallback; } }
function parseList(value: unknown) { const parsed = parseJson(value, []); return cleanList(parsed); }
