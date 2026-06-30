import { useEffect, useMemo, useState, type ElementType } from "react";
import { Activity, Bot, ChevronDown, ChevronRight, Cpu, Database, Globe2, Info, Link2, Monitor, Plus, Search, ShieldCheck } from "lucide-react";
import { statusLabels } from "../../app/constants";
import { DetailRow } from "../../components/DetailRow";
import { StatusDot, StatusPill, Toggle } from "../../components/status";
import { normalizeRelayDeviceUrl } from "../../config/relay";
import { assets } from "../../data/assets";
import { applyRelayEnvelope, approveRelayPairingCode, claimRelayPairingCode, connectRelayApp, createRelayPairingCode, type RelayDeviceRecord, type RelayPairing } from "../../data/relay";
import { getLocalAgentStartup, setLocalAgentStartup, type LocalAgentStartupStatus } from "../../data/startup";
import { filterDeviceRows, formatMetric, formatRelativeTime, getAgentAvatar, mapLocalDeviceRecord, mapRelayDeviceRecord, nextDeviceFilter, startupMatchesDevice, titleCase, type DevicePageRow } from "../../domain/reikaMappers";
import { AgentConnectionWizard } from "../connection/AgentConnectionWizard";
import type { ArtRuntime } from "../../lib/artRuntime";
import { cx, motionDelay, pageMotionClass } from "../../lib/motion";
import type { Device } from "../../types";

export function DevicesView({
  localDevices,
  pairingOpenRequest,
  developerDiagnostics,
  relayUrl,
  artRuntime,
  onScanProviders,
  onOpenChat
}: {
  localDevices: Device[];
  pairingOpenRequest: number;
  developerDiagnostics: boolean;
  relayUrl: string;
  artRuntime: ArtRuntime;
  onScanProviders: () => void;
  onOpenChat: (agentId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState("epic-pc");
  const [deviceSearch, setDeviceSearch] = useState("");
  const [deviceFilter, setDeviceFilter] = useState<"all" | "online" | "offline" | "issues">("all");
  const [relayStatus, setRelayStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [relayDevices, setRelayDevices] = useState<RelayDeviceRecord[]>([]);
  const [relayPairing, setRelayPairing] = useState<RelayPairing | null>(null);
  const [claimedDeviceName, setClaimedDeviceName] = useState<string | null>(null);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [relaySend, setRelaySend] = useState<ReturnType<typeof connectRelayApp>["send"] | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const activeRelayUrl = normalizeRelayDeviceUrl(relayUrl);
  const relayRows = useMemo(() => relayDevices.map((record) => mapRelayDeviceRecord(record, activeRelayUrl)), [relayDevices, activeRelayUrl]);
  const localRows = useMemo(() => localDevices.map(mapLocalDeviceRecord), [localDevices]);
  const sourceRows = relayRows.length > 0 ? relayRows : localRows;
  const displayRows = useMemo(
    () => filterDeviceRows(sourceRows, deviceSearch, deviceFilter),
    [sourceRows, deviceSearch, deviceFilter]
  );
  const deviceSourceLabel =
    relayRows.length > 0
      ? `${relayRows.length} paired ${relayRows.length === 1 ? "device" : "devices"}`
      : localRows.length > 0
        ? "Local server device"
        : "No devices connected";
  const selectedDevice = displayRows.find((device) => device.id === selectedId) ?? displayRows[0];
  const onlineCount = displayRows.filter((device) => device.status === "online").length;
  const idleCount = displayRows.filter((device) => device.status === "busy" || device.statusLabel === "Idle").length;
  const offlineCount = displayRows.filter((device) => device.status === "offline").length;
  const issueCount = displayRows.filter((device) => device.status === "error").length;
  const stats = [
    { label: "Total Devices", value: displayRows.length, tone: "blue", icon: Monitor },
    { label: "Online", value: onlineCount, tone: "green", dot: true },
    { label: "Idle", value: idleCount, tone: "yellow", dot: true },
    { label: "Offline", value: offlineCount, tone: "muted", dot: true },
    { label: "Issues", value: issueCount, tone: "red", dot: true }
  ];

  const openConnectionWizard = () => {
    setRelayError(null);
    setWizardOpen(true);
  };

  useEffect(() => {
    setRelayStatus("connecting");
    setRelayDevices([]);
    setRelayPairing(null);
    setRelayError(null);
    const relay = connectRelayApp(
      (envelope) => {
        setRelayDevices((current) => {
          const next = applyRelayEnvelope(current, envelope);
          if (next.length > 0) setSelectedId((currentId) => (next.some((record) => record.device.id === currentId) ? currentId : next[0].device.id));
          return next;
        });
      },
      (status) => setRelayStatus(status),
      activeRelayUrl
    );
    setRelaySend(() => relay.send);
    return () => relay.close();
  }, [activeRelayUrl]);

  const handleCreatePairing = () => {
    setWizardOpen(true);
    createRelayPairingCode(activeRelayUrl)
      .then((pairing) => {
        setRelayPairing(pairing);
        setClaimedDeviceName(null);
        setRelayError(null);
      })
      .catch((error) => {
        setRelayError(error instanceof Error ? error.message : String(error));
      });
  };

  useEffect(() => {
    if (pairingOpenRequest > 0) {
      openConnectionWizard();
    }
  }, [pairingOpenRequest]);

  const handleApprovePairing = () => {
    if (!relayPairing) return;
    approveRelayPairingCode(relayPairing.code, activeRelayUrl)
      .then(({ pairing, device }) => {
        setRelayPairing(pairing);
        setClaimedDeviceName(device?.name ?? claimedDeviceName);
        setRelayError(null);
      })
      .catch((error) => {
        setRelayError(error instanceof Error ? error.message : String(error));
      });
  };

  const handleDevClaimPairing = () => {
    if (!relayPairing) return;
    claimRelayPairingCode(relayPairing.code, {
      name: "Windows Agent Preview",
      type: "pc",
      location: "local",
      agentVersion: "dev-ui-preview",
      fingerprint: `dev-ui-preview-${relayPairing.code}`
    }, activeRelayUrl)
      .then(({ pairing, device }) => {
        setRelayPairing(pairing);
        setClaimedDeviceName(device?.name ?? null);
        setRelayError(null);
      })
      .catch((error) => {
        setRelayError(error instanceof Error ? error.message : String(error));
      });
  };

  const handleRelayRequest = (type: "device.state.request" | "provider.refresh.request" | "agent.roster.request", deviceId = selectedDevice?.id) => {
    if (!deviceId || !relaySend) return false;
    const sent = relaySend(type, deviceId);
    if (!sent) setRelayError("Relay app socket is not connected.");
    else setRelayError(null);
    return sent;
  };

  return (
    <main className={pageMotionClass("page devices-page")}>
      <header className="workbench-header">
        <div className="workbench-title">
          <Monitor size={30} />
          <span>
            <h1>Devices</h1>
            <p>
              Relay {statusLabels[relayStatus]}
              {" \u2022 "}
              {deviceSourceLabel}
            </p>
          </span>
        </div>
        <div className="workbench-actions">
          <label className="search-field compact">
            <input value={deviceSearch} onChange={(event) => setDeviceSearch(event.target.value)} placeholder="Search devices..." />
            <Search size={18} />
          </label>
          <button className={deviceFilter !== "all" ? "secondary-action small selected" : "secondary-action small"} onClick={() => setDeviceFilter(nextDeviceFilter(deviceFilter))}>
            <FilterIcon />
            {deviceFilter === "all" ? "All" : deviceFilter === "issues" ? "Issues" : titleCase(deviceFilter)}
          </button>
          <button className="secondary-action small" onClick={onScanProviders}>
            <Activity size={18} />
            Scan Local
          </button>
          <button className="primary-action small" onClick={openConnectionWizard}>
            <Plus size={18} />
            Connect Agent
          </button>
        </div>
      </header>

      <AgentConnectionWizard
        open={wizardOpen}
        relayStatus={relayStatus}
        relayUrl={activeRelayUrl}
        relayDevices={relayDevices}
        localDevices={localDevices}
        pairing={relayPairing}
        claimedDeviceName={claimedDeviceName}
        error={relayError}
        allowDevClaim={developerDiagnostics}
        onClose={() => setWizardOpen(false)}
        onCreatePairing={handleCreatePairing}
        onDevClaimPairing={handleDevClaimPairing}
        onApprovePairing={handleApprovePairing}
        onRelayRequest={handleRelayRequest}
        onSelectDevice={setSelectedId}
        onOpenChat={onOpenChat}
      />

      <div className="devices-layout">
        <section className="devices-left">
          <div className="device-stats-panel">
            {stats.map((stat, index) => {
              const Icon = stat.icon;
              return (
                <article className="device-stat motion-card" key={stat.label} style={motionDelay(index, 34)}>
                  {Icon ? <Icon size={28} /> : <StatusDot status={stat.tone === "green" ? "online" : stat.tone === "red" ? "error" : stat.tone === "yellow" ? "busy" : "offline"} />}
                  <span>
                    <strong>{stat.value}</strong>
                    <small>{stat.label}</small>
                  </span>
                </article>
              );
            })}
          </div>

          <section className="device-list-panel" aria-label="Devices">
            {displayRows.length > 0 ? displayRows.map((device, index) => (
              <button
                className={cx("device-list-row motion-row", device.id === selectedId ? "selected" : `status-row-${device.status}`)}
                key={device.id}
                onClick={() => setSelectedId(device.id)}
                style={motionDelay(index, 38, 90)}
              >
                <span className="device-list-icon">
                  <img src={device.icon} alt="" />
                </span>
                <span className="device-list-copy">
                  <strong>
                    {device.name}
                    {device.tag ? <b className={`mini-tag ${device.tagTone ?? "blue"}`}>{device.tag}</b> : null}
                  </strong>
                  <small>
                    {device.system}
                    <i />
                    {device.connection}
                  </small>
                  <em className={`device-state-text status-${device.status}`}>
                    <StatusDot status={device.status} />
                    {device.statusLabel ?? statusLabels[device.status]}
                  </em>
                </span>
                <DeviceMetricStack metrics={device.metrics} />
                <ChevronRight size={22} />
              </button>
            )) : <div className="empty-agent-row">No devices match this view.</div>}
            <footer className="device-list-footer">Showing {displayRows.length} of {sourceRows.length} devices</footer>
          </section>
        </section>

        {selectedDevice ? (
          <DeviceDetailPanel device={selectedDevice} relayConnected={relayStatus === "online"} artRuntime={artRuntime} onRelayRequest={(type) => handleRelayRequest(type)} />
        ) : (
          <aside className="device-detail-panel">
            <section className="device-detail-content">
              <h2>No device selected</h2>
              <p>Pair a device or start the local agent server to see live provider state.</p>
            </section>
          </aside>
        )}
      </div>
    </main>
  );
}

function FilterIcon() {
  return (
    <span className="filter-icon" aria-hidden="true">
      <ChevronDown size={16} />
    </span>
  );
}

function DeviceMetricStack({ metrics }: { metrics?: DevicePageRow["metrics"] }) {
  const metricRows = metrics
    ? [
        ["CPU", metrics.cpu],
        ["RAM", metrics.ram],
        ["Disk", metrics.disk]
      ]
    : [
        ["-", undefined],
        ["-", undefined],
        ["-", undefined]
      ];

  return (
    <span className="device-metrics">
      {metricRows.map(([label, value], index) => (
        <span className="metric-row" key={`${label}-${index}`}>
          <small>{label}</small>
          <b>{typeof value === "number" ? `${value}%` : "-"}</b>
          <i>
            {typeof value === "number" ? <em style={{ width: `${value}%` }} /> : null}
          </i>
        </span>
      ))}
    </span>
  );
}

function DeviceDetailPanel({
  device,
  relayConnected,
  artRuntime,
  onRelayRequest
}: {
  device: DevicePageRow;
  relayConnected: boolean;
  artRuntime: ArtRuntime;
  onRelayRequest: (type: "device.state.request" | "provider.refresh.request" | "agent.roster.request") => void;
}) {
  const [startupStatus, setStartupStatus] = useState<LocalAgentStartupStatus | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupBusy, setStartupBusy] = useState(false);
  const canManageStartup = Boolean(device.relayUrl && device.startupDeviceId);
  const startupEnabledForDevice = Boolean(startupStatus?.enabled && startupMatchesDevice(startupStatus, device));

  useEffect(() => {
    let active = true;
    setStartupStatus(null);
    setStartupError(null);

    if (!canManageStartup) return () => {
      active = false;
    };

    getLocalAgentStartup()
      .then((status) => {
        if (!active) return;
        setStartupStatus(status);
      })
      .catch(() => {
        if (!active) return;
        setStartupError("Selected device agent is not reachable.");
      });

    return () => {
      active = false;
    };
  }, [canManageStartup, device.id]);

  const updateStartup = async () => {
    if (!startupStatus?.supported || startupBusy || !device.relayUrl || !device.startupDeviceId) return;
    setStartupBusy(true);
    setStartupError(null);
    try {
      const next = await setLocalAgentStartup(!startupEnabledForDevice, {
        relayUrl: device.relayUrl,
        deviceId: device.startupDeviceId
      });
      setStartupStatus(next);
    } catch {
      setStartupError("Could not update startup for this device.");
    } finally {
      setStartupBusy(false);
    }
  };

  const startupDetail =
    startupError ??
    startupStatus?.message ??
    (startupStatus
      ? startupEnabledForDevice
        ? `Startup is enabled for ${device.name}.`
        : startupStatus.enabled
          ? "Startup is enabled for a different device context."
          : `Startup is disabled for ${device.name}.`
      : canManageStartup
        ? "Checking startup registration for this device."
        : "Pair this device through the relay before managing startup.");

  const overview: Array<{ label: string; value: string; icon: ElementType; bar?: number; detail?: string }> = [
    { label: "CPU Usage", value: formatMetric(device.metrics?.cpu), icon: Cpu, bar: device.metrics?.cpu },
    { label: "RAM Usage", value: formatMetric(device.metrics?.ram), icon: Activity, bar: device.metrics?.ram },
    { label: "Disk Usage", value: formatMetric(device.metrics?.disk), icon: Database, bar: device.metrics?.disk },
    { label: "Uptime", value: "Unknown", icon: Activity }
  ];

  return (
    <aside className="device-detail-panel">
      <div className="device-detail-hero">
        <img src={artRuntime.agentArt("reika", "room-background", artRuntime.globalArt("global-backgrounds", assets.room.full, "device-detail-global"), "device-detail")} alt="" />
        <span>
          <img src={device.icon} alt="" />
        </span>
      </div>
      <section className="device-detail-content">
        <header>
          <h2>{device.name}</h2>
          <StatusPill status={device.status} />
          <p>
            {device.system}
            {" \u2022 "}
            {device.connection}
          </p>
        </header>

        <div className="device-action-grid">
          <button disabled={!relayConnected} onClick={() => onRelayRequest("device.state.request")}>
            <Monitor size={22} />
            Request State
          </button>
          <button disabled={!relayConnected} onClick={() => onRelayRequest("provider.refresh.request")}>
            <Activity size={22} />
            Refresh Providers
          </button>
          <button disabled={!relayConnected} onClick={() => onRelayRequest("agent.roster.request")}>
            <Bot size={22} />
            Request Roster
          </button>
        </div>

        <section className="device-detail-section">
          <h3>System Overview</h3>
          {overview.map((item) => {
            const Icon = item.icon;
            return (
              <div className="overview-row" key={item.label}>
                <Icon size={18} />
                <span>{item.label}</span>
                {typeof item.bar === "number" ? (
                  <i>
                    <em style={{ width: `${item.bar}%` }} />
                  </i>
                ) : null}
                <strong>
                  {item.value}
                  {item.detail ? <small>{item.detail}</small> : null}
                </strong>
              </div>
            );
          })}
        </section>

        <section className="device-detail-section">
          <h3>Connection Details</h3>
          <DetailRow label="Provider" value={device.provider} image={assets.icons.providers[device.provider]} />
          <DetailRow label="Last Connected" value={device.lastConnected} icon={Activity} />
          <DetailRow label="Local IP" value={device.localIp} icon={Globe2} />
          <DetailRow label="Agent Version" value={device.version} icon={Info} />
          {device.relayUrl ? <DetailRow label="Startup Relay" value={device.relayUrl} icon={Link2} /> : null}
          {device.lastCommand ? <DetailRow label="Relay" value={device.lastCommand} icon={ShieldCheck} /> : null}
        </section>

        <section className="device-detail-section">
          <h3>Startup</h3>
          <div className="startup-device-row">
            <span>
              <strong>Auto Start Agent</strong>
              <small>{startupDetail}</small>
            </span>
            <Toggle checked={startupEnabledForDevice} disabled={!canManageStartup || !startupStatus?.supported || startupBusy} onClick={updateStartup} />
          </div>
        </section>

        <section className="device-detail-section">
          <h3>Providers</h3>
          <div className="relay-provider-list">
            {(device.providers ?? []).length > 0 ? (
              device.providers?.map((provider) => (
                <div className={provider.id === device.activeProviderId ? "relay-provider-row active" : "relay-provider-row"} key={provider.id}>
                  <img src={assets.icons.providers[provider.name]} alt="" />
                  <span>
                    <strong>{provider.name}</strong>
                    <small>{provider.agents.length} {provider.agents.length === 1 ? "agent" : "agents"}</small>
                  </span>
                  <StatusPill status={provider.status} />
                </div>
              ))
            ) : (
              <div className="empty-agent-row">No provider snapshot yet</div>
            )}
          </div>
        </section>

        <section className="device-detail-section">
          <h3>Agent Roster</h3>
          <div className="relay-agent-list">
            {(device.agents ?? []).length > 0 ? (
              device.agents?.map((agent) => (
                <div className="relay-agent-row" key={agent.id}>
                  <img src={getAgentAvatar(agent, artRuntime)} alt="" />
                  <span>
                    <strong>{agent.name}</strong>
                    <small>{agent.role}</small>
                  </span>
                  <StatusPill status={agent.status} />
                </div>
              ))
            ) : (
              <div className="empty-agent-row">No roster snapshot yet</div>
            )}
          </div>
        </section>
      </section>
    </aside>
  );
}
