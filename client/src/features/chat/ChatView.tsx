import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Activity, ArrowLeft, Heart, Link2, MessageCircle, Plus, Search, Send, Trash2 } from "lucide-react";
import { assets } from "../../data/assets";
import {
  chat,
  createSession,
  getSessionMessages,
  getState,
  linkFile,
  listSessions,
  postSessionMessage,
  refreshProviders,
  searchSessions,
  uploadFiles,
  type ReikaFileItem,
  type ReikaProviderRecord,
  type ReikaSessionSummary,
  type ReikaStateResponse
} from "../../lib/reikaApi";
import type { ArtAgentLike, ArtRuntime } from "../../lib/artRuntime";
import { cx, motionDelay, pageMotionClass } from "../../lib/motion";
import { StatusDot } from "../../components/status";
import { statusLabels } from "../../app/constants";
import { formatClock, getReikaDeviceName, mapProviderStatus, mapReikaMessage, providerCanChat } from "../../domain/reikaMappers";
import type { Agent, ChatMessage } from "../../types";

export function ChatView({ agent, initialState, artRuntime, onBack }: { agent: Agent; initialState: ReikaStateResponse | null; artRuntime: ArtRuntime; onBack: () => void }) {
  const [serverState, setServerState] = useState<ReikaStateResponse | null>(initialState);
  const [providers, setProviders] = useState<ReikaProviderRecord[]>(initialState?.providers ?? []);
  const [selectedProviderId, setSelectedProviderId] = useState(initialState?.activeProviderId ?? "");
  const [selectedAgentKey, setSelectedAgentKey] = useState(agent.id);
  const [sessions, setSessions] = useState<ReikaSessionSummary[]>([]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<ReikaFileItem[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Connecting to Reika server...");
  const [stateError, setStateError] = useState<string | null>(null);
  const [sessionListError, setSessionListError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? providers.find((provider) => provider.status === "preferred") ?? providers[0],
    [providers, selectedProviderId]
  );
  const providerAgents = selectedProvider?.agents ?? [];
  const selectedProviderStatus = mapProviderStatus(selectedProvider?.status);
  const selectedProviderCanChat = providerCanChat(selectedProvider);
  const selectedLiveAgent = providerAgents.find((item) => item.id === selectedAgentKey || item.name === selectedAgentKey) ?? providerAgents[0];
  const headerAgentName = selectedLiveAgent?.name ?? agent.name;
  const providerLabel = selectedProvider?.name ?? "Reika Server";
  const deviceName = getReikaDeviceName(serverState) || "Epic PC";
  const selectedAttachments = files.filter((file) => selectedFileIds.includes(file.id));
  const artAgent: ArtAgentLike = {
    id: selectedLiveAgent?.id ?? selectedAgentKey ?? agent.id,
    name: headerAgentName,
    characterId: selectedLiveAgent?.characterId ?? agent.characterId
  };
  const chatAvatar = artRuntime.agentPortrait(artAgent, "chat-portrait");
  const chatSplash = artRuntime.agentArt(artAgent, "splash-full-body", assets.reika.splash, "chat-profile-splash");

  const normalizeChatError = (value: unknown, fallback = "Something went wrong.") => {
    const raw = value instanceof Error ? value.message : String(value || fallback);
    if (/^(fetch failed|failed to fetch)$/i.test(raw.trim())) return "Could not reach the local Reika server at `/agent`.";
    return raw || fallback;
  };

  const loadLiveState = async () => {
    try {
      const state = await getState();
      setServerState(state);
      setProviders(state.providers);
      setSelectedProviderId((current) => current || state.activeProviderId || state.providers[0]?.id || "");
      setStatus(`${state.providers.length} providers detected`);
      setStateError(null);
    } catch (loadError) {
      setStatus("Reika server offline");
      setStateError(normalizeChatError(loadError, "Could not reach the local Reika server at `/agent`."));
    }
  };

  const loadSessionRows = async (query = sessionSearch, providerId = selectedProvider?.id, agentId = selectedLiveAgent?.id) => {
    try {
      if (query.trim()) {
        const result = await searchSessions({ q: query.trim(), limit: 30, providerId, agent: agentId });
        setSessions(result.results);
      } else {
        const result = await listSessions({ limit: 30, providerId, agent: agentId });
        setSessions(result.sessions);
      }
      setSessionListError(null);
    } catch (loadError) {
      setSessionListError(normalizeChatError(loadError, "Could not load sessions."));
    }
  };

  useEffect(() => {
    void loadLiveState();
  }, []);

  useEffect(() => {
    if (!initialState) return;
    setServerState(initialState);
    setProviders(initialState.providers);
    setSelectedProviderId((current) => current || initialState.activeProviderId || initialState.providers[0]?.id || "");
  }, [initialState]);

  useEffect(() => {
    if (!selectedProvider) return;
    if (!providerAgents.some((item) => item.id === selectedAgentKey || item.name === selectedAgentKey)) {
      setSelectedAgentKey(providerAgents[0]?.id ?? "reika");
    }
  }, [providerAgents, selectedAgentKey, selectedProvider]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSessionRows();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [sessionSearch, selectedProvider?.id, selectedLiveAgent?.id]);

  useEffect(() => {
    if (!selectedSessionId) {
      setMessages([]);
      return;
    }
    getSessionMessages(selectedSessionId)
      .then((result) => {
        setMessages(result.messages.map(mapReikaMessage));
        setSendError(null);
      })
      .catch((loadError) => {
        setSendError(normalizeChatError(loadError, "Could not load that conversation."));
      });
  }, [selectedSessionId]);

  const handleRefreshProviders = async () => {
    setBusy(true);
    try {
      const state = await refreshProviders();
      setServerState(state);
      setProviders(state.providers);
      setSelectedProviderId(state.activeProviderId || state.providers[0]?.id || "");
      setStatus("Provider scan complete");
      setStateError(null);
      setSendError(null);
    } catch (refreshError) {
      setSendError(normalizeChatError(refreshError, "Provider refresh failed."));
    } finally {
      setBusy(false);
    }
  };

  const handleNewSession = async () => {
    if (!selectedProvider) return;
    setBusy(true);
    try {
      const created = await createSession({
        providerId: selectedProvider.id,
        agent: selectedLiveAgent?.id ?? selectedAgentKey,
        title: `${selectedLiveAgent?.name ?? headerAgentName} session`
      });
      setSelectedSessionId(created.session.id);
      setMessages([]);
      await loadSessionRows();
      setSendError(null);
    } catch (createError) {
      setSendError(normalizeChatError(createError, "Could not create a new session."));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setDraft("");
    setMessages((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        sender: "user",
        body: message,
        time: formatClock(new Date().toISOString())
      }
    ]);
    try {
      const result = selectedSessionId
        ? await postSessionMessage(selectedSessionId, { message, fileIds: selectedFileIds })
        : await chat({
            providerId: selectedProvider?.id,
            agent: selectedLiveAgent?.id ?? selectedAgentKey,
            message,
            fileIds: selectedFileIds
          });
      setSelectedSessionId(result.session.id);
      const refreshed = await getSessionMessages(result.session.id);
      setMessages(refreshed.messages.map(mapReikaMessage));
      await loadSessionRows("", selectedProvider?.id, selectedLiveAgent?.id);
      setStatus(`Routed through ${result.result.runtime}`);
      setFiles((current) => current.filter((file) => !selectedFileIds.includes(file.id)));
      setSelectedFileIds([]);
      setSendError(null);
    } catch (sendError) {
      setSendError(normalizeChatError(sendError, "Message failed."));
    } finally {
      setBusy(false);
    }
  };

  const handleAddLink = async () => {
    if (!linkUrl.trim() || busy) return;
    setBusy(true);
    try {
      const result = await linkFile({ url: linkUrl.trim(), name: linkName.trim() || undefined });
      setFiles((current) => [result.item, ...current.filter((item) => item.id !== result.item.id)]);
      setSelectedFileIds((current) => [...new Set([result.item.id, ...current])]);
      setLinkUrl("");
      setLinkName("");
      setSendError(null);
    } catch (linkError) {
      setSendError(normalizeChatError(linkError, "Could not attach that link."));
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const uploadList = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!uploadList.length || busy) return;
    setBusy(true);
    try {
      const result = await uploadFiles(uploadList);
      setFiles((current) => [...result.items, ...current.filter((item) => !result.items.some((next) => next.id === item.id))]);
      setSelectedFileIds((current) => [...new Set([...result.items.map((item) => item.id), ...current])]);
      setSendError(null);
    } catch (uploadError) {
      setSendError(normalizeChatError(uploadError, "Could not upload that file."));
    } finally {
      setBusy(false);
    }
  };

  const removeAttachment = (fileId: string) => {
    setSelectedFileIds((current) => current.filter((id) => id !== fileId));
    setFiles((current) => current.filter((file) => file.id !== fileId));
  };

  const visibleMessages = messages;
  const canSend = Boolean(draft.trim()) && !busy && Boolean(selectedProvider) && selectedProviderCanChat && selectedProviderStatus === "online" && !stateError;

  return (
    <main className={pageMotionClass("chat-screen")}>
      <aside className="chat-profile">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={20} />
          Back
        </button>
        <img className="chat-profile-art" src={chatSplash} alt="" />
        <div className="chat-profile-card live-chat-profile-card">
          <h2>
            {headerAgentName}
            <Heart size={24} fill="currentColor" />
          </h2>
          <p>{providerLabel} {"\u2022"} {deviceName}</p>
          <span>
            <StatusDot status={selectedProviderStatus} />
            {statusLabels[selectedProviderStatus]}
          </span>

          <div className="live-chat-card">
            <label>
              <span>Provider</span>
              <select value={selectedProvider?.id ?? ""} onChange={(event) => setSelectedProviderId(event.target.value)}>
                {providers.length > 0 ? (
                  providers.map((provider) => (
                    <option value={provider.id} key={provider.id}>
                      {provider.name} ({provider.status})
                    </option>
                  ))
                ) : (
                  <option value="">Server offline</option>
                )}
              </select>
            </label>
            <label>
              <span>Agent</span>
              <select value={selectedLiveAgent?.id ?? selectedAgentKey} onChange={(event) => setSelectedAgentKey(event.target.value)}>
                {providerAgents.length > 0 ? (
                  providerAgents.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name || item.label || item.id}
                    </option>
                  ))
                ) : (
                  <option value="reika">Reika</option>
                )}
              </select>
            </label>
            <div className="chat-session-tools">
              <button onClick={handleNewSession} disabled={!selectedProvider || busy}>
                <Plus size={16} />
                New
              </button>
              <button onClick={() => void handleRefreshProviders()} disabled={busy}>
                <Activity size={16} />
                Refresh
              </button>
            </div>
          </div>

          <div className="chat-session-card">
            <header>
              <strong>Sessions</strong>
              <small>{sessions.length}</small>
            </header>
            <label className="mini-search-field">
              <Search size={15} />
              <input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder="Search sessions..." />
            </label>
            <div className="chat-session-list">
              {sessionListError ? <small className="chat-inline-error">{sessionListError}</small> : null}
              {sessions.length > 0 ? (
                sessions.map((session) => (
                  <button
                    className={session.id === selectedSessionId ? "selected" : ""}
                    key={session.id}
                    onClick={() => setSelectedSessionId(session.id)}
                  >
                    <strong>{session.title}</strong>
                    <small>{session.lastMessagePreview || `${session.messageCount} messages`}</small>
                  </button>
                ))
              ) : (
                <small>No sessions yet</small>
              )}
            </div>
          </div>
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-header">
          <img src={chatAvatar} alt="" />
          <div>
            <h1>
              {headerAgentName}
              <Heart size={26} fill="currentColor" />
            </h1>
            <p>
              {providerLabel} {"\u2022"} {deviceName}
              <StatusDot status={selectedProviderStatus} />
              {statusLabels[selectedProviderStatus]}
            </p>
          </div>
          <button className="icon-button" onClick={() => void handleRefreshProviders()} disabled={busy} aria-label="Refresh providers">
            <Activity size={22} />
          </button>
        </header>

        <section className="conversation-panel">
          <div className="day-divider">
            <span />
            {status}
            <span />
          </div>
          {stateError ? <div className="chat-error-banner">Reika server offline. {stateError}</div> : null}
          {!stateError && selectedProvider && !selectedProviderCanChat ? <div className="chat-error-banner">{selectedProvider.name} is not chat-capable yet.</div> : null}
          {!stateError && selectedProvider && selectedProviderStatus !== "online" ? <div className="chat-error-banner">{selectedProvider.name} is {statusLabels[selectedProviderStatus].toLowerCase()}.</div> : null}
          {sendError ? <div className="chat-error-banner">{sendError}</div> : null}
          <div className="message-list">
            {visibleMessages.map((message, index) => (
              <MessageBubble message={message} key={message.id} agentAvatar={chatAvatar} agentName={headerAgentName} motionIndex={index} />
            ))}
            {!busy && visibleMessages.length === 0 && !sendError && !stateError ? (
              <div className="chat-empty-state">
                <MessageCircle size={22} />
                <span>No messages yet. Start a new conversation when you are ready.</span>
              </div>
            ) : null}
            {busy ? (
              <div className="typing-row">
                <img src={chatAvatar} alt="" />
                <span>{headerAgentName} is thinking</span>
                <i />
                <i />
                <i />
              </div>
            ) : null}
          </div>

          <form className="chat-composer" onSubmit={handleSubmit}>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Message ${headerAgentName}...`} />
            {selectedAttachments.length > 0 ? (
              <div className="selected-attachment-chips">
                {selectedAttachments.map((file) => (
                  <button type="button" className="attachment-chip" key={file.id} onClick={() => removeAttachment(file.id)}>
                    {file.kind === "link" ? <Link2 size={14} /> : <Plus size={14} />}
                    <span>{file.name}</span>
                    <Trash2 size={13} />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="composer-tools">
              <div className="composer-attachment-wrap">
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Attach file or link"
                  onClick={() => setAttachmentMenuOpen((current) => !current)}
                  disabled={busy || Boolean(stateError)}
                >
                  <Link2 size={21} />
                </button>
                {attachmentMenuOpen ? (
                  <div className="attachment-popover">
                    <label className="attachment-upload-button">
                      <Plus size={15} />
                      Upload File
                      <input type="file" multiple onChange={handleUpload} />
                    </label>
                    <div className="attachment-link-fields">
                      <input value={linkName} onChange={(event) => setLinkName(event.target.value)} placeholder="Name" />
                      <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://..." />
                      <button type="button" onClick={handleAddLink} disabled={!linkUrl.trim() || busy}>
                        <Link2 size={15} />
                        Add Link
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <button className="send-button" type="submit" aria-label="Send" disabled={!canSend}>
              <Send size={24} />
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}

function MessageBubble({ message, agentAvatar, agentName = "Reika", motionIndex = 0 }: { message: ChatMessage; agentAvatar?: string; agentName?: string; motionIndex?: number }) {
  if (message.sender === "system") return null;
  const isUser = message.sender === "user";
  const avatar = agentAvatar ?? assets.reika.avatar;

  return (
    <article className={cx("chat-message motion-message", isUser ? "user" : "agent")} style={motionDelay(Math.min(motionIndex, 8), 28)}>
      {!isUser ? <img src={avatar} alt="" /> : null}
      <div className="message-content">
        {!isUser ? (
          <header>
            <strong>{agentName}</strong>
            <time>{message.time}</time>
          </header>
        ) : null}
        <p>{message.body}</p>
        {!isUser ? (
          <button className="reaction-pill" aria-label="Heart reaction">
            <Heart size={14} fill="currentColor" />
          </button>
        ) : (
          <time>{message.time}</time>
        )}
      </div>
    </article>
  );
}
