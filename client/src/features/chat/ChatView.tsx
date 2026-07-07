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
  type ReikaAgentSelectorSettings,
  type ReikaProviderRecord,
  type ReikaSessionSummary,
  type ReikaStateResponse
} from "../../lib/reikaApi";
import type { AgentChatRequestPayload, AgentChatResponsePayload } from "../../shared/protocol";
import { artRerollSlot, makeArtRuntimeSeed, type ArtAgentLike, type ArtRuntime } from "../../lib/artRuntime";
import { cx, motionDelay, pageMotionClass } from "../../lib/motion";
import { StatusDot } from "../../components/status";
import { statusLabels } from "../../app/constants";
import { formatClock, getReikaDeviceName, mapProviderStatus, mapReikaMessage, providerCanChat } from "../../domain/reikaMappers";
import type { Agent, ChatMessage } from "../../types";

export function ChatView({
  agent,
  initialState,
  relayProviders = [],
  onRelayChat,
  selectorSettings,
  artRuntime,
  onBack
}: {
  agent: Agent;
  initialState: ReikaStateResponse | null;
  relayProviders?: ReikaProviderRecord[];
  onRelayChat: (deviceId: string, payload: AgentChatRequestPayload) => Promise<AgentChatResponsePayload>;
  selectorSettings: ReikaAgentSelectorSettings;
  artRuntime: ArtRuntime;
  onBack: () => void;
}) {
  const [serverState, setServerState] = useState<ReikaStateResponse | null>(initialState);
  const [providers, setProviders] = useState<ReikaProviderRecord[]>(initialState?.providers ?? []);
  const [selectedProviderId, setSelectedProviderId] = useState(initialState?.activeProviderId ?? "");
  const [selectedAgentKey, setSelectedAgentKey] = useState(agent.id);
  const [sessions, setSessions] = useState<ReikaSessionSummary[]>([]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [relaySessionId, setRelaySessionId] = useState<string | null>(null);
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
  const artInstanceKey = useMemo(() => makeArtRuntimeSeed(), []);

  const availableProviders = useMemo(() => {
    const localDeviceId = String(serverState?.device.id ?? serverState?.device.deviceId ?? "").trim();
    const localProviderIds = new Set(providers.map((provider) => provider.id));
    const merged = [...providers];
    for (const provider of relayProviders) {
      if (provider.kind === "mock" && serverState?.settings?.mockEnabled === false) continue;
      if (provider.relayDeviceId && localDeviceId && provider.relayDeviceId === localDeviceId && localProviderIds.has(getRelayProviderId(provider))) continue;
      if (!merged.some((item) => item.id === provider.id)) merged.push(provider);
    }
    return merged;
  }, [providers, relayProviders, serverState?.device.deviceId, serverState?.device.id, serverState?.settings?.mockEnabled]);
  const requestedAgentProvider = useMemo(
    () => availableProviders.find((provider) => provider.agents.some((item) => agentMatches(item, agent.id, agent.name))),
    [agent.id, agent.name, availableProviders]
  );
  const selectedProvider = useMemo(
    () => {
      const selectedById = availableProviders.find((provider) => provider.id === selectedProviderId);
      const selectedOwnsRequestedAgent = selectedById?.agents.some((item) => agentMatches(item, selectedAgentKey, agent.name) || agentMatches(item, agent.id, agent.name));
      if (selectedById && (selectedOwnsRequestedAgent || !requestedAgentProvider)) return selectedById;
      return requestedAgentProvider ?? selectedById ?? availableProviders.find((provider) => provider.status === "preferred") ?? availableProviders[0];
    },
    [agent.id, agent.name, availableProviders, requestedAgentProvider, selectedAgentKey, selectedProviderId]
  );
  const providerAgents = selectedProvider?.agents ?? [];
  const selectedProviderStatus = mapProviderStatus(selectedProvider?.status);
  const selectedProviderCanChat = providerCanChat(selectedProvider);
  const selectedLiveAgent = providerAgents.find((item) => item.id === selectedAgentKey || item.name === selectedAgentKey) ?? providerAgents[0];
  const selectableAgents = useMemo(
    () => collapseDuplicateAgentOptions(
      availableProviders.flatMap((provider) =>
        provider.agents.map((item) => ({
          key: makeAgentOptionKey(provider.id, item.id),
          provider,
          agent: item,
          label: formatAgentOptionLabel(item, provider, selectorSettings.labelMode)
        }))
      ),
      selectorSettings
    ),
    [availableProviders, selectorSettings]
  );
  const selectedAgentOptionKey = selectedProvider && selectedLiveAgent ? makeAgentOptionKey(selectedProvider.id, selectedLiveAgent.id) : "";
  const selectedRelayDeviceId = getRelayDeviceId(selectedProvider, selectedLiveAgent);
  const selectedIsRelayProvider = Boolean(selectedRelayDeviceId);
  const relayConversationKey =
    selectedIsRelayProvider && selectedRelayDeviceId && selectedProvider && selectedLiveAgent
      ? makeRelayConversationKey(selectedRelayDeviceId, getRelayProviderId(selectedProvider), getRelayAgentId(selectedLiveAgent) ?? selectedLiveAgent.id)
      : null;
  const headerAgentName = selectedLiveAgent?.name ?? agent.name;
  const providerLabel = selectedProvider?.name ?? "Reika Server";
  const deviceName = selectedIsRelayProvider ? String(selectedLiveAgent?.source ?? selectedRelayDeviceId ?? "Relay Device") : getReikaDeviceName(serverState) || "Epic PC";
  const selectedAttachments = files.filter((file) => selectedFileIds.includes(file.id));
  const artAgent: ArtAgentLike = {
    id: selectedLiveAgent?.id ?? selectedAgentKey ?? agent.id,
    name: headerAgentName,
    characterId: selectedLiveAgent?.characterId ?? agent.characterId
  };
  const chatAvatar = artRuntime.agentPortrait(artAgent, artRerollSlot("chat-portrait", artInstanceKey));
  const chatPortraitArt = artRuntime.agentArt(artAgent, "portrait-chat", assets.reika.halfBody, artRerollSlot("chat-profile-portrait", artInstanceKey));

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
      setSelectedProviderId((current) => current || state.activeProviderId || state.providers[0]?.id || relayProviders[0]?.id || "");
      setStatus(`${state.providers.length} providers detected`);
      setStateError(null);
    } catch (loadError) {
      setStatus("Reika server offline");
      setStateError(normalizeChatError(loadError, "Could not reach the local Reika server at `/agent`."));
    }
  };

  const loadSessionRows = async (query = sessionSearch, providerId = selectedProvider?.id, agentId = selectedLiveAgent?.id) => {
    if (selectedIsRelayProvider) {
      setSessions([]);
      setSessionListError(null);
      return;
    }
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
    setSelectedProviderId((current) => current || initialState.activeProviderId || initialState.providers[0]?.id || relayProviders[0]?.id || "");
  }, [initialState, relayProviders]);

  useEffect(() => {
    setSelectedAgentKey(agent.id);
    setSelectedSessionId(null);
    setRelaySessionId(null);
    setMessages([]);
    setSendError(null);
  }, [agent.id]);

  useEffect(() => {
    if (!requestedAgentProvider) return;
    setSelectedProviderId((current) => (current === requestedAgentProvider.id ? current : requestedAgentProvider.id));
    const requestedAgent = requestedAgentProvider.agents.find((item) => agentMatches(item, agent.id, agent.name));
    if (requestedAgent) setSelectedAgentKey(requestedAgent.id);
  }, [agent.id, agent.name, requestedAgentProvider]);

  useEffect(() => {
    if (selectedProviderId || availableProviders.length === 0) return;
    setSelectedProviderId(availableProviders.find((provider) => provider.agents.some((item) => item.id === agent.id || item.name === agent.name))?.id ?? availableProviders[0].id);
  }, [agent.id, agent.name, availableProviders, selectedProviderId]);

  useEffect(() => {
    if (!selectedProvider) return;
    if (!providerAgents.some((item) => item.id === selectedAgentKey || item.name === selectedAgentKey)) {
      setSelectedAgentKey(providerAgents[0]?.id ?? "reika");
    }
  }, [providerAgents, selectedAgentKey, selectedProvider]);

  useEffect(() => {
    if (selectableAgents.length === 0 || !selectedAgentOptionKey) return;
    if (selectableAgents.some((item) => item.key === selectedAgentOptionKey)) return;
    const next = selectableAgents.find((item) => agentNamesMatch(item.agent, selectedLiveAgent)) ?? selectableAgents[0];
    if (!next) return;
    setSelectedProviderId(next.provider.id);
    setSelectedAgentKey(next.agent.id);
    setSelectedSessionId(null);
    setRelaySessionId(null);
    setMessages([]);
    setSendError(null);
  }, [selectableAgents, selectedAgentOptionKey, selectedLiveAgent]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSessionRows();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [sessionSearch, selectedProvider?.id, selectedLiveAgent?.id]);

  useEffect(() => {
    if (!selectedSessionId) {
      if (selectedIsRelayProvider) return;
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
  }, [selectedIsRelayProvider, selectedSessionId]);

  useEffect(() => {
    if (!relayConversationKey) return;
    const stored = readRelayConversation(relayConversationKey);
    setRelaySessionId(stored.sessionId);
    setMessages(stored.messages);
    setSendError(null);
  }, [relayConversationKey]);

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
    if (selectedIsRelayProvider) {
      setRelaySessionId(null);
      setMessages([]);
      setSendError(null);
      if (relayConversationKey) writeRelayConversation(relayConversationKey, null, []);
      return;
    }
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
    const userMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      sender: "user",
      body: message,
      time: formatClock(new Date().toISOString())
    };
    setMessages((current) => {
      const next = [...current, userMessage];
      if (relayConversationKey) writeRelayConversation(relayConversationKey, relaySessionId, next);
      return next;
    });
    try {
      if (selectedIsRelayProvider && selectedProvider && selectedRelayDeviceId) {
        const result = await onRelayChat(selectedRelayDeviceId, {
          providerId: getRelayProviderId(selectedProvider),
          agent: getRelayAgentId(selectedLiveAgent) ?? selectedAgentKey,
          sessionId: relaySessionId ?? undefined,
          message,
          fileIds: selectedFileIds
        });
        const agentMessage: ChatMessage = {
          id: `relay-${Date.now()}`,
          sender: "agent",
          body: result.text,
          time: formatClock(new Date().toISOString())
        };
        setRelaySessionId(result.sessionId);
        setMessages((current) => {
          const next = [...current, agentMessage];
          if (relayConversationKey) writeRelayConversation(relayConversationKey, result.sessionId, next);
          return next;
        });
        setStatus(`Routed through relay ${result.runtime}`);
        setFiles((current) => current.filter((file) => !selectedFileIds.includes(file.id)));
        setSelectedFileIds([]);
        setSendError(null);
        return;
      }

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

  const handleAgentChange = (optionKey: string) => {
    const selected = selectableAgents.find((item) => item.key === optionKey);
    if (!selected) return;
    setSelectedProviderId(selected.provider.id);
    setSelectedAgentKey(selected.agent.id);
    setSelectedSessionId(null);
    setRelaySessionId(null);
    setMessages([]);
    setSendError(null);
  };

  const visibleMessages = messages;
  const canSend = Boolean(draft.trim()) && !busy && Boolean(selectedProvider) && selectedProviderCanChat && selectedProviderStatus === "online" && (selectedIsRelayProvider || !stateError);

  return (
    <main className={pageMotionClass("chat-screen")}>
      <aside className="chat-profile">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={20} />
          Back
        </button>
        <img className="chat-profile-art" src={chatPortraitArt} alt="" />
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
              <span>Agent</span>
              <select value={selectedAgentOptionKey} onChange={(event) => handleAgentChange(event.target.value)}>
                {selectableAgents.length > 0 ? (
                  selectableAgents.map((item) => (
                    <option value={item.key} key={item.key}>
                      {item.label}
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
          {stateError && !selectedIsRelayProvider ? <div className="chat-error-banner">Reika server offline. {stateError}</div> : null}
          {!stateError && selectedProvider && !selectedProviderCanChat ? <div className="chat-error-banner">{selectedProvider.name} is not chat-capable yet.</div> : null}
          {!stateError && selectedProvider && selectedProviderStatus !== "online" ? <div className="chat-error-banner">{selectedProvider.name} is {statusLabels[selectedProviderStatus].toLowerCase()}.</div> : null}
          {selectedIsRelayProvider ? <div className="chat-inline-note">Relay chat active for {deviceName}.</div> : null}
          {sendError ? <div className="chat-error-banner">{sendError}</div> : null}
          <div className="message-list">
            {visibleMessages.map((message, index) => (
              <MessageBubble message={message} key={message.id} agentAvatar={chatAvatar} agentName={headerAgentName} motionIndex={index} />
            ))}
            {!busy && visibleMessages.length === 0 && !sendError && (!stateError || selectedIsRelayProvider) ? (
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
                  disabled={busy || (Boolean(stateError) && !selectedIsRelayProvider)}
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

function agentMatches(agent: { id?: string; name?: string; label?: string; relayAgentId?: string }, id?: string, name?: string) {
  const idText = String(id ?? "").trim().toLowerCase();
  const nameText = String(name ?? "").trim().toLowerCase();
  const values = [agent.id, agent.relayAgentId, agent.name, agent.label].map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean);
  return Boolean((idText && values.includes(idText)) || (nameText && values.includes(nameText)));
}

function getRelayDeviceId(provider: ReikaProviderRecord | undefined, agent: ReikaProviderRecord["agents"][number] | undefined) {
  const providerRecord = provider as (ReikaProviderRecord & { relayDeviceId?: unknown }) | undefined;
  if (typeof providerRecord?.relayDeviceId === "string" && providerRecord.relayDeviceId) return providerRecord.relayDeviceId;
  const agentRecord = agent as (ReikaProviderRecord["agents"][number] & { deviceId?: unknown }) | undefined;
  if (typeof agentRecord?.deviceId === "string" && agentRecord.deviceId) return agentRecord.deviceId;
  return undefined;
}

function getRelayProviderId(provider: ReikaProviderRecord) {
  return typeof provider.relayProviderId === "string" && provider.relayProviderId ? provider.relayProviderId : provider.id;
}

function getRelayAgentId(agent: ReikaProviderRecord["agents"][number] | undefined) {
  if (!agent) return undefined;
  return typeof agent.relayAgentId === "string" && agent.relayAgentId ? agent.relayAgentId : agent.id;
}

function makeAgentOptionKey(providerId: string, agentId: string) {
  return `${providerId}::${agentId}`;
}

function makeRelayConversationKey(deviceId: string, providerId: string, agentId: string) {
  return `agenthub:relay-chat:${deviceId}:${providerId}:${agentId}`;
}

function readRelayConversation(key: string): { sessionId: string | null; messages: ChatMessage[] } {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { sessionId: null, messages: [] };
    const parsed = JSON.parse(raw) as { sessionId?: unknown; messages?: unknown };
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
          .filter((message): message is ChatMessage => {
            const candidate = message as Partial<ChatMessage>;
            return typeof candidate.id === "string" && (candidate.sender === "user" || candidate.sender === "agent") && typeof candidate.body === "string" && typeof candidate.time === "string";
          })
          .slice(-200)
      : [];
    return {
      sessionId: typeof parsed.sessionId === "string" && parsed.sessionId ? parsed.sessionId : null,
      messages
    };
  } catch {
    return { sessionId: null, messages: [] };
  }
}

function writeRelayConversation(key: string, sessionId: string | null, messages: ChatMessage[]) {
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        sessionId,
        messages: messages.slice(-200)
      })
    );
  } catch {
    // Local persistence is best-effort; chat should keep working in memory.
  }
}

type SelectableAgentOption = {
  key: string;
  provider: ReikaProviderRecord;
  agent: ReikaProviderRecord["agents"][number];
  label: string;
};

function collapseDuplicateAgentOptions(options: SelectableAgentOption[], settings: ReikaAgentSelectorSettings) {
  if (!settings.hideCommandCenterDuplicates) return options;

  const groups = new Map<string, SelectableAgentOption[]>();
  for (const option of options) {
    const key = `${normalizeAgentName(option.agent)}::${getOptionServerKey(option)}`;
    groups.set(key, [...(groups.get(key) ?? []), option]);
  }

  const hidden = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const commandCenterOptions = group.filter((option) => isCommandCenterProvider(option.provider));
    const agentProviderOptions = group.filter((option) => !isCommandCenterProvider(option.provider));
    if (commandCenterOptions.length === 0 || agentProviderOptions.length === 0) continue;

    const toHide = settings.duplicatePreference === "commandcenter" ? agentProviderOptions : commandCenterOptions;
    for (const option of toHide) hidden.add(option.key);
  }

  return options.filter((option) => !hidden.has(option.key));
}

function formatAgentOptionLabel(agent: ReikaProviderRecord["agents"][number], provider: ReikaProviderRecord, mode: ReikaAgentSelectorSettings["labelMode"]) {
  const agentName = String(agent.name || agent.label || agent.id || "Agent");
  if (mode === "agent-only") return agentName;
  if (mode === "agent-device") return `${agentName} - ${getProviderDeviceLabel(provider, agent)}`;
  return `${agentName} - ${formatProviderLabel(provider.name)}`;
}

function formatProviderLabel(name: string) {
  return name.replace(/\s+\((.+)\)$/u, " / $1");
}

function getProviderDeviceLabel(provider: ReikaProviderRecord, agent: ReikaProviderRecord["agents"][number]) {
  const match = provider.name.match(/\((.+)\)$/u);
  if (match?.[1]) return match[1];
  const relayDeviceId = getRelayDeviceId(provider, agent);
  if (relayDeviceId) return relayDeviceId;
  if (typeof agent.source === "string" && agent.source.trim()) return agent.source.trim();
  return "Local";
}

function getOptionServerKey(option: SelectableAgentOption) {
  const relayDeviceId = getRelayDeviceId(option.provider, option.agent);
  if (relayDeviceId) return relayDeviceId.toLowerCase();
  const deviceLabel = getProviderDeviceLabel(option.provider, option.agent);
  return deviceLabel.toLowerCase();
}

function normalizeAgentName(agent: ReikaProviderRecord["agents"][number] | undefined) {
  return String(agent?.name || agent?.label || agent?.id || "").trim().toLowerCase();
}

function agentNamesMatch(left: ReikaProviderRecord["agents"][number] | undefined, right: ReikaProviderRecord["agents"][number] | undefined) {
  const leftName = normalizeAgentName(left);
  const rightName = normalizeAgentName(right);
  return Boolean(leftName && rightName && leftName === rightName);
}

function isCommandCenterProvider(provider: ReikaProviderRecord) {
  return provider.kind === "commandcenter" || /command\s*center/i.test(provider.name);
}
