export type MeshStatus = 'online' | 'offline' | 'busy' | 'unknown';
export type MemoryScope = 'global' | 'agent' | 'project' | 'device' | 'session';
export type MemoryVisibility = 'global' | 'private_agent' | 'private_device' | 'project' | 'user_only';
export type MemoryAccess = 'read_only' | 'read_write';

export interface MemoryPermission {
  visibility: MemoryVisibility;
  access: MemoryAccess;
}

export interface MeshAgent {
  id: string;
  displayName: string;
  description: string;
  capabilities: string[];
  providerId: string;
  providerAgentId: string;
  deviceId: string;
  status: MeshStatus;
  supportedTools: string[];
  permissions: string[];
  relayEndpoint?: string;
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeshDevice {
  id: string;
  name: string;
  operatingSystem: string;
  status: MeshStatus;
  availableProviders: string[];
  availableTools: string[];
  relayEndpoint?: string;
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPath {
  projectId: string;
  deviceId: string;
  path: string;
  isPrimary: boolean;
}

export interface ProjectAgentAssignment {
  projectId: string;
  agentId: string;
  role: 'primary' | 'collaborator';
  access: MemoryAccess;
}

export interface ProjectDeviceAssignment {
  projectId: string;
  deviceId: string;
  isPrimary: boolean;
}

export interface MeshProject {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  status: string;
  repositoryUrl?: string;
  technologyStack: string[];
  permissions: string[];
  primaryAgentId?: string;
  primaryDeviceId?: string;
  paths: ProjectPath[];
  agentAssignments: ProjectAgentAssignment[];
  deviceAssignments: ProjectDeviceAssignment[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRecord {
  id: string;
  content: string;
  scope: MemoryScope;
  agentId?: string;
  projectId?: string;
  deviceId?: string;
  sessionId?: string;
  createdBy: string;
  source: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  confidence: number;
  importance: number;
  permissions: MemoryPermission;
  expiresAt?: string;
  version: number;
}

export interface MemoryAccessContext {
  agentId?: string;
  deviceId?: string;
  isUser?: boolean;
}

export interface ProjectResolution {
  status: 'resolved' | 'ambiguous' | 'not_found';
  query: string;
  project?: MeshProject;
  candidates: Array<{ project: MeshProject; score: number; reason: string }>;
}

export interface RouteDecision {
  status: 'selected' | 'unavailable' | 'project_not_found' | 'ambiguous_project';
  project?: MeshProject;
  agent?: MeshAgent;
  device?: MeshDevice;
  providerId?: string;
  localPath?: string;
  executeLocally: boolean;
  score?: number;
  reasons: string[];
  considered: Array<{ agentId: string; eligible: boolean; score: number; reasons: string[] }>;
}

export interface RoutingTask {
  id: string;
  projectId?: string;
  sourceAgentId?: string;
  sourceDeviceId?: string;
  targetAgentId?: string;
  targetDeviceId?: string;
  request: string;
  requiredCapabilities: string[];
  status: 'queued' | 'running' | 'completed' | 'failed' | 'unavailable' | 'cancelled';
  decision: RouteDecision;
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type ReikaMemoryToolName =
  | 'reika.listAgents'
  | 'reika.getAgent'
  | 'reika.listDevices'
  | 'reika.getDevice'
  | 'reika.listProjects'
  | 'reika.resolveProject'
  | 'reika.getProjectContext'
  | 'reika.searchMemory'
  | 'reika.addMemory'
  | 'reika.updateMemory'
  | 'reika.promoteSessionMemory'
  | 'reika.planRoute'
  | 'reika.delegateTask'
  | 'reika.getTaskStatus'
  | 'reika.cancelTask';

export interface ReikaMemoryToolDefinition {
  name: ReikaMemoryToolName;
  description: string;
  readOnly: boolean;
  inputSchema: Record<string, unknown>;
}

export interface ReikaMemoryToolCall {
  id: string;
  name: ReikaMemoryToolName;
  arguments: Record<string, unknown>;
}

export interface ReikaMemoryToolResult {
  toolCallId: string;
  name: ReikaMemoryToolName;
  ok: boolean;
  data?: unknown;
  error?: string;
}
