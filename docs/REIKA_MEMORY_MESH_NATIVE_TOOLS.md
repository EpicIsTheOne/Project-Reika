# Reika Memory Mesh: Native Agent Tools

This phase makes Memory Mesh part of ordinary chat and exposes one provider-independent tool contract. It deliberately does not add distributed database replication, embeddings, multi-user authentication, or workload scoring.

## Audit findings

| Boundary | Before this phase | Integration decision |
| --- | --- | --- |
| Chat context | Attachments and prior session messages only | Keep the base prompt small; retrieve project context only after a project is resolved |
| Memory operations | Desktop UI and HTTP endpoints | Add a common structured tool executor using the same store methods |
| Provider tools | No shared schema or tool call/result contract | Define canonical `reika.*` tools and render provider-specific schemas from them |
| Identity | UI is user; agent HTTP callers use `X-Reika-Agent-Id` and `X-Reika-Device-Id` | Pass the acting identity into every tool execution; the store remains authoritative |
| Task lifecycle | Persisted queued/running/completed/failed/unavailable state | Add cancellation and structured chat lifecycle events |
| Chat UI | Generic thinking row and plain assistant result | Show a live routing indicator and a compact expandable routing summary |

The provider runtime remains responsible for talking to Command Center, OpenClaw, Hermes, or Mock. It does not decide memory permissions or routing eligibility.

## Canonical tool contract

Discovery:

- `reika.listAgents`
- `reika.getAgent`
- `reika.listDevices`
- `reika.getDevice`
- `reika.listProjects`
- `reika.resolveProject`

Context and memory:

- `reika.getProjectContext`
- `reika.searchMemory`
- `reika.addMemory`
- `reika.updateMemory`
- `reika.promoteSessionMemory`

Routing:

- `reika.planRoute`
- `reika.delegateTask`
- `reika.getTaskStatus`
- `reika.cancelTask`

`GET /memory-mesh/tools` returns the canonical definitions. The `format` query accepts `canonical`, `openai`, `commandcenter`, or `hermes`. `POST /memory-mesh/tools/execute` executes a canonical call and applies the identity headers before any store access.

Provider adapters translate definitions only. The implementation and permission logic are not duplicated:

- OpenAI/OpenClaw receives function schemas with transport-safe names plus the canonical Reika name.
- Command Center receives its name, description, input schema, and read-only marker.
- Hermes receives a compact manifest suitable for its CLI/tool bridge.

This prepares native provider tool loops without making the model the security boundary. Providers that lack a callback-capable tool transport can still use the HTTP executor through their Reika integration.

## Natural chat routing

For actionable chat requests, Reika checks known project names and aliases as bounded phrases. One match starts routing. Multiple matches return a clarification in the same conversation. No match leaves the normal provider chat path unchanged.

The originating conversation receives these structured stages:

1. `resolving`
2. `route_planned`
3. `delegating`
4. `working`
5. `memory_updated`
6. `completed`, `failed`, or `cancelled`

The assistant message persists the task ID, project, selected agent/device, decision reasons, status, and lifecycle. The desktop shows the current stage while the request is active and an expandable summary afterward.

## Context and writeback policy

The routed agent receives only:

- resolved project name;
- its device-specific project path;
- the task;
- up to eight permission-filtered relevant memories with source attribution;
- a reminder not to treat paths from other devices as valid.

Successful delegated work is written to project memory at high confidence with `routing-task:<taskId>` as the source. Failures, cancellations, route guesses, and ambiguous references are retained in routing/session history but are not promoted as durable project facts.

## Verification targets

Focused tests cover the canonical adapters, private and project permission boundaries, read-only denial, routing, cancellation, and database reopen persistence. The relay smoke additionally sends an ordinary chat request naming a project, verifies remote Astra selection and websocket execution, checks all lifecycle stages in the original assistant message, and confirms sourced project-memory writeback.

Packaged acceptance still requires the Windows desktop bundle to embed the rebuilt server and a visible natural-language delegation run to complete through that bundle.
