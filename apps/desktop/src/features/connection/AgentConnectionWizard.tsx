import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Check,
  CheckCircle2,
  Clipboard,
  Laptop,
  Link2,
  Monitor,
  Radio,
  Server,
  Terminal,
  X
} from "lucide-react";
import { statusLabels } from "../../app/constants";
import { linuxInstallCommand } from "../../config/relay";
import { assets } from "../../data/assets";
import type { RelayDeviceRecord, RelayPairing } from "../../data/relay";
import { mapRelayDeviceRecord, titleCase, type DevicePageRow } from "../../domain/reikaMappers";
import { cx, motionDelay } from "../../lib/motion";
import type { Device, Provider } from "../../types";
import { StatusDot, StatusPill } from "../../components/status";

type SafeRelayRequest = "device.state.request" | "provider.refresh.request" | "agent.roster.request";
type WizardPlatform = "windows" | "linux" | "existing";
type WizardStep = "platform" | "pairing" | "verify" | "ready";

export function AgentConnectionWizard({
  open,
  relayStatus,
  relayUrl,
  relayDevices,
  localDevices,
  pairing,
  claimedDeviceName,
  error,
  allowDevClaim,
  onClose,
  onCreatePairing,
  onApprovePairing,
  onDevClaimPairing,
  onRelayRequest,
  onSelectDevice,
  onOpenChat
}: {
  open: boolean;
  relayStatus: "connecting" | "online" | "offline";
  relayUrl: string;
  relayDevices: RelayDeviceRecord[];
  localDevices: Device[];
  pairing: RelayPairing | null;
  claimedDeviceName: string | null;
  error: string | null;
  allowDevClaim: boolean;
  onClose: () => void;
  onCreatePairing: () => void;
  onApprovePairing: () => void;
  onDevClaimPairing: () => void;
  onRelayRequest: (type: SafeRelayRequest, deviceId: string) => boolean;
  onSelectDevice: (deviceId: string) => void;
  onOpenChat: (agentId: string) => void;
}) {
  const [platform, setPlatform] = useState<WizardPlatform>("windows");
  const [step, setStep] = useState<WizardStep>("platform");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [copyNotice, setCopyNotice] = useState("");
  const requestedAfterApproval = useRef<string | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const relayRows = useMemo(() => relayDevices.map((record) => mapRelayDeviceRecord(record, relayUrl)), [relayDevices, relayUrl]);
  const localRows = useMemo(() => localDevices.map((device) => ({
    id: device.id,
    name: device.name,
    status: device.status,
    providers: device.providers,
    agents: device.providers.flatMap((provider) => provider.agents),
    activeProviderId: device.activeProviderId,
    system: device.systemLabel ?? titleCase(device.type),
    connection: `${device.location} Connection`,
    lastConnected: device.lastSeenAt ?? "Just now",
    relayUrl: undefined
  })), [localDevices]);
  const deviceRows = relayRows.length > 0 ? relayRows : localRows;
  const approvedDeviceId = pairing?.status === "approved" ? pairing.deviceId : undefined;
  const selectedDevice =
    deviceRows.find((device) => device.id === selectedDeviceId) ??
    deviceRows.find((device) => device.id === approvedDeviceId) ??
    deviceRows[0];
  const linuxCommand = pairing ? linuxInstallCommand(pairing.code, relayUrl) : "";
  const agents = selectedDevice?.agents ?? selectedDevice?.providers?.flatMap((provider) => provider.agents) ?? [];
  const activeProvider =
    selectedDevice?.providers?.find((provider) => provider.id === selectedDevice.activeProviderId) ??
    selectedDevice?.providers?.find((provider) => provider.status === "online") ??
    selectedDevice?.providers?.[0];
  const currentStep = resolveStep(step, platform, pairing, selectedDevice);

  useEffect(() => {
    if (!open) return;
    setCopyNotice("");
    if (relayRows.length > 0 && !selectedDeviceId) setSelectedDeviceId(relayRows[0].id);
  }, [open, relayRows, selectedDeviceId]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? []);
    window.setTimeout(() => focusable()[0]?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !approvedDeviceId || requestedAfterApproval.current === approvedDeviceId) return;
    requestedAfterApproval.current = approvedDeviceId;
    setSelectedDeviceId(approvedDeviceId);
    onSelectDevice(approvedDeviceId);
    onRelayRequest("device.state.request", approvedDeviceId);
    window.setTimeout(() => onRelayRequest("provider.refresh.request", approvedDeviceId), 300);
    window.setTimeout(() => onRelayRequest("agent.roster.request", approvedDeviceId), 600);
    setStep("verify");
  }, [approvedDeviceId, onRelayRequest, onSelectDevice, open]);

  if (!open) return null;

  const createCode = () => {
    setStep("pairing");
    onCreatePairing();
  };

  const selectExistingDevice = (deviceId: string) => {
    setPlatform("existing");
    setSelectedDeviceId(deviceId);
    setStep("verify");
    onSelectDevice(deviceId);
    onRelayRequest("device.state.request", deviceId);
    window.setTimeout(() => onRelayRequest("provider.refresh.request", deviceId), 250);
    window.setTimeout(() => onRelayRequest("agent.roster.request", deviceId), 500);
  };

  const approve = () => {
    onApprovePairing();
  };

  const copyLinuxCommand = () => {
    if (!linuxCommand) return;
    void copyText(linuxCommand).then((copied) => setCopyNotice(copied ? "Linux command copied." : "Could not copy. Select the command text manually."));
  };

  const copyRelayUrl = () => {
    void copyText(relayUrl).then((copied) => setCopyNotice(copied ? "Relay URL copied." : "Could not copy. Select the relay URL manually."));
  };

  const firstAgentId = agents[0]?.id ?? "reika";

  return (
    <div className="connection-wizard-backdrop" role="presentation">
      <section ref={dialogRef} className="connection-wizard" role="dialog" aria-modal="true" aria-labelledby="connection-wizard-title">
        <header className="connection-wizard-header">
          <span>
            <Radio size={22} />
            <b id="connection-wizard-title">Connect Agent</b>
            <small>Pair, verify, and confirm a device without leaving this flow.</small>
          </span>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close connection wizard">
            <X size={20} />
          </button>
        </header>

        <div className="connection-wizard-steps" aria-label="Connection steps">
          {(["platform", "pairing", "verify", "ready"] as WizardStep[]).map((item, index) => (
            <span className={cx(item === currentStep ? "active" : "", stepComplete(item, currentStep) ? "done" : "")} key={item}>
              <i>{stepComplete(item, currentStep) ? <Check size={14} /> : index + 1}</i>
              {stepLabel(item)}
            </span>
          ))}
        </div>

        <div className="connection-wizard-body">
          <section className="connection-wizard-main">
            {currentStep === "platform" ? (
              <PlatformChooser platform={platform} onChange={setPlatform} onCreateCode={createCode} onSelectExisting={() => setStep("verify")} pairedCount={relayRows.length} />
            ) : null}

            {currentStep === "pairing" ? (
              <PairingInstructions
                platform={platform}
                pairing={pairing}
                claimedDeviceName={claimedDeviceName}
                relayUrl={relayUrl}
                linuxCommand={linuxCommand}
                allowDevClaim={allowDevClaim}
                onCopyLinuxCommand={copyLinuxCommand}
                onCopyRelayUrl={copyRelayUrl}
                onCreateCode={createCode}
                onDevClaim={onDevClaimPairing}
                onApprove={approve}
              />
            ) : null}

            {currentStep === "verify" ? (
              <VerificationStep
                relayStatus={relayStatus}
                selectedDevice={selectedDevice}
                deviceRows={deviceRows}
                activeProvider={activeProvider}
                onSelectDevice={selectExistingDevice}
                onRelayRequest={onRelayRequest}
                onReady={() => setStep("ready")}
              />
            ) : null}

            {currentStep === "ready" ? (
              <ReadyStep
                selectedDevice={selectedDevice}
                relayUrl={relayUrl}
                activeProvider={activeProvider}
                agents={agents}
                onOpenChat={() => onOpenChat(firstAgentId)}
                onOpenDevice={() => {
                  if (selectedDevice) onSelectDevice(selectedDevice.id);
                  onClose();
                }}
                onRefresh={() => selectedDevice && onRelayRequest("provider.refresh.request", selectedDevice.id)}
                onCopyLinuxCommand={copyLinuxCommand}
                linuxCommand={linuxCommand}
              />
            ) : null}
          </section>

          <aside className="connection-wizard-side">
            <StatusCard relayStatus={relayStatus} relayUrl={relayUrl} selectedDevice={selectedDevice} copyNotice={copyNotice} error={error} />
            <ProviderVerification providers={selectedDevice?.providers ?? []} activeProviderId={selectedDevice?.activeProviderId} />
            <AgentRoster agents={agents} />
          </aside>
        </div>
      </section>
    </div>
  );
}

function PlatformChooser({
  platform,
  pairedCount,
  onChange,
  onCreateCode,
  onSelectExisting
}: {
  platform: WizardPlatform;
  pairedCount: number;
  onChange: (platform: WizardPlatform) => void;
  onCreateCode: () => void;
  onSelectExisting: () => void;
}) {
  const options: Array<{ id: WizardPlatform; title: string; detail: string; icon: typeof Monitor }> = [
    { id: "windows", title: "Windows App", detail: "Use the local Windows pairing UI from the agent .exe.", icon: Laptop },
    { id: "linux", title: "Linux CLI", detail: "Copy one command for a server or terminal install.", icon: Terminal },
    { id: "existing", title: "Existing Device", detail: "Verify a device that is already paired through the relay.", icon: Server }
  ];

  return (
    <div className="connection-step-card">
      <header>
        <h2>Choose Connection Path</h2>
        <p>Start with the device type. The wizard will create the right instructions and then verify the provider snapshot.</p>
      </header>
      <div className="connection-platform-grid">
        {options.map((option, index) => {
          const Icon = option.icon;
          return (
            <button className={cx("connection-platform-card", platform === option.id ? "selected" : "")} type="button" key={option.id} onClick={() => onChange(option.id)} style={motionDelay(index, 42)}>
              <Icon size={28} />
              <span>
                <strong>{option.title}</strong>
                <small>{option.detail}</small>
              </span>
              {platform === option.id ? <CheckCircle2 size={20} /> : null}
            </button>
          );
        })}
      </div>
      <footer className="connection-step-actions">
        {platform === "existing" ? (
          <button className="primary-action small" type="button" onClick={onSelectExisting} disabled={pairedCount < 1}>
            <Activity size={18} />
            Verify Existing Device
          </button>
        ) : (
          <button className="primary-action small" type="button" onClick={onCreateCode}>
            <Link2 size={18} />
            Create Pairing Code
          </button>
        )}
      </footer>
    </div>
  );
}

function PairingInstructions({
  platform,
  pairing,
  claimedDeviceName,
  relayUrl,
  linuxCommand,
  allowDevClaim,
  onCopyLinuxCommand,
  onCopyRelayUrl,
  onCreateCode,
  onDevClaim,
  onApprove
}: {
  platform: WizardPlatform;
  pairing: RelayPairing | null;
  claimedDeviceName: string | null;
  relayUrl: string;
  linuxCommand: string;
  allowDevClaim: boolean;
  onCopyLinuxCommand: () => void;
  onCopyRelayUrl: () => void;
  onCreateCode: () => void;
  onDevClaim: () => void;
  onApprove: () => void;
}) {
  const canApprove = pairing?.status === "claimed";

  return (
    <div className="connection-step-card">
      <header>
        <h2>Pair Device</h2>
        <p>{platform === "linux" ? "Run the one-line command on the Linux machine you want to connect. Leave this wizard open, then approve the device when it appears." : "Open the Windows agent app on the device you want to connect. Paste the code there, leave both windows open, then approve the device here."}</p>
      </header>
      <div className="connection-code-grid">
        <article>
          <small>Pairing Code</small>
          <strong>{pairing?.code ?? "No code yet"}</strong>
        </article>
        <article>
          <small>Status</small>
          <strong>{pairing?.status ?? "waiting"}</strong>
        </article>
        <article>
          <small>Claimed Device</small>
          <strong>{claimedDeviceName ?? pairing?.deviceId ?? "Waiting for device"}</strong>
        </article>
      </div>
      <div className="connection-instruction-panel">
        {platform === "linux" ? (
          <>
            <h3>Linux one-line command</h3>
            <code>{linuxCommand || "Create a pairing code first."}</code>
            <ol className="connection-steps-list">
              <li>Copy the command.</li>
              <li>Paste it into the Linux device terminal.</li>
              <li>Wait for the device name to appear above.</li>
              <li>Click Approve And Verify.</li>
            </ol>
            <button className="secondary-action small" type="button" onClick={onCopyLinuxCommand} disabled={!linuxCommand}>
              <Clipboard size={18} />
              Copy Command
            </button>
          </>
        ) : (
          <>
            <h3>Windows pairing</h3>
            <ol className="connection-steps-list">
              <li>Launch <code>reika-node.exe</code> on the Windows node.</li>
              <li>Paste the relay URL and pairing code into the agent pairing window.</li>
              <li>Click Pair Device in that window.</li>
              <li>Return here and click Approve And Verify once the device is claimed.</li>
            </ol>
            <button className="secondary-action small" type="button" onClick={onCopyRelayUrl}>
              <Clipboard size={18} />
              Copy Relay URL
            </button>
          </>
        )}
      </div>
      <footer className="connection-step-actions">
        <button className="secondary-action small" type="button" onClick={onCreateCode}>
          <Link2 size={18} />
          New Code
        </button>
        {allowDevClaim ? (
          <button className="secondary-action small" type="button" onClick={onDevClaim} disabled={!pairing}>
            <Monitor size={18} />
            Dev Claim
          </button>
        ) : null}
        <button className="primary-action small" type="button" onClick={onApprove} disabled={!canApprove}>
          <Check size={18} />
          Approve And Verify
        </button>
      </footer>
    </div>
  );
}

function VerificationStep({
  relayStatus,
  selectedDevice,
  deviceRows,
  activeProvider,
  onSelectDevice,
  onRelayRequest,
  onReady
}: {
  relayStatus: "connecting" | "online" | "offline";
  selectedDevice: Partial<DevicePageRow> | undefined;
  deviceRows: Array<Partial<DevicePageRow>>;
  activeProvider: Provider | undefined;
  onSelectDevice: (deviceId: string) => void;
  onRelayRequest: (type: SafeRelayRequest, deviceId: string) => boolean;
  onReady: () => void;
}) {
  const canRequest = relayStatus === "online" && Boolean(selectedDevice?.id);
  const hasProviders = Boolean(selectedDevice?.providers?.length);
  const hasAgents = Boolean(selectedDevice?.agents?.length || selectedDevice?.providers?.some((provider) => provider.agents.length > 0));

  return (
    <div className="connection-step-card">
      <header>
        <h2>Verify Provider Snapshot</h2>
        <p>Confirm the device is online, refresh providers, and ask for the roster. Only safe relay requests are used here.</p>
      </header>
      <div className="connection-device-picker">
        {deviceRows.length > 0 ? deviceRows.map((device, index) => (
          <button className={cx("connection-device-option", device.id === selectedDevice?.id ? "selected" : "")} type="button" key={device.id} onClick={() => device.id && onSelectDevice(device.id)} style={motionDelay(index, 34)}>
            <Monitor size={20} />
            <span>
              <strong>{device.name}</strong>
              <small>{device.system} {"\u2022"} {device.connection}</small>
            </span>
            <StatusPill status={device.status ?? "unknown"} />
          </button>
        )) : <div className="empty-agent-row">No paired devices yet. Create a pairing code first.</div>}
      </div>
      <div className="connection-safe-actions">
        <button type="button" disabled={!canRequest} onClick={() => selectedDevice?.id && onRelayRequest("device.state.request", selectedDevice.id)}>
          <Monitor size={22} />
          Request State
        </button>
        <button type="button" disabled={!canRequest} onClick={() => selectedDevice?.id && onRelayRequest("provider.refresh.request", selectedDevice.id)}>
          <Activity size={22} />
          Refresh Providers
        </button>
        <button type="button" disabled={!canRequest} onClick={() => selectedDevice?.id && onRelayRequest("agent.roster.request", selectedDevice.id)}>
          <Bot size={22} />
          Request Agent Roster
        </button>
      </div>
      <div className="connection-readiness">
        <ReadinessItem label="Relay online" ready={relayStatus === "online"} detail={statusLabels[relayStatus]} />
        <ReadinessItem label="Device online" ready={selectedDevice?.status === "online"} detail={selectedDevice?.name ?? "No device selected"} />
        <ReadinessItem label="Provider detected" ready={hasProviders} detail={activeProvider ? `${activeProvider.name} is ${statusLabels[activeProvider.status]}` : "No provider snapshot yet"} />
        <ReadinessItem label="Agent roster" ready={hasAgents} detail={hasAgents ? "Roster available" : "Request roster after provider refresh"} />
      </div>
      <footer className="connection-step-actions">
        <button className="primary-action small" type="button" onClick={onReady} disabled={!selectedDevice}>
          <CheckCircle2 size={18} />
          Continue To Ready
        </button>
      </footer>
    </div>
  );
}

function ReadyStep({
  selectedDevice,
  relayUrl,
  activeProvider,
  agents,
  linuxCommand,
  onOpenChat,
  onOpenDevice,
  onRefresh,
  onCopyLinuxCommand
}: {
  selectedDevice: Partial<DevicePageRow> | undefined;
  relayUrl: string;
  activeProvider: Provider | undefined;
  agents: NonNullable<DevicePageRow["agents"]>;
  linuxCommand: string;
  onOpenChat: () => void;
  onOpenDevice: () => void;
  onRefresh: () => void;
  onCopyLinuxCommand: () => void;
}) {
  return (
    <div className="connection-step-card ready">
      <header>
        <h2>Agent Connection Ready</h2>
        <p>The selected device is connected enough for Phase 1: presence, provider snapshot, and roster verification.</p>
      </header>
      <div className="connection-ready-card">
        <CheckCircle2 size={38} />
        <span>
          <strong>{selectedDevice?.name ?? "Device"}</strong>
          <small>{activeProvider ? `${activeProvider.name} active provider` : "No active provider yet"} {"\u2022"} {agents.length} {agents.length === 1 ? "agent" : "agents"}</small>
        </span>
      </div>
      <div className="connection-code-grid">
        <article>
          <small>Relay URL</small>
          <strong>{relayUrl}</strong>
        </article>
        <article>
          <small>Startup Status</small>
          <strong>{selectedDevice?.startupDeviceId ? "Device scoped" : "Local only"}</strong>
        </article>
        <article>
          <small>Last Seen</small>
          <strong>{selectedDevice?.lastConnected ?? "Unknown"}</strong>
        </article>
      </div>
      <footer className="connection-step-actions">
        <button className="primary-action small" type="button" onClick={onOpenChat}>
          <Bot size={18} />
          Open Chat
        </button>
        <button className="secondary-action small" type="button" onClick={onOpenDevice}>
          <Monitor size={18} />
          Open Device Detail
        </button>
        <button className="secondary-action small" type="button" onClick={onRefresh} disabled={!selectedDevice}>
          <Activity size={18} />
          Refresh Providers
        </button>
        <button className="secondary-action small" type="button" onClick={onCopyLinuxCommand} disabled={!linuxCommand}>
          <Clipboard size={18} />
          Copy Linux Command
        </button>
      </footer>
    </div>
  );
}

function StatusCard({
  relayStatus,
  relayUrl,
  selectedDevice,
  copyNotice,
  error
}: {
  relayStatus: "connecting" | "online" | "offline";
  relayUrl: string;
  selectedDevice: Partial<DevicePageRow> | undefined;
  copyNotice: string;
  error: string | null;
}) {
  return (
    <section className="connection-side-card">
      <h3>Connection Status</h3>
      <DetailLine label="Relay" value={statusLabels[relayStatus]} dot={relayStatus === "online" ? "online" : relayStatus === "offline" ? "offline" : "connecting"} />
      <DetailLine label="Device" value={selectedDevice?.name ?? "Waiting"} dot={selectedDevice?.status ?? "unknown"} />
      <DetailLine label="Relay URL" value={relayUrl} />
      {copyNotice ? <p className="connection-notice">{copyNotice}</p> : null}
      {error ? <p className="connection-error">{error}</p> : null}
    </section>
  );
}

function ProviderVerification({ providers, activeProviderId }: { providers: Provider[]; activeProviderId?: string }) {
  const expected: Provider["name"][] = ["Hermes", "OpenClaw", "CommandCenter", "Mock"];
  return (
    <section className="connection-side-card">
      <h3>Providers</h3>
      <div className="connection-provider-checks">
        {expected.map((name) => {
          const provider = providers.find((item) => item.name === name);
          const status = provider?.status ?? "offline";
          return (
            <div className={cx("connection-provider-check", provider?.id === activeProviderId ? "active" : "")} key={name}>
              <img src={assets.icons.providers[name]} alt="" />
              <span>
                <strong>{name}</strong>
                <small>{provider ? providerFixText(provider) : "Not detected on this device"}</small>
              </span>
              <StatusPill status={status} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AgentRoster({ agents }: { agents: NonNullable<DevicePageRow["agents"]> }) {
  return (
    <section className="connection-side-card">
      <h3>Agent Roster</h3>
      <div className="connection-agent-roster">
        {agents.length > 0 ? agents.map((agent) => (
          <div className="connection-agent-row" key={agent.id}>
            <span>
              <strong>{agent.name}</strong>
              <small>{agent.role}</small>
            </span>
            <StatusPill status={agent.status} />
          </div>
        )) : <div className="empty-agent-row">No roster snapshot yet.</div>}
      </div>
    </section>
  );
}

function DetailLine({ label, value, dot }: { label: string; value: string; dot?: DevicePageRow["status"] }) {
  return (
    <div className="connection-detail-line">
      <small>{label}</small>
      <strong>
        {dot ? <StatusDot status={dot} /> : null}
        {value}
      </strong>
    </div>
  );
}

function ReadinessItem({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
  return (
    <div className={cx("connection-readiness-item", ready ? "ready" : "")}>
      <i>{ready ? <Check size={14} /> : <StatusDot status="connecting" />}</i>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}

function resolveStep(step: WizardStep, platform: WizardPlatform, pairing: RelayPairing | null, selectedDevice: Partial<DevicePageRow> | undefined): WizardStep {
  if (step === "ready") return "ready";
  if (step === "verify" || (platform === "existing" && selectedDevice)) return "verify";
  if (step === "pairing" || pairing) return pairing?.status === "approved" && selectedDevice ? "verify" : "pairing";
  return "platform";
}

function stepComplete(step: WizardStep, current: WizardStep) {
  const order: WizardStep[] = ["platform", "pairing", "verify", "ready"];
  return order.indexOf(step) < order.indexOf(current);
}

function stepLabel(step: WizardStep) {
  if (step === "platform") return "Path";
  if (step === "pairing") return "Pair";
  if (step === "verify") return "Verify";
  return "Ready";
}

function providerFixText(provider: Provider) {
  if (provider.status === "online") return `${provider.agents.length} ${provider.agents.length === 1 ? "agent" : "agents"} detected`;
  if (provider.status === "error") return "Open the provider locally and refresh providers.";
  if (provider.status === "connecting") return "Provider is planned or still being checked.";
  return "Start this provider on the device, then refresh.";
}

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy clipboard path for desktop shell/webview builds.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}
