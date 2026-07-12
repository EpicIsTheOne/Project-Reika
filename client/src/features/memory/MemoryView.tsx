import { useEffect, useMemo, useState } from "react";
import { Activity, Bot, BrainCircuit, Database, GitBranch, HardDrive, Link2, Monitor, Pencil, Plus, RefreshCw, Route, Save, Search, Trash2, Users } from "lucide-react";
import { StatusDot } from "../../components/status";
import {
  assignMemoryMeshAgent,
  assignMemoryMeshDevice,
  cancelMemoryMeshTask,
  createMemoryMeshMemory,
  createMemoryMeshProject,
  deleteMemoryMeshMemory,
  executeMemoryMeshTask,
  getMemoryMeshOverview,
  previewMemoryMeshRoute,
  searchMemoryMeshMemories,
  syncMemoryMeshDiscovery,
  updateMemoryMeshMemory,
  updateMemoryMeshProject,
  type MemoryMeshAgent,
  type MemoryMeshMemory,
  type MemoryMeshOverview,
  type MemoryMeshProject,
  type MemoryMeshRouteDecision,
  type MemoryMeshScope,
  type MemoryMeshRoutingTask
} from "../../lib/reikaApi";
import { cx, pageMotionClass } from "../../lib/motion";

type MemoryTab = "recent" | "global" | "projects" | "agents" | "devices" | "routing";

const tabs: Array<{ id: MemoryTab; label: string; icon: typeof Database }> = [
  { id: "recent", label: "Recent Memory", icon: Activity },
  { id: "global", label: "Global Memory", icon: Database },
  { id: "projects", label: "Projects", icon: GitBranch },
  { id: "agents", label: "Agents", icon: Users },
  { id: "devices", label: "Devices", icon: Monitor },
  { id: "routing", label: "Task Routing", icon: Route }
];

export function MemoryView() {
  const [overview, setOverview] = useState<MemoryMeshOverview | null>(null);
  const [tab, setTab] = useState<MemoryTab>("recent");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [memoryEditorOpen, setMemoryEditorOpen] = useState(false);
  const [projectEditorOpen, setProjectEditorOpen] = useState(false);
  const [memorySearchResults, setMemorySearchResults] = useState<MemoryMeshMemory[] | null>(null);

  const refresh = async () => {
    try {
      setError(null);
      const response = await getMemoryMeshOverview();
      setOverview(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if ((tab !== "recent" && tab !== "global") || !query.trim()) {
      setMemorySearchResults(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchMemoryMeshMemories({ q: query.trim(), scope: tab === "global" ? "global" : undefined, limit: 200 })
        .then((response) => { if (!cancelled) setMemorySearchResults(response.memories); })
        .catch((searchError) => { if (!cancelled) setError(searchError instanceof Error ? searchError.message : String(searchError)); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, tab]);

  const syncDiscovery = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await syncMemoryMeshDiscovery();
      setNotice(result.discovery.warning || `Discovery synced ${result.discovery.syncedRelayDevices} relay device${result.discovery.syncedRelayDevices === 1 ? "" : "s"}.`);
      await refresh();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : String(syncError));
    } finally {
      setBusy(false);
    }
  };

  const search = query.trim().toLowerCase();
  const visibleMemories = useMemo(() => {
    const source = memorySearchResults ?? overview?.memories ?? [];
    return source
      .filter((memory) => tab !== "global" || memory.scope === "global")
      .filter((memory) => !search || [memory.content, memory.source, memory.scope, memory.tags.join(" ")].join(" ").toLowerCase().includes(search));
  }, [memorySearchResults, overview?.memories, search, tab]);

  const headerAction = tab === "projects" ? () => setProjectEditorOpen(true) : tab === "recent" || tab === "global" ? () => setMemoryEditorOpen(true) : undefined;

  return (
    <main className={pageMotionClass("page memory-page")}>
      <header className="workbench-header">
        <div className="workbench-title">
          <BrainCircuit size={30} />
          <span>
            <h1>Memory Mesh</h1>
            <p>Project-aware memory, ownership, and agent routing.</p>
          </span>
        </div>
        <div className="workbench-actions">
          <label className="search-field compact">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search memory mesh..." />
            <Search size={18} />
          </label>
          <button className="secondary-action small" onClick={syncDiscovery} disabled={busy}>
            <RefreshCw size={18} className={busy ? "spin" : ""} />
            Sync discovery
          </button>
          {headerAction ? (
            <button className="primary-action small" onClick={headerAction}>
              <Plus size={18} />
              {tab === "projects" ? "Add project" : "Add memory"}
            </button>
          ) : null}
        </div>
      </header>

      {error ? <div className="memory-banner error">{error}</div> : null}
      {notice ? <div className="memory-banner">{notice}</div> : null}

      <section className="memory-stats" aria-label="Memory Mesh totals">
        <MemoryStat icon={Bot} label="Agents" value={overview?.storage.agentCount ?? 0} />
        <MemoryStat icon={Monitor} label="Devices" value={overview?.storage.deviceCount ?? 0} />
        <MemoryStat icon={GitBranch} label="Projects" value={overview?.storage.projectCount ?? 0} />
        <MemoryStat icon={Database} label="Memories" value={overview?.storage.memoryCount ?? 0} />
        <MemoryStat icon={Route} label="Routes" value={overview?.storage.taskCount ?? 0} />
      </section>

      <div className="memory-layout">
        <nav className="memory-tabs" aria-label="Memory views">
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={cx(tab === item.id && "active")} onClick={() => setTab(item.id)}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <section className="memory-workspace">
          {(tab === "recent" || tab === "global") && (
            <MemoryList memories={visibleMemories} overview={overview} onChanged={refresh} />
          )}
          {tab === "projects" && <ProjectList overview={overview} query={search} onChanged={refresh} />}
          {tab === "agents" && <AgentList agents={overview?.agents ?? []} query={search} overview={overview} />}
          {tab === "devices" && <DeviceList overview={overview} query={search} />}
          {tab === "routing" && <RoutingWorkbench overview={overview} onChanged={refresh} />}
        </section>
      </div>

      {memoryEditorOpen ? <MemoryEditor overview={overview} onClose={() => setMemoryEditorOpen(false)} onSaved={async () => { setMemoryEditorOpen(false); await refresh(); }} /> : null}
      {projectEditorOpen ? <ProjectEditor onClose={() => setProjectEditorOpen(false)} onSaved={async () => { setProjectEditorOpen(false); await refresh(); }} /> : null}
    </main>
  );
}

function MemoryStat({ icon: Icon, label, value }: { icon: typeof Bot; label: string; value: number }) {
  return <article><Icon size={19} /><span><strong>{value}</strong><small>{label}</small></span></article>;
}

function MemoryList({ memories, overview, onChanged }: { memories: MemoryMeshMemory[]; overview: MemoryMeshOverview | null; onChanged: () => Promise<void> }) {
  const [selected, setSelected] = useState<MemoryMeshMemory | null>(null);
  if (!memories.length) return <EmptyMemory title="No matching memories" body="Add a scoped record or adjust the search. The mesh refuses to hallucinate inventory. Sensible." />;
  return (
    <div className="memory-card-grid">
      {memories.map((memory) => (
        <button className="memory-card" key={memory.id} onClick={() => setSelected(memory)}>
          <span className={`memory-scope scope-${memory.scope}`}>{memory.scope}</span>
          <p>{memory.content}</p>
          <footer>
            <span>{projectName(overview?.projects ?? [], memory.projectId) || memory.agentId || memory.deviceId || "Reika-wide"}</span>
            <time>{relativeTime(memory.updatedAt)}</time>
          </footer>
          <small>Source: {memory.source} · v{memory.version}</small>
        </button>
      ))}
      {selected ? <MemoryEditor memory={selected} overview={overview} onClose={() => setSelected(null)} onSaved={async () => { setSelected(null); await onChanged(); }} /> : null}
    </div>
  );
}

function ProjectList({ overview, query, onChanged }: { overview: MemoryMeshOverview | null; query: string; onChanged: () => Promise<void> }) {
  const projects = (overview?.projects ?? []).filter((project) => !query || [project.name, project.aliases.join(" "), project.description].join(" ").toLowerCase().includes(query));
  const [selectedId, setSelectedId] = useState("");
  const selected = projects.find((project) => project.id === selectedId) ?? projects[0];
  if (!selected) return <EmptyMemory title="No projects registered" body="Create a project, then connect its agents, devices, and device-specific paths." />;
  return (
    <div className="memory-split">
      <div className="project-record-list">
        {projects.map((project) => (
          <button key={project.id} className={cx(project.id === selected.id && "active")} onClick={() => setSelectedId(project.id)}>
            <GitBranch size={18} />
            <span><strong>{project.name}</strong><small>{project.agentAssignments.length} agents · {project.deviceAssignments.length} devices</small></span>
          </button>
        ))}
      </div>
      <ProjectDetail key={selected.id} project={selected} overview={overview!} onChanged={onChanged} />
    </div>
  );
}

function ProjectDetail({ project, overview, onChanged }: { project: MemoryMeshProject; overview: MemoryMeshOverview; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [aliases, setAliases] = useState(project.aliases.join(", "));
  const [description, setDescription] = useState(project.description);
  const [agentId, setAgentId] = useState(overview.agents[0]?.id ?? "");
  const [deviceId, setDeviceId] = useState(overview.devices[0]?.id ?? "");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    try { setError(null); await action(); await onChanged(); } catch (actionError) { setError(actionError instanceof Error ? actionError.message : String(actionError)); }
  };
  return (
    <article className="project-detail-card">
      <header>
        <span><span className="memory-scope scope-project">{project.status}</span><h2>{project.name}</h2><p>{project.description || "No description yet."}</p></span>
        <button className="icon-button compact" onClick={() => setEditing((value) => !value)} aria-label="Edit project"><Pencil size={18} /></button>
      </header>
      {error ? <div className="memory-banner error">{error}</div> : null}
      {editing ? (
        <div className="memory-form compact-form">
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Aliases<input value={aliases} onChange={(event) => setAliases(event.target.value)} /></label>
          <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <button className="primary-action small" onClick={() => void run(() => updateMemoryMeshProject(project.id, { name, aliases: splitList(aliases), description }))}><Save size={17} />Save project</button>
        </div>
      ) : null}
      <section className="relationship-section">
        <h3><Users size={17} /> Assigned agents</h3>
        <div className="relationship-list">
          {project.agentAssignments.map((assignment) => {
            const agent = overview.agents.find((item) => item.id === assignment.agentId);
            return <div key={assignment.agentId}><StatusDot status={agent?.status ?? "unknown"} /><span><strong>{agent?.displayName ?? assignment.agentId}</strong><small>{assignment.role} · {assignment.access.replace("_", " ")}</small></span></div>;
          })}
          {!project.agentAssignments.length ? <small>No agent assignments.</small> : null}
        </div>
        <div className="relationship-add-row">
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>{overview.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName} · {agent.deviceId}</option>)}</select>
          <button onClick={() => void run(() => assignMemoryMeshAgent(project.id, { agentId, role: project.agentAssignments.length ? "collaborator" : "primary", access: "read_write" }))} disabled={!agentId}><Plus size={16} />Assign</button>
        </div>
      </section>
      <section className="relationship-section">
        <h3><HardDrive size={17} /> Devices and paths</h3>
        <div className="relationship-list">
          {project.deviceAssignments.map((assignment) => {
            const device = overview.devices.find((item) => item.id === assignment.deviceId);
            const devicePaths = project.paths.filter((item) => item.deviceId === assignment.deviceId);
            return <div key={assignment.deviceId}><StatusDot status={device?.status ?? "unknown"} /><span><strong>{device?.name ?? assignment.deviceId}</strong><small>{devicePaths.map((item) => item.path).join(" · ") || "No path registered"}</small></span></div>;
          })}
          {!project.deviceAssignments.length ? <small>No device assignments.</small> : null}
        </div>
        <div className="relationship-add-row path-row">
          <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>{overview.devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select>
          <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="Device-local path" />
          <button onClick={() => void run(() => assignMemoryMeshDevice(project.id, { deviceId, path, isPrimary: project.deviceAssignments.length === 0 }))} disabled={!deviceId || !path.trim()}><Link2 size={16} />Attach</button>
        </div>
      </section>
      <footer className="project-meta-row"><span>Aliases: {project.aliases.join(", ") || "none"}</span><span>Updated {relativeTime(project.updatedAt)}</span></footer>
    </article>
  );
}

function AgentList({ agents, query, overview }: { agents: MemoryMeshAgent[]; query: string; overview: MemoryMeshOverview | null }) {
  const visible = agents.filter((agent) => !query || [agent.displayName, agent.description, agent.capabilities.join(" "), agent.providerId].join(" ").toLowerCase().includes(query));
  if (!visible.length) return <EmptyMemory title="No matching agents" body="Sync discovery to import the current provider and relay roster." />;
  return <div className="registry-card-grid">{visible.map((agent) => {
    const projects = overview?.projects.filter((project) => project.agentAssignments.some((assignment) => assignment.agentId === agent.id)) ?? [];
    return <article key={agent.id}><header><span className="registry-icon"><Bot size={21} /></span><span><h3>{agent.displayName}</h3><small>{agent.providerId} · {agent.deviceId}</small></span><StatusDot status={agent.status} /></header><p>{agent.description}</p><div className="chip-row">{agent.capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div><footer>{projects.length ? `Projects: ${projects.map((project) => project.name).join(", ")}` : "No project assignments"}</footer></article>;
  })}</div>;
}

function DeviceList({ overview, query }: { overview: MemoryMeshOverview | null; query: string }) {
  const devices = (overview?.devices ?? []).filter((device) => !query || [device.name, device.operatingSystem, device.availableProviders.join(" ")].join(" ").toLowerCase().includes(query));
  if (!devices.length) return <EmptyMemory title="No matching devices" body="Sync discovery to refresh device truth." />;
  return <div className="registry-card-grid">{devices.map((device) => {
    const hosted = overview?.agents.filter((agent) => agent.deviceId === device.id) ?? [];
    const projects = overview?.projects.filter((project) => project.deviceAssignments.some((assignment) => assignment.deviceId === device.id)) ?? [];
    return <article key={device.id}><header><span className="registry-icon"><Monitor size={21} /></span><span><h3>{device.name}</h3><small>{device.operatingSystem}</small></span><StatusDot status={device.status} /></header><p>{hosted.length} hosted agent{hosted.length === 1 ? "" : "s"} · {device.availableProviders.length} provider{device.availableProviders.length === 1 ? "" : "s"}</p><div className="chip-row">{device.availableProviders.map((provider) => <span key={provider}>{provider}</span>)}</div><footer>{projects.length ? `Projects: ${projects.map((project) => project.name).join(", ")}` : "No project paths"}</footer></article>;
  })}</div>;
}

function RoutingWorkbench({ overview, onChanged }: { overview: MemoryMeshOverview | null; onChanged: () => Promise<void> }) {
  const [projectQuery, setProjectQuery] = useState(overview?.projects[0]?.name ?? "");
  const [taskText, setTaskText] = useState("");
  const [capabilities, setCapabilities] = useState("chat");
  const [decision, setDecision] = useState<MemoryMeshRouteDecision | null>(null);
  const [task, setTask] = useState<MemoryMeshRoutingTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = { projectQuery, task: taskText, requiredCapabilities: splitList(capabilities) };
  const run = async (execute: boolean) => {
    setBusy(true); setError(null);
    try {
      if (execute) {
        const response = await executeMemoryMeshTask(input);
        setTask(response.task); setDecision(response.task.decision); await onChanged();
      } else {
        const response = await previewMemoryMeshRoute(input);
        setDecision(response.decision); setTask(null);
      }
    } catch (routeError) { setError(routeError instanceof Error ? routeError.message : String(routeError)); }
    finally { setBusy(false); }
  };
  const cancel = async (taskId: string) => {
    setBusy(true); setError(null);
    try { const response = await cancelMemoryMeshTask(taskId); setTask(response.task); await onChanged(); }
    catch (cancelError) { setError(cancelError instanceof Error ? cancelError.message : String(cancelError)); }
    finally { setBusy(false); }
  };
  return (
    <div className="routing-grid">
      <article className="routing-composer">
        <h2><Route size={21} /> Route a project task</h2>
        <p>Resolve ownership first. Execution uses the selected local provider or the existing relay.</p>
        <label>Project name or alias<input value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="Command Center" /></label>
        <label>Task<textarea value={taskText} onChange={(event) => setTaskText(event.target.value)} placeholder="Fix the login page and verify the result." /></label>
        <label>Required capabilities<input value={capabilities} onChange={(event) => setCapabilities(event.target.value)} placeholder="chat, tools" /></label>
        {error ? <div className="memory-banner error">{error}</div> : null}
        <div className="routing-actions"><button className="secondary-action" onClick={() => void run(false)} disabled={busy || !projectQuery.trim()}>Preview route</button><button className="primary-action" onClick={() => void run(true)} disabled={busy || !projectQuery.trim() || !taskText.trim()}><Route size={18} />Route task</button></div>
      </article>
      <article className="routing-decision">
        <h2>Routing decision</h2>
        {decision ? <RouteDecisionView decision={decision} /> : <EmptyMemory title="No route evaluated" body="Preview a request to see the selected project, device, agent, score, and reasons." />}
        {task ? <div className={`routing-result status-${task.status}`}><strong>{task.status}</strong><p>{task.result || task.error || "Task recorded."}</p></div> : null}
      </article>
      <section className="routing-history">
        <h2>Recent routing history</h2>
        {(overview?.routingTasks ?? []).map((item) => <article key={item.id}><span className={`route-status status-${item.status}`}>{item.status}</span><div><strong>{item.decision.project?.name || item.projectId || "Unresolved project"}</strong><p>{item.request}</p><small>{item.decision.agent?.displayName || "No agent selected"} · {relativeTime(item.createdAt)}</small></div></article>)}
        {!overview?.routingTasks.length ? <small>No routed tasks yet.</small> : null}
        {(overview?.routingTasks ?? []).filter((item) => item.status === "queued" || item.status === "running").map((item) => <button key={`cancel-${item.id}`} className="secondary-action" type="button" onClick={() => void cancel(item.id)} disabled={busy}><Trash2 size={14} /> Cancel {item.decision.project?.name || item.id.slice(0, 8)}</button>)}
      </section>
    </div>
  );
}

function RouteDecisionView({ decision }: { decision: MemoryMeshRouteDecision }) {
  return <div className="decision-stack"><span className={`route-status status-${decision.status}`}>{decision.status.replace(/_/g, " ")}</span>{decision.project ? <h3>{decision.project.name}</h3> : null}{decision.agent ? <div className="decision-target"><Bot size={18} /><span><strong>{decision.agent.displayName}</strong><small>{decision.device?.name} · {decision.providerId}</small></span></div> : null}{decision.localPath ? <code>{decision.localPath}</code> : null}<ul>{decision.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>{decision.considered.length ? <details><summary>{decision.considered.length} agent{decision.considered.length === 1 ? "" : "s"} considered</summary>{decision.considered.map((item) => <p key={item.agentId}><strong>{item.agentId}</strong> · {item.eligible ? "eligible" : "ineligible"} · score {item.score}</p>)}</details> : null}</div>;
}

function MemoryEditor({ memory, overview, onClose, onSaved }: { memory?: MemoryMeshMemory; overview: MemoryMeshOverview | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [content, setContent] = useState(memory?.content ?? "");
  const [scope, setScope] = useState<MemoryMeshScope>(memory?.scope ?? "global");
  const [source, setSource] = useState(memory?.source ?? "user");
  const [tags, setTags] = useState(memory?.tags.join(", ") ?? "");
  const [projectId, setProjectId] = useState(memory?.projectId ?? overview?.projects[0]?.id ?? "");
  const [agentId, setAgentId] = useState(memory?.agentId ?? overview?.agents[0]?.id ?? "");
  const [deviceId, setDeviceId] = useState(memory?.deviceId ?? overview?.devices[0]?.id ?? "");
  const [visibility, setVisibility] = useState(memory?.permissions.visibility ?? "global");
  const [access, setAccess] = useState(memory?.permissions.access ?? "read_write");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      const payload = { content, scope, source, createdBy: memory?.createdBy ?? "user", tags: splitList(tags), projectId: scope === "project" ? projectId : undefined, agentId: scope === "agent" ? agentId : undefined, deviceId: scope === "device" ? deviceId : undefined, permissions: { visibility, access } } as Partial<MemoryMeshMemory> & Pick<MemoryMeshMemory, "content" | "scope" | "createdBy" | "source">;
      if (memory) await updateMemoryMeshMemory(memory.id, payload); else await createMemoryMeshMemory(payload);
      await onSaved();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : String(saveError)); }
  };
  const remove = async () => {
    if (!memory || !window.confirm("Delete this Memory Mesh record?")) return;
    try { await deleteMemoryMeshMemory(memory.id); await onSaved(); } catch (removeError) { setError(removeError instanceof Error ? removeError.message : String(removeError)); }
  };
  return <div className="memory-modal-backdrop"><section className="memory-modal"><header><span><BrainCircuit size={21} /><h2>{memory ? "Edit memory" : "Add memory"}</h2></span><button className="icon-button compact" onClick={onClose}>×</button></header><div className="memory-form"><label>Memory<textarea value={content} onChange={(event) => setContent(event.target.value)} autoFocus /></label><div className="memory-form-grid"><label>Scope<select value={scope} onChange={(event) => { const next = event.target.value as MemoryMeshScope; setScope(next); setVisibility(next === "project" ? "project" : next === "agent" ? "private_agent" : next === "device" ? "private_device" : "global"); }}>{["global", "agent", "project", "device", "session"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Source<input value={source} onChange={(event) => setSource(event.target.value)} /></label><label>Visibility<select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}>{["global", "private_agent", "private_device", "project", "user_only"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Access<select value={access} onChange={(event) => setAccess(event.target.value as typeof access)}><option value="read_write">read and write</option><option value="read_only">read only</option></select></label></div>{scope === "project" ? <label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{overview?.projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label> : null}{scope === "agent" ? <label>Agent<select value={agentId} onChange={(event) => setAgentId(event.target.value)}>{overview?.agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.displayName}</option>)}</select></label> : null}{scope === "device" ? <label>Device<select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>{overview?.devices.map((device) => <option value={device.id} key={device.id}>{device.name}</option>)}</select></label> : null}<label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="decision, architecture" /></label>{error ? <div className="memory-banner error">{error}</div> : null}<footer>{memory ? <button className="danger-action" onClick={remove}><Trash2 size={17} />Delete</button> : <span />}<div><button className="secondary-action" onClick={onClose}>Cancel</button><button className="primary-action" onClick={save} disabled={!content.trim() || !source.trim()}><Save size={17} />Save</button></div></footer></div></section></div>;
}

function ProjectEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(""); const [aliases, setAliases] = useState(""); const [description, setDescription] = useState(""); const [repositoryUrl, setRepositoryUrl] = useState(""); const [stack, setStack] = useState(""); const [error, setError] = useState<string | null>(null);
  const save = async () => { try { await createMemoryMeshProject({ name, aliases: splitList(aliases), description, repositoryUrl: repositoryUrl || undefined, technologyStack: splitList(stack) }); await onSaved(); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : String(saveError)); } };
  return <div className="memory-modal-backdrop"><section className="memory-modal"><header><span><GitBranch size={21} /><h2>Add project</h2></span><button className="icon-button compact" onClick={onClose}>×</button></header><div className="memory-form"><label>Project name<input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label><label>Aliases<input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="Command Center, CCO" /></label><label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="memory-form-grid"><label>Repository URL<input value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} /></label><label>Technology stack<input value={stack} onChange={(event) => setStack(event.target.value)} placeholder="TypeScript, Electron" /></label></div>{error ? <div className="memory-banner error">{error}</div> : null}<footer><span /><div><button className="secondary-action" onClick={onClose}>Cancel</button><button className="primary-action" onClick={save} disabled={!name.trim()}><Save size={17} />Create project</button></div></footer></div></section></div>;
}

function EmptyMemory({ title, body }: { title: string; body: string }) { return <div className="memory-empty"><BrainCircuit size={32} /><h3>{title}</h3><p>{body}</p></div>; }
function projectName(projects: MemoryMeshProject[], id?: string) { return projects.find((project) => project.id === id)?.name; }
function splitList(value: string) { return value.split(",").map((part) => part.trim()).filter(Boolean); }
function relativeTime(value: string) { const delta = Date.now() - Date.parse(value); if (!Number.isFinite(delta)) return "unknown"; if (delta < 60_000) return "just now"; if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`; if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`; return `${Math.floor(delta / 86_400_000)}d ago`; }
