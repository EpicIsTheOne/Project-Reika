# Reika Memory Mesh

Reika Memory Mesh is the project-aware registry, scoped memory service, and routing layer in the device-side Reika server. It keeps structured records in one local SQLite database and retrieves only the records relevant to a request. It does not inject a shared memory dump into every agent prompt.

## First usable slice

The first slice deliberately reuses the existing product seams:

- The bundled device server owns the Memory Mesh API and SQLite database.
- Local and relay-discovered providers populate agent and device registry records.
- Project paths are always keyed by both `projectId` and `deviceId`.
- The existing `agent.chat.request` relay path performs remote work; local routes call the existing provider runtime.
- A routed agent receives a compact task context assembled through permission-filtered retrieval.
- Completed task results are stored in routing history and promoted to project memory with source attribution.
- The desktop Memory view presents records as memory cards, project relationships, registry cards, and routing explanations.

SQLite uses Node 22's built-in `node:sqlite` module. This avoids a native addon and keeps the packaged single-file server self-contained. Node 22 currently labels that module experimental, so the packaged server must remain pinned and the database migration tests must run before changing Node versions.

## Storage and migration

Default database:

`~/.local/share/project-reika/memory-mesh.sqlite`

Override for tests or deployments:

`REIKA_MEMORY_MESH_PATH`

Schema version 1 creates:

- `mesh_devices`
- `mesh_agents`
- `mesh_projects`
- `mesh_project_agents`
- `mesh_project_devices`
- `mesh_project_paths`
- `mesh_memories`
- `mesh_routing_tasks`
- `mesh_schema_migrations`

The database enables foreign keys, WAL mode, and a bounded busy timeout. Schema upgrades must be additive, versioned, and covered by a focused migration test.

Discovered agents have two identities:

- `id`: globally unique Memory Mesh ID, qualified by device and provider.
- `providerAgentId`: native ID sent to the provider or relay when executing work.

This prevents two devices hosting an agent named `reika` from overwriting each other.

## Permission model

Every memory has a scope and an explicit permission object:

| Visibility | Read access | Write access |
| --- | --- | --- |
| `global` | Connected agents | User, or agents with `memory:global:write` |
| `private_agent` | Matching agent only | Matching agent when record is `read_write` |
| `private_device` | Matching device only | Agents operating on that device when record is `read_write` |
| `project` | Agents assigned to the project | Assigned agents whose project assignment and record are both `read_write` |
| `user_only` | User only | User only |

The local desktop UI is treated as the user. Agent API callers identify themselves with `X-Reika-Agent-Id` and optionally `X-Reika-Device-Id`; agent integrations must send those headers so scope filtering is applied. This MVP inherits the server's loopback-only trust boundary and does not yet authenticate local callers, so authenticated multi-user access remains a later security stage.

Session memories receive an isolated session ID and a 24-hour expiry by default. User-created session notes are user-only; agent-created session notes are private to that agent. Expired records are omitted from retrieval and can be intentionally promoted into global, agent, project, or device memory before expiry.

## Project resolution

Resolution uses deterministic tiers:

1. Exact project name
2. Exact alias
3. Partial name and token overlap across name, aliases, and description
4. Recent project context boost
5. Current agent assignment boost

Close matches return `ambiguous` instead of silently selecting one. Embeddings are intentionally deferred; the lexical fallback is local, explainable, and deterministic.

## Routing

A route is eligible only when all of these are true:

- The agent is assigned to the resolved project.
- The assignment permits writes.
- The agent has every required capability.
- The agent's device is registered.
- A device-specific project path exists on that device.
- Both agent and device are online.

Eligible agents are scored using project ownership, primary device, online state, capabilities, and local execution. The route response retains every considered agent and the reason it was selected or rejected.

`POST /memory-mesh/tasks` then:

1. Resolves the project.
2. Records the route decision.
3. Retrieves a small permission-filtered context set.
4. Executes through the local provider runtime or existing relay app socket.
5. Correlates the response to the original request.
6. Stores completion or failure in routing history.
7. Writes a sourced project memory after success.

Offline or unauthorized routes fail closed and remain inspectable in routing history.

## API surface

Registry and overview:

- `GET /memory-mesh/overview`
- `POST /memory-mesh/discovery/sync`
- `GET|POST /memory-mesh/agents`
- `PATCH /memory-mesh/agents/:id`
- `GET|POST /memory-mesh/devices`
- `PATCH /memory-mesh/devices/:id`
- `GET|POST /memory-mesh/projects`
- `GET /memory-mesh/projects/resolve?q=...`
- `PATCH|DELETE /memory-mesh/projects/:id`
- `POST|DELETE /memory-mesh/projects/:id/agents[/agentId]`
- `POST|DELETE /memory-mesh/projects/:id/devices[/deviceId]`

Memory and routing:

- `GET|POST /memory-mesh/memories`
- `PATCH|DELETE /memory-mesh/memories/:id`
- `POST /memory-mesh/memories/:id/promote`
- `POST /memory-mesh/routing/preview`
- `GET|POST /memory-mesh/tasks`

## Verification

Focused automated coverage lives in `server/scripts/test-memory-mesh.ts` and runs with:

`npm run test:memory-mesh`

It verifies registry persistence, agent-private isolation, project authorization, read-only assignments, exact/alias/token project resolution, route explanation, device-qualified paths, offline fail-closed behavior, routing task results, session promotion, version increments, and deletion.

The real relay delegation contract runs with:

`npm run smoke:memory-mesh-relay`

It starts isolated relay and device-server processes, pairs a mocked remote Astra device, syncs it into Memory Mesh, assigns a remote project path, routes over the actual app/device websocket protocol, correlates Astra's result back to the originating HTTP request, verifies permission-filtered project context, checks project-memory writeback, and removes the temporary rig.

The integrated live API path was also verified with a temporary database and mock provider: discovery populated the local registry, an alias resolved, a project was assigned to its local agent/device/path, routing selected the owner with an explanation, the mock task completed in the originating HTTP request, relevant project memory was included, and the result was written to routing history.

## Deliberate next stages

The following are not disguised as complete:

- Cross-device database replication and a relay-hosted canonical Memory Mesh service
- Provider-native callback transports beyond the common schemas and HTTP tool executor described in `REIKA_MEMORY_MESH_NATIVE_TOOLS.md`
- Embedding-backed semantic search
- Workload-aware routing
- Conflict resolution between independently edited registries
- Durable relay-side cancellation acknowledgement for providers that cannot abort in-flight work
- Encryption-at-rest and authenticated multi-user relay tenancy

Those layers should build on the current schemas and API contracts instead of replacing them with shared prompt text or another parallel transport.
