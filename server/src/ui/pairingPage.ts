import type { RelayClientSnapshot } from '../modules/uplink/relayClient.js';
import type { DeviceIdentity } from '../modules/device/types.js';
import type { StartupStatus } from '../platform/startup.js';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function pairingPage(device: DeviceIdentity, uplink: RelayClientSnapshot, startup: StartupStatus) {
  const defaultRelayUrl = uplink.relayUrl || 'ws://127.0.0.1:8790/v1/device';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reika Agent Pairing</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, Segoe UI, system-ui, sans-serif; background: #020814; color: #eef5ff; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 70% 20%, #083b83 0, transparent 34%), #020814; }
    main { width: min(560px, calc(100vw - 32px)); border: 1px solid #143768; border-radius: 16px; background: rgba(4, 13, 30, .88); box-shadow: 0 24px 80px rgba(0, 86, 255, .18); padding: 28px; }
    h1 { margin: 0 0 8px; font-size: 30px; letter-spacing: .04em; }
    p { margin: 0 0 22px; color: #aebce0; line-height: 1.5; }
    label { display: grid; gap: 8px; margin: 16px 0; color: #c8d6ff; font-size: 14px; }
    input { width: 100%; border: 1px solid #20487e; border-radius: 10px; background: #07142a; color: #fff; padding: 13px 14px; font: inherit; outline: none; }
    input:focus { border-color: #118cff; box-shadow: 0 0 0 3px rgba(17, 140, 255, .2); }
    button { width: 100%; border: 0; border-radius: 10px; padding: 14px 16px; background: linear-gradient(135deg, #168cff, #0a4dff); color: white; font: inherit; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    button.secondary { margin-top: 10px; background: #0a1830; border: 1px solid #254a7c; color: #cfe2ff; }
    button.danger { margin-top: 10px; background: #2b1020; border: 1px solid #6e2640; color: #ffb3c0; }
    dl { display: grid; grid-template-columns: 120px 1fr; gap: 8px 14px; padding: 14px; border: 1px solid #143768; border-radius: 12px; background: rgba(9, 23, 48, .68); }
    dt { color: #8294c1; }
    dd { margin: 0; overflow-wrap: anywhere; }
    section { margin-top: 18px; padding-top: 18px; border-top: 1px solid #12315e; }
    h2 { margin: 0 0 8px; font-size: 18px; letter-spacing: .03em; }
    code { display: block; margin-top: 10px; padding: 12px; border: 1px solid #143768; border-radius: 10px; background: #050f21; color: #94caff; overflow-wrap: anywhere; }
    .status { display: inline-flex; align-items: center; gap: 8px; }
    .dot { width: 9px; height: 9px; border-radius: 999px; background: #7180a8; box-shadow: 0 0 16px currentColor; }
    .connected .dot { background: #25e68a; color: #25e68a; }
    .error .dot { background: #ff5468; color: #ff5468; }
    .enabled .dot { background: #25e68a; color: #25e68a; }
    .disabled .dot { background: #7180a8; color: #7180a8; }
    #message { min-height: 22px; margin-top: 14px; color: #6bb6ff; }
    #startupMessage { min-height: 22px; margin-top: 10px; color: #6bb6ff; }
  </style>
</head>
<body>
  <main>
    <h1>AGENTHUB</h1>
    <p>Pair this Windows device with the relay. Create a pairing code in AgentHub, paste it here, and the agent will connect outbound.</p>
    <dl>
      <dt>Device</dt><dd>${escapeHtml(device.name)}</dd>
      <dt>ID</dt><dd>${escapeHtml(uplink.deviceId)}</dd>
      <dt>Status</dt><dd><span id="status" class="status ${escapeHtml(uplink.status)}"><span class="dot"></span><span>${escapeHtml(uplink.status)}</span></span></dd>
    </dl>
    <form id="pairForm">
      <label>Relay URL
        <input id="relayUrl" value="${escapeHtml(defaultRelayUrl)}" spellcheck="false" />
      </label>
      <label>Pairing code
        <input id="pairingToken" placeholder="Paste code from AgentHub" spellcheck="false" autocomplete="off" />
      </label>
      <button type="submit">Pair Device</button>
      <button type="button" class="secondary" id="refresh">Refresh Status</button>
    </form>
    <div id="message"></div>
    <section>
      <h2>Startup</h2>
      <p>Start this agent automatically for this user.</p>
      <dl>
        <dt>Startup</dt><dd><span id="startupStatus" class="status ${startup.enabled ? 'enabled' : 'disabled'}"><span class="dot"></span><span>${startup.enabled ? 'enabled' : 'disabled'}</span></span></dd>
        <dt>Method</dt><dd id="startupMethod">${escapeHtml(startup.method)}</dd>
      </dl>
      <button type="button" id="enableStartup">Enable Startup</button>
      <button type="button" class="danger" id="disableStartup">Disable Startup</button>
      <code id="startupCommand">${escapeHtml(startup.command ?? 'No startup command registered.')}</code>
      <div id="startupMessage">${escapeHtml(startup.message ?? '')}</div>
    </section>
  </main>
  <script>
    const statusEl = document.getElementById('status');
    const messageEl = document.getElementById('message');
    const startupStatusEl = document.getElementById('startupStatus');
    const startupMethodEl = document.getElementById('startupMethod');
    const startupCommandEl = document.getElementById('startupCommand');
    const startupMessageEl = document.getElementById('startupMessage');
    const enableStartupButton = document.getElementById('enableStartup');
    const disableStartupButton = document.getElementById('disableStartup');
    function setStatus(status) {
      statusEl.className = 'status ' + status;
      statusEl.lastElementChild.textContent = status;
    }
    function renderStartup(startup) {
      startupStatusEl.className = 'status ' + (startup.enabled ? 'enabled' : 'disabled');
      startupStatusEl.lastElementChild.textContent = startup.enabled ? 'enabled' : 'disabled';
      startupMethodEl.textContent = startup.method;
      startupCommandEl.textContent = startup.command || 'No startup command registered.';
      startupMessageEl.textContent = startup.message || '';
      enableStartupButton.disabled = !startup.supported || startup.enabled;
      disableStartupButton.disabled = !startup.supported || !startup.enabled;
    }
    async function refresh() {
      const response = await fetch('/uplink');
      const body = await response.json();
      setStatus(body.uplink.status);
      messageEl.textContent = body.uplink.lastError || '';
    }
    async function refreshStartup() {
      const response = await fetch('/startup');
      const body = await response.json();
      renderStartup(body.startup);
    }
    document.getElementById('refresh').addEventListener('click', refresh);
    enableStartupButton.addEventListener('click', async () => {
      startupMessageEl.textContent = 'Enabling startup...';
      const response = await fetch('/startup/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relayUrl: document.getElementById('relayUrl').value.trim() })
      });
      const body = await response.json();
      renderStartup(body.startup);
    });
    disableStartupButton.addEventListener('click', async () => {
      startupMessageEl.textContent = 'Disabling startup...';
      const response = await fetch('/startup/disable', { method: 'POST' });
      const body = await response.json();
      renderStartup(body.startup);
    });
    document.getElementById('pairForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      messageEl.textContent = 'Connecting...';
      const response = await fetch('/uplink/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relayUrl: document.getElementById('relayUrl').value.trim(),
          pairingToken: document.getElementById('pairingToken').value.trim()
        })
      });
      const body = await response.json();
      setStatus(body.uplink.status);
      messageEl.textContent = body.ok ? 'Pairing started. Approve this device in AgentHub.' : body.error;
      setTimeout(refresh, 1200);
    });
    setInterval(refresh, 3000);
    refreshStartup();
  </script>
</body>
</html>`;
}
