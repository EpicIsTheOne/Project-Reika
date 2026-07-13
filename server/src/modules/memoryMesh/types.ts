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
  provenance?: MemoryProvenance;
  expiresAt?: string;
  version: number;
}

export interface MemoryProvenance {
  sourceConversationId?: string;
  sourceMessageId?: string;
  sourceTaskId?: string;
  sourceAgentId?: string;
  sourceDeviceId?: string;
  verifiedAt?: string;
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
  approvalRequired?: boolean;
  approvalReason?: string;
  reasons: string[];
  considered: Array<{ agentId: string; eligible: boolean; score: number; reasons: string[] }>;
}

export type RoutingTaskStatus =
  | 'resolving'
  | 'planning'
  | 'awaiting_approval'
  | 'queued'
  | 'sent'
  | 'accepted'
  | 'working'
  | 'awaiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'unavailable';

export interface RoutingTaskLifecycleEntry {
  status: RoutingTaskStatus;
  at: string;
  progress?: string;
}

export interface RoutingTask {
  id: string;
  originConversationId?: string;
  originMessageId?: string;
  projectId?: string;
  sourceAgentId?: string;
  sourceDeviceId?: string;
  targetAgentId?: string;
  targetDeviceId?: string;
  request: string;
  requiredCapabilities: string[];
  sharedContextRefs: string[];
  status: RoutingTaskStatus;
  decision: RouteDecision;
  progress?: string;
  result?: string;
  error?: string;
  memoryWritebackIds: string[];
  lifecycle: RoutingTaskLifecycleEntry[];
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  acceptedAt?: string;
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
  | 'reika.findCapability'
  | 'reika.planRoute'
  | 'reika.delegateTask'
  | 'reika.getTaskStatus'
  | 'reika.cancelTask'
  | 'reika.approveTask';

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
