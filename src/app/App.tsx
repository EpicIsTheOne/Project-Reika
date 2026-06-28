import { Activity, Bell, Bot, Cpu, Database, Monitor, Radio, Settings, Sparkles } from 'lucide-react';
import { agents, assets, conversations, devices, messages, notifications, providers, settings } from './mockData';

function Pill({ children, tone = 'cyan' }: { children: React.ReactNode; tone?: 'cyan' | 'blue' | 'gold' | 'muted' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-header">
        <div className="panel-title">{icon}<h2>{title}</h2></div>
      </header>
      {children}
    </section>
  );
}

export function App() {
  const reika = agents[0];

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <Pill tone="gold">Project Reika</Pill>
          <h1>Linux agent client shell</h1>
          <p>
            A Linux-first client for Reika, the main agent mascot. This phase is local-only:
            UI, modules, mock state, and adapter boundaries — no external provider connection code yet.
          </p>
          <div className="hero-actions">
            <Pill>Reika vertical slice</Pill>
            <Pill tone="blue">External connections disabled</Pill>
            <Pill tone="muted">Provider planning later</Pill>
          </div>
        </div>
        <div className="reika-card">
          <div className="halo" />
          <div className="portrait">零</div>
          <h2>{reika.name}</h2>
          <p>{reika.role}</p>
          <Pill>{reika.callsign} / {reika.mood}</Pill>
        </div>
      </section>

      <section className="grid two">
        <Panel title="Providers" icon={<Radio size={18} />}>
          <div className="stack">
            {providers.map((provider) => (
              <article className="item" key={provider.id}>
                <div>
                  <h3>{provider.name}</h3>
                  <p>{provider.notes}</p>
                  <div className="capabilities">
                    {provider.capabilities.map((cap) => <Pill key={cap.id} tone={cap.planned ? 'muted' : 'cyan'}>{cap.label}</Pill>)}
                  </div>
                </div>
                <Pill tone={provider.status === 'preferred' ? 'gold' : 'muted'}>{provider.status}</Pill>
              </article>
            ))}
          </div>
        </Panel>

        <Panel title="Devices" icon={<Monitor size={18} />}>
          <div className="stack">
            {devices.map((device) => (
              <article className="item" key={device.id}>
                <div>
                  <h3>{device.name}</h3>
                  <p>{device.description}</p>
                </div>
                <Pill tone={device.status === 'this-device' ? 'gold' : 'muted'}>{device.platform}</Pill>
              </article>
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid three">
        <Panel title="Agent" icon={<Bot size={18} />}>
          <article className="item vertical">
            <h3>{reika.name}</h3>
            <p>{reika.role}</p>
            <Pill>{reika.providerId}</Pill>
          </article>
        </Panel>

        <Panel title="Chat" icon={<Activity size={18} />}>
          <h3>{conversations[0].title}</h3>
          <div className="chat-log">
            {messages.map((message) => (
              <p className={`message ${message.role}`} key={message.id}><strong>{message.speaker}:</strong> {message.text}</p>
            ))}
          </div>
        </Panel>

        <Panel title="Settings" icon={<Settings size={18} />}>
          <div className="stack compact">
            <p><strong>Theme:</strong> {settings.theme}</p>
            <p><strong>Connections:</strong> {String(settings.externalConnectionsEnabled)}</p>
            <p><strong>Priority:</strong> {settings.preferredProviderOrder.join(' → ')}</p>
          </div>
        </Panel>
      </section>

      <section className="grid three">
        <Panel title="Notifications" icon={<Bell size={18} />}>
          <div className="stack compact">
            {notifications.map((note) => <p key={note.id}><strong>{note.title}:</strong> {note.body}</p>)}
          </div>
        </Panel>
        <Panel title="Assets" icon={<Sparkles size={18} />}>
          <div className="stack compact">
            {assets.map((asset) => <p key={asset.id}><strong>{asset.label}</strong> — {asset.status}</p>)}
          </div>
        </Panel>
        <Panel title="Architecture Lock" icon={<Database size={18} />}>
          <div className="stack compact">
            {settings.notes.map((note) => <p key={note}>{note}</p>)}
          </div>
        </Panel>
      </section>

      <footer>
        <Cpu size={16} /> Built for Linux first. Reika first. No network gremlins yet.
      </footer>
    </main>
  );
}
