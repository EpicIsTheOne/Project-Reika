import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Activity, ArrowDown, ArrowLeft, ArrowUp, Check, Copy, Download, Heart, Link2, MessageCircle, Mic, MicOff, PanelLeft, Pause, Phone, PhoneOff, Play, Plus, Search, Send, Square, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { assets } from "../../data/assets";
import {
  appendRelayChatMessages,
  createRelayChatSession,
  getRelayChatMessages,
  listRelayChatSessions,
  sendRelayVoice
} from "../../data/relay";
import {
  createSession,
  getSessionMessages,
  getState,
  linkFile,
  listSessions,
  refreshProviders,
  searchSessions,
  streamChat,
  uploadFiles,
  type ReikaFileItem,
  type ReikaAgentSelectorSettings,
  type ReikaProviderRecord,
  type ReikaSettings,
  type ReikaSessionSummary,
  type ReikaStateResponse
} from "../../lib/reikaApi";
import type { AgentChatRequestPayload, AgentChatResponsePayload } from "../../shared/protocol";
import { artRerollSlot, makeArtRuntimeSeed, type ArtAgentLike, type ArtRenderAsset, type ArtRuntime } from "../../lib/artRuntime";
import { cx, motionDelay, pageMotionClass } from "../../lib/motion";
import { StatusDot } from "../../components/status";
import { statusLabels } from "../../app/constants";
import { formatClock, getReikaDeviceName, mapProviderStatus, mapReikaMessage, providerCanChat } from "../../domain/reikaMappers";
import type { Agent, ChatMessage } from "../../types";
import { agentVoiceContext, resolveAgentVoice, shouldSpeakAgentReply, speechPlayback, type PlaybackState } from "../../lib/voicePlayback";

interface ActiveVadCapture {
  recorder: MediaRecorder;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  frame: number;
  chunks: Blob[];
  uploadOnStop: boolean;
}

export function ChatView({
  agent,
  initialState,
  relayUrl,
  relayProviders = [],
  onRelayChat,
  selectorSettings,
  settings,
  developerDiagnostics,
  artRuntime,
  onBack
}: {
  agent: Agent;
  initialState: ReikaStateResponse | null;
  relayUrl?: string;
  relayProviders?: ReikaProviderRecord[];
  onRelayChat: (deviceId: string, payload: AgentChatRequestPayload) => Promise<AgentChatResponsePayload>;
  selectorSettings: ReikaAgentSelectorSettings;
  settings: ReikaSettings;
  developerDiagnostics: boolean;
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<ReikaFileItem[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const [busy, setBusy] = useState(false);
  const [delegationActivity, setDelegationActivity] = useState<Array<Record<string, unknown>>>([]);
  const [status, setStatus] = useState("Connecting to Reika server...");
  const [stateError, setStateError] = useState<string | null>(null);
  const [sessionListError, setSessionListError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [agentSelectionDirty, setAgentSelectionDirty] = useState(false);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false);
  const [conversationSearch, setConversationSearch] = useState("");
  const [activeConversationMatch, setActiveConversationMatch] = useState(0);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>(() => speechPlayback.snapshot());
  const [callOpen, setCallOpen] = useState(false);
  const [callMuted, setCallMuted] = useState(false);
  const [callState, setCallState] = useState<"idle" | "listening" | "processing" | "speaking" | "muted" | "reconnecting" | "offline" | "error">("idle");
  const [callTranscript, setCallTranscript] = useState("");
  const vadCaptureRef = useRef<ActiveVadCapture | null>(null);
  const callAudioContextRef = useRef<AudioContext | null>(null);
  const transcriptionRequestRef = useRef<string | null>(null);
  const callActiveRef = useRef(false);
  const callMutedRef = useRef(false);
  const providerSessionIdRef = useRef<string | undefined>(undefined);
  const suppressedRelaySessionLoadRef = useRef<string | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);
  const artInstanceKey = useMemo(() => makeArtRuntimeSeed(), []);
  const requestedAgentRouteKey = [agent.id, agent.providerId, agent.deviceId, agent.relayProviderId ?? "", agent.relayAgentId ?? ""].join("::");

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
    () => {
      const relayProvider = availableProviders.find((provider) => providerMatchesRequestedRelayAgent(provider, agent));
      if (relayProvider) return relayProvider;
      return availableProviders.find((provider) => provider.agents.some((item) => agentMatches(item, agent.id, undefined)))
        ?? availableProviders.find((provider) => provider.agents.some((item) => agentMatches(item, undefined, agent.name)));
    },
    [agent.deviceId, agent.id, agent.name, agent.relayAgentId, agent.relayProviderId, availableProviders]
  );
  const requestedHasRelayIdentity = hasRequestedRelayIdentity(agent);
  const shouldUseRequestedAgentRoute = !agentSelectionDirty;
  const selectedProvider = useMemo(
    () => {
      if (shouldUseRequestedAgentRoute && requestedHasRelayIdentity && requestedAgentProvider) return requestedAgentProvider;
      const selectedById = availableProviders.find((provider) => provider.id === selectedProviderId);
      const selectedOwnsRequestedAgent = selectedById?.agents.some((item) => agentMatches(item, selectedAgentKey, agent.name) || agentMatches(item, agent.id, agent.name));
      if (selectedById && (!shouldUseRequestedAgentRoute || selectedOwnsRequestedAgent || !requestedAgentProvider)) return selectedById;
      return requestedAgentProvider ?? selectedById ?? availableProviders.find((provider) => provider.status === "preferred") ?? availableProviders[0];
    },
    [agent.id, agent.name, availableProviders, requestedAgentProvider, requestedHasRelayIdentity, selectedAgentKey, selectedProviderId, shouldUseRequestedAgentRoute]
  );
  const providerAgents = selectedProvider?.agents ?? [];
  const selectedProviderStatus = mapProviderStatus(selectedProvider?.status);
  const selectedProviderCanChat = providerCanChat(selectedProvider);
  const selectedLiveAgent =
    (shouldUseRequestedAgentRoute ? findRequestedRelayAgent(providerAgents, agent) : undefined) ??
    providerAgents.find((item) => item.id === selectedAgentKey || item.name === selectedAgentKey) ??
    providerAgents[0];
  const selectedAgentOptionKey = selectedProvider && selectedLiveAgent ? makeAgentOptionKey(selectedProvider.id, selectedLiveAgent.id) : "";
  const selectableAgents = useMemo(
    () => collapseDuplicateAgentOptions(
      availableProviders.flatMap((provider) =>
        provider.agents.map((item) => ({
          key: makeAgentOptionKey(provider.id, item.id),
          provider,
          agent: item,
          label: formatAgentOptionLabel(item, provider, selectorSettings.labelMode, selectorSettings.showRole)
        }))
      ),
      selectorSettings,
      selectedAgentOptionKey
    ),
    [availableProviders, selectedAgentOptionKey, selectorSettings]
  );
  const selectedRelayDeviceId = getRelayDeviceId(selectedProvider, selectedLiveAgent) ?? (shouldUseRequestedAgentRoute && requestedHasRelayIdentity ? agent.deviceId : undefined);
  const selectedIsRelayProvider = Boolean(selectedRelayDeviceId);
  const relayConversationKey =
    selectedIsRelayProvider && selectedRelayDeviceId && selectedProvider && selectedLiveAgent
      ? makeRelayConversationKey(
          selectedRelayDeviceId,
          (shouldUseRequestedAgentRoute ? agent.relayProviderId : undefined) ?? getRelayProviderId(selectedProvider),
          (shouldUseRequestedAgentRoute ? agent.relayAgentId : undefined) ?? getRelayAgentId(selectedLiveAgent) ?? selectedLiveAgent.id
        )
      : null;
  const relayProviderId = (shouldUseRequestedAgentRoute && requestedHasRelayIdentity ? agent.relayProviderId : undefined) ?? (selectedProvider ? getRelayProviderId(selectedProvider) : "");
  const relayAgentId =
    (shouldUseRequestedAgentRoute && requestedHasRelayIdentity ? agent.relayAgentId : undefined) ?? getRelayAgentId(selectedLiveAgent) ?? selectedLiveAgent?.id ?? selectedAgentKey;
  const relayRouteSummary =
    selectedIsRelayProvider && selectedRelayDeviceId
      ? `${selectedRelayDeviceId} / ${relayProviderId || "provider?"} / ${relayAgentId || "agent?"}${selectedSessionId ? ` / ${selectedSessionId}` : ""}`
      : "";
  const relayRouteReady = Boolean(selectedIsRelayProvider && selectedRelayDeviceId && relayProviderId && relayAgentId);
  const headerAgentName = selectedLiveAgent?.name ?? agent.name;
  const displayAgentName = formatAgentDisplayName(headerAgentName, selectedLiveAgent?.role ?? agent.role, selectorSettings.showRole);
  const providerLabel = selectedProvider?.name ?? "Reika Server";
  const deviceName = selectedIsRelayProvider ? String(selectedLiveAgent?.source ?? selectedRelayDeviceId ?? "Relay Device") : getReikaDeviceName(serverState) || "Epic PC";
  const showAgentContext = selectorSettings.labelMode !== "agent-only";
  const selectedAttachments = files.filter((file) => selectedFileIds.includes(file.id));
  const artAgent: ArtAgentLike = {
    id: selectedLiveAgent?.id ?? selectedAgentKey ?? agent.id,
    name: headerAgentName,
    characterId: selectedLiveAgent?.characterId ?? agent.characterId
  };
  const chatAvatar = artRuntime.agentAvatarRender(artAgent, artRerollSlot("chat-avatar", artInstanceKey));
  const chatPortraitArt = artRuntime.agentPortraitRender(artAgent, artRerollSlot("chat-profile-portrait", artInstanceKey));
  const selectedVoiceContext = selectedProvider && selectedLiveAgent ? agentVoiceContext(selectedLiveAgent, selectedProvider.id) : undefined;
  const resolvedVoice = selectedVoiceContext ? resolveAgentVoice(selectedVoiceContext, settings) : undefined;
  const callAllowed = selectedVoiceContext ? settings.voice.agents[selectedVoiceContext.key]?.callEnabled !== false : false;

  const stopVadCapture = (upload = false) => {
    const capture = vadCaptureRef.current;
    if (!capture) return;
    vadCaptureRef.current = null;
    capture.uploadOnStop = upload;
    cancelAnimationFrame(capture.frame);
    capture.source.disconnect();
    for (const track of capture.stream.getTracks()) track.stop();
    if (capture.recorder.state !== "inactive") capture.recorder.stop();
  };

  const ensureCallAudioContext = () => {
    const existing = callAudioContextRef.current;
    if (existing && existing.state !== "closed") return existing;
    const context = new AudioContext();
    callAudioContextRef.current = context;
    void context.resume().catch(() => undefined);
    return context;
  };

  const closeCallAudioContext = () => {
    const context = callAudioContextRef.current;
    callAudioContextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
  };

  const cancelTranscription = () => {
    const requestId = transcriptionRequestRef.current;
    transcriptionRequestRef.current = null;
    if (requestId) void window.reikaDesktop?.stt.cancel(requestId);
  };

  useEffect(() => speechPlayback.subscribe(setPlayback), []);
  useEffect(() => () => {
    callActiveRef.current = false;
    stopVadCapture(false);
    closeCallAudioContext();
    cancelTranscription();
    void speechPlayback.stop();
  }, []);
  useEffect(() => { void speechPlayback.stop(); }, [selectedAgentOptionKey]);

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
      if (!selectedRelayDeviceId || !selectedProvider) {
        setSessions([]);
        setSessionListError(null);
        return;
      }
      try {
        const result = await listRelayChatSessions(
          {
            limit: 30,
            q: query.trim() || undefined,
            deviceId: selectedRelayDeviceId,
            providerId: getRelayProviderId(selectedProvider),
            agent: getRelayAgentId(selectedLiveAgent) ?? agentId
          },
          relayUrl
        );
        setSessions(result);
        setSessionListError(null);
      } catch (loadError) {
        setSessionListError(normalizeChatError(loadError, "Could not load relay sessions."));
      }
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
    setAgentSelectionDirty(false);
    setSelectedAgentKey(agent.id);
    setSelectedProviderId(agent.providerId);
    setSelectedSessionId(null);
    setMessages([]);
    setSendError(null);
  }, [requestedAgentRouteKey]);

  useEffect(() => {
    if (agentSelectionDirty) return;
    if (!requestedAgentProvider) return;
    setSelectedProviderId((current) => (current === requestedAgentProvider.id ? current : requestedAgentProvider.id));
    const requestedAgent =
      findRequestedRelayAgent(requestedAgentProvider.agents, agent) ??
      requestedAgentProvider.agents.find((item) => agentMatches(item, agent.id, agent.name));
    if (requestedAgent) setSelectedAgentKey(requestedAgent.id);
  }, [agent.id, agent.name, agent.relayAgentId, agentSelectionDirty, requestedAgentProvider]);

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
    setMessages([]);
    setSendError(null);
  }, [selectableAgents, selectedAgentOptionKey, selectedLiveAgent]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSessionRows();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [relayUrl, selectedIsRelayProvider, selectedRelayDeviceId, sessionSearch, selectedProvider?.id, selectedLiveAgent?.id]);

  useEffect(() => {
    if (!selectedIsRelayProvider) return;
    setSelectedFileIds([]);
    setAttachmentMenuOpen(false);
  }, [selectedIsRelayProvider]);

  useEffect(() => {
    if (!selectedSessionId) {
      providerSessionIdRef.current = undefined;
      setMessages([]);
      return;
    }
    if (selectedIsRelayProvider) {
      if (suppressedRelaySessionLoadRef.current === selectedSessionId) return;
      getRelayChatMessages(selectedSessionId, relayUrl)
        .then((result) => {
          providerSessionIdRef.current = [...result].reverse().map((item) => item.meta?.providerSessionId).find((value): value is string => typeof value === "string" && Boolean(value.trim()));
          setMessages(result.map(mapReikaMessage));
          setSessionListError(null);
        })
        .catch((loadError) => {
          setSessionListError(normalizeChatError(loadError, "Could not load that relay conversation."));
        });
      return;
    }
    getSessionMessages(selectedSessionId)
      .then((result) => {
        setMessages(result.messages.map(mapReikaMessage));
        setSessionListError(null);
      })
      .catch((loadError) => {
        setSessionListError(normalizeChatError(loadError, "Could not load that conversation."));
      });
  }, [relayUrl, selectedIsRelayProvider, selectedSessionId]);

  const handleRefreshProviders = async () => {
    if (selectedIsRelayProvider) {
      setStatus("Remote provider selection preserved; refresh the device from Devices.");
      return;
    }
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
      if (!selectedRelayDeviceId) return;
      setBusy(true);
      try {
        const created = await createRelayChatSession(
          {
            id: relayConversationKey ? `${relayConversationKey}:${Date.now().toString(36)}` : undefined,
            deviceId: selectedRelayDeviceId,
            providerId: relayProviderId,
            agent: relayAgentId,
            title: `${selectedLiveAgent?.name ?? headerAgentName} session`,
            metadata: { relayConversationKey }
          },
          relayUrl
        );
        setSelectedSessionId(created.id);
        setMessages([]);
        await loadSessionRows("", relayProviderId, relayAgentId);
        setSendError(null);
      } catch (createError) {
        setSendError(normalizeChatError(createError, "Could not create a relay session."));
      } finally {
        setBusy(false);
      }
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

  const speakAgentMessage = async (message: ChatMessage, force = false) => {
    if (!resolvedVoice || !selectedVoiceContext) return;
    if (!force && !shouldSpeakAgentReply(selectedVoiceContext.key, settings)) return;
    const remoteSynthesizer = relayRouteReady && selectedRelayDeviceId
      ? async ({ requestId, text }: { requestId: string; text: string }) => sendRelayVoice(selectedRelayDeviceId, {
          providerId: relayProviderId,
          agent: relayAgentId,
          text,
          requestId
        }, relayUrl)
      : undefined;
    await speechPlayback.speak({ messageId: message.id, text: message.body, voice: resolvedVoice, remoteSynthesizer, force });
  };

  const sendMessage = async (message: string, fromCall = false) => {
    if (!message || busy) return;
    await speechPlayback.stop();
    setBusy(true);
    setDraft("");
    if (fromCall && callActiveRef.current) setCallState("processing");
    const userMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      sender: "user",
      body: message,
      time: formatClock(new Date().toISOString())
    };
    setMessages((current) => {
      const next = [...current, userMessage];
      return next;
    });
    try {
      if (relayRouteReady && selectedRelayDeviceId) {
        const relaySessionId =
          selectedSessionId ??
          (
            await createRelayChatSession(
            {
              deviceId: selectedRelayDeviceId,
              providerId: relayProviderId,
              agent: relayAgentId,
              title: `${selectedLiveAgent?.name ?? headerAgentName} session`,
              metadata: { relayConversationKey }
            },
            relayUrl
            )
          ).id;
        suppressedRelaySessionLoadRef.current = relaySessionId;
        const userTimestamp = new Date().toISOString();
        await appendRelayChatMessages(
          relaySessionId,
          [{ id: userMessage.id, role: "user", text: message, timestamp: userTimestamp }],
          relayUrl
        );
        if (!selectedSessionId) setSelectedSessionId(relaySessionId);
        const result = await onRelayChat(selectedRelayDeviceId, {
          providerId: relayProviderId,
          agent: relayAgentId,
          sessionId: relaySessionId,
          providerSessionId: providerSessionIdRef.current,
          message,
          fileIds: []
        });
        const now = new Date().toISOString();
        const agentMessage: ChatMessage = {
          id: `relay-${Date.now()}`,
          sender: "agent",
          body: result.text,
          time: formatClock(now)
        };
        providerSessionIdRef.current = result.sessionId;
        setMessages((current) => {
          const next = [...current, agentMessage];
          return next;
        });
        await appendRelayChatMessages(
          relaySessionId,
          [{ id: agentMessage.id, role: "assistant", text: result.text, timestamp: now, meta: { runtime: result.runtime, providerSessionId: result.sessionId } }],
          relayUrl
        );
        await loadSessionRows("", relayProviderId, relayAgentId);
        setStatus(`Routed through relay ${result.runtime}`);
        setFiles((current) => current.filter((file) => !selectedFileIds.includes(file.id)));
        setSelectedFileIds([]);
        setSendError(null);
        if (fromCall && callActiveRef.current) setCallState("speaking");
        await speakAgentMessage(agentMessage, fromCall);
        if (fromCall && callActiveRef.current && speechPlayback.snapshot().phase === "error") setCallState("error");
        return;
      }

      let completedSessionId = selectedSessionId;
      let streamError = "";
      setDelegationActivity([]);
      await streamChat({
        providerId: selectedProvider?.id,
        agent: selectedLiveAgent?.id ?? selectedAgentKey,
        sessionId: selectedSessionId ?? undefined,
        message,
        fileIds: selectedFileIds
      }, (streamEvent) => {
        if (streamEvent.type === "delegation" && streamEvent.data && typeof streamEvent.data === "object") {
          setDelegationActivity((current) => [...current, streamEvent.data as Record<string, unknown>]);
        }
        if (streamEvent.type === "error" && streamEvent.data && typeof streamEvent.data === "object") {
          streamError = String((streamEvent.data as { error?: unknown }).error || "Message failed.");
        }
        if (streamEvent.type === "done" && streamEvent.data && typeof streamEvent.data === "object") {
          const session = (streamEvent.data as { session?: { id?: unknown } }).session;
          if (typeof session?.id === "string") completedSessionId = session.id;
        }
      }, selectedSessionId ? `/sessions/${encodeURIComponent(selectedSessionId)}/messages/stream` : "/chat/stream");
      if (streamError) throw new Error(streamError);
      if (!completedSessionId) throw new Error("Reika completed the turn without returning a session ID.");
      setSelectedSessionId(completedSessionId);
      const refreshed = await getSessionMessages(completedSessionId);
      const refreshedMessages = refreshed.messages.map(mapReikaMessage);
      setMessages(refreshedMessages);
      await loadSessionRows("", selectedProvider?.id, selectedLiveAgent?.id);
      const latestRuntime = refreshed.messages.at(-1)?.meta?.runtime;
      setStatus(`Routed through ${typeof latestRuntime === "string" ? latestRuntime : selectedProvider?.name ?? "Reika"}`);
      setFiles((current) => current.filter((file) => !selectedFileIds.includes(file.id)));
      setSelectedFileIds([]);
      setSendError(null);
      const latestAgentMessage = [...refreshedMessages].reverse().find((item) => item.sender === "agent");
      if (latestAgentMessage) {
        if (fromCall && callActiveRef.current) setCallState("speaking");
        await speakAgentMessage(latestAgentMessage, fromCall);
      }
    } catch (sendError) {
      setSendError(normalizeChatError(sendError, "Message failed."));
    } finally {
      suppressedRelaySessionLoadRef.current = null;
      setBusy(false);
      setDelegationActivity([]);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (message) void sendMessage(message);
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
    setAgentSelectionDirty(true);
    setSelectedProviderId(selected.provider.id);
    setSelectedAgentKey(selected.agent.id);
    setSelectedSessionId(null);
    setMessages([]);
    setSendError(null);
  };

  const visibleMessages = messages.slice(-500);
  const conversationMatches = useMemo(() => {
    const query = conversationSearch.trim().toLowerCase();
    if (!query) return [];
    return visibleMessages.filter((message) => message.sender !== "system" && message.body.toLowerCase().includes(query)).map((message) => message.id);
  }, [conversationSearch, visibleMessages]);

  const showConversationMatch = (nextIndex: number) => {
    if (conversationMatches.length === 0) return;
    const normalized = (nextIndex + conversationMatches.length) % conversationMatches.length;
    setActiveConversationMatch(normalized);
    document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(conversationMatches[normalized])}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const copyMessage = async (message: ChatMessage) => {
    await navigator.clipboard.writeText(message.body);
    setCopiedMessageId(message.id);
    window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1400);
  };

  const exportConversation = () => {
    const transcript = visibleMessages
      .filter((message) => message.sender !== "system")
      .map((message) => `## ${message.sender === "user" ? "You" : displayAgentName} — ${message.time}\n\n${message.body}`)
      .join("\n\n---\n\n");
    const header = `# Conversation with ${displayAgentName}\n\nExported ${new Date().toLocaleString()}\n\n`;
    const url = URL.createObjectURL(new Blob([header, transcript || "No messages yet."], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${displayAgentName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "agent"}-conversation.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const startListening = async () => {
    if (!callActiveRef.current || callMutedRef.current || vadCaptureRef.current || transcriptionRequestRef.current) return;
    if (!window.reikaDesktop?.stt || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setCallState("error");
      setCallTranscript("Secure Whisper transcription is unavailable in this desktop runtime.");
      return;
    }
    if (!navigator.onLine) {
      setCallState("offline");
      setCallTranscript("Whisper transcription is offline. Reconnect to continue the call.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!callActiveRef.current || callMutedRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((value) => MediaRecorder.isTypeSupported(value)) ?? "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);
      const context = ensureCallAudioContext();
      if (context.state === "suspended") await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const capture: ActiveVadCapture = { recorder, stream, source, frame: 0, chunks: [], uploadOnStop: false };
      vadCaptureRef.current = capture;
      let noiseFloor = 0.003;
      let calibrationFrames = 0;
      let speechFrames = 0;
      let speechStarted = false;
      let lastSpeechAt = 0;
      const startedAt = performance.now();
      recorder.ondataavailable = (event) => { if (event.data.size) capture.chunks.push(event.data); };
      recorder.onerror = () => {
        if (vadCaptureRef.current === capture) stopVadCapture(false);
        setCallState("error");
        setCallTranscript("Microphone recording failed.");
      };
      recorder.onstop = async () => {
        if (!capture.uploadOnStop || !callActiveRef.current || callMutedRef.current) return;
        try {
          const blob = new Blob(capture.chunks, { type: recorder.mimeType || "audio/webm" });
          if (blob.size < 256) throw new Error("The recorded utterance was empty.");
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = "";
          for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
          const requestId = crypto.randomUUID();
          transcriptionRequestRef.current = requestId;
          setCallState("processing");
          setCallTranscript("Transcribing with Whisper...");
          const result = await window.reikaDesktop!.stt.transcribe({ requestId, audioBase64: btoa(binary), format: recorder.mimeType.includes("ogg") ? "ogg" : "webm" });
          if (transcriptionRequestRef.current !== requestId || !callActiveRef.current) return;
          transcriptionRequestRef.current = null;
          const text = result.text.trim();
          if (!text) throw new Error("Whisper returned an empty transcription.");
          setCallTranscript(text);
          await sendMessage(text, true);
        } catch (error) {
          transcriptionRequestRef.current = null;
          if (!callActiveRef.current) return;
          setCallState(navigator.onLine ? "error" : "offline");
          setCallTranscript(error instanceof Error ? error.message : "Whisper transcription failed.");
        }
      };
      const measure = () => {
        if (vadCaptureRef.current !== capture || recorder.state === "inactive") return;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const rms = Math.sqrt(sum / samples.length);
        const now = performance.now();
        if (!speechStarted && calibrationFrames < 20 && rms < 0.012) {
          noiseFloor = Math.max(0.003, noiseFloor * 0.8 + rms * 0.2);
          calibrationFrames += 1;
        }
        const speaking = rms > Math.max(0.009, noiseFloor + 0.007, noiseFloor * 1.8);
        speechFrames = speaking ? speechFrames + 1 : Math.max(0, speechFrames - 1);
        if (speechFrames >= 6) { speechStarted = true; lastSpeechAt = now; }
        else if (speechStarted && speaking) lastSpeechAt = now;
        if (speechStarted && now - lastSpeechAt >= 800) stopVadCapture(true);
        else if (speechStarted && now - startedAt >= 25000) stopVadCapture(true);
        else if (!speechStarted && now - startedAt >= 15000) {
          stopVadCapture(false);
          if (callActiveRef.current && !callMutedRef.current) window.setTimeout(() => void startListening(), 100);
        } else capture.frame = requestAnimationFrame(measure);
      };
      recorder.start(200);
      setCallTranscript("Listening... (local VAD)");
      setCallState("listening");
      capture.frame = requestAnimationFrame(measure);
    } catch (error) {
      stopVadCapture(false);
      setCallState("error");
      setCallTranscript(error instanceof Error ? error.message : "Could not start microphone capture.");
    }
  };

  const startCall = async () => {
    ensureCallAudioContext();
    await speechPlayback.stop();
    const sttStatus = await window.reikaDesktop?.stt.secretStatus().catch(() => null);
    if (!sttStatus?.configured) {
      setCallOpen(true);
      setCallState("error");
      setCallTranscript("Configure an OpenRouter API key in Settings > Secrets to use Whisper calls.");
      closeCallAudioContext();
      return;
    }
    callActiveRef.current = true;
    callMutedRef.current = false;
    setCallOpen(true);
    setCallMuted(false);
    window.setTimeout(() => void startListening(), 0);
  };

  const endCall = async () => {
    callActiveRef.current = false;
    callMutedRef.current = false;
    stopVadCapture(false);
    closeCallAudioContext();
    cancelTranscription();
    await speechPlayback.stop();
    setCallOpen(false);
    setCallState("idle");
    setCallTranscript("");
  };

  const toggleCallMute = () => {
    const muted = !callMuted;
    callMutedRef.current = muted;
    setCallMuted(muted);
    if (muted) {
      stopVadCapture(false);
      closeCallAudioContext();
      cancelTranscription();
      setCallState("muted");
    } else if (callActiveRef.current) {
      ensureCallAudioContext();
      window.setTimeout(() => void startListening(), 0);
    }
  };

  useEffect(() => {
    if (!callOpen || !callActiveRef.current || callMuted) return;
    if (callState === "speaking" && playback.phase === "idle") window.setTimeout(() => void startListening(), 100);
    if (callState === "speaking" && playback.phase === "error") setCallState("error");
  }, [callOpen, callMuted, callState, playback.phase]);

  useEffect(() => {
    const handleChatShortcuts = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setConversationSearchOpen(true);
      } else if (event.key === "Escape" && conversationSearchOpen) {
        setConversationSearchOpen(false);
        setConversationSearch("");
      }
    };
    window.addEventListener("keydown", handleChatShortcuts);
    return () => window.removeEventListener("keydown", handleChatShortcuts);
  }, [conversationSearchOpen]);

  useEffect(() => {
    if (!followLatestRef.current) return;
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [busy, visibleMessages.length]);
  const canSend =
    Boolean(draft.trim()) &&
    !busy &&
    (relayRouteReady || (Boolean(selectedProvider) && selectedProviderCanChat && selectedProviderStatus === "online" && !stateError));

  return (
    <main className={pageMotionClass("chat-screen")}>
      {sessionDrawerOpen ? <button className="chat-drawer-backdrop" type="button" aria-label="Close sessions" onClick={() => setSessionDrawerOpen(false)} /> : null}
      <aside className={cx("chat-profile", sessionDrawerOpen && "drawer-open")}>
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={20} />
          Back
        </button>
        <button className="chat-drawer-close icon-button" type="button" aria-label="Close sessions" onClick={() => setSessionDrawerOpen(false)}>
          <X size={20} />
        </button>
        <img className="chat-profile-art" src={chatPortraitArt.src} alt="" style={chatPortraitArt.style} />
        <div className="chat-profile-card live-chat-profile-card">
          <h2>
            {displayAgentName}
          </h2>
          {showAgentContext ? <p>{providerLabel} {"\u2022"} {deviceName}</p> : null}
          <span>
            <StatusDot status={selectedProviderStatus} />
            {statusLabels[selectedProviderStatus]}
          </span>

          <div className="live-chat-card">
            <label>
              <span>Agent</span>
              <select data-testid="relay-agent-select" value={selectedAgentOptionKey} onChange={(event) => handleAgentChange(event.target.value)}>
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
                    onClick={() => {
                      setSelectedSessionId(session.id);
                      setSessionDrawerOpen(false);
                    }}
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
          <button className="chat-drawer-toggle icon-button" type="button" aria-label="Open agent and sessions" onClick={() => setSessionDrawerOpen(true)}>
            <PanelLeft size={20} />
          </button>
          <img src={chatAvatar.src} alt="" style={chatAvatar.style} />
          <div>
            <h1>
              {displayAgentName}
            </h1>
            {showAgentContext ? (
              <p>
                {providerLabel} {"\u2022"} {deviceName}
                <StatusDot status={selectedProviderStatus} />
                {statusLabels[selectedProviderStatus]}
              </p>
            ) : (
              <p>
                <StatusDot status={selectedProviderStatus} />
                {statusLabels[selectedProviderStatus]}
              </p>
            )}
          </div>
          <div className="chat-header-actions">
            <button className="icon-button" type="button" onClick={() => void (callOpen ? endCall() : startCall())} aria-label={callOpen ? "End voice call" : `Call ${displayAgentName}`} title={!callAllowed ? "Calls are disabled for this agent in Settings" : callOpen ? "End call" : `Call ${displayAgentName}`} disabled={!resolvedVoice?.available || !callAllowed}>{callOpen ? <PhoneOff size={20} /> : <Phone size={20} />}</button>
            <button className="icon-button" type="button" onClick={() => setConversationSearchOpen((current) => !current)} aria-label="Search this conversation" title="Search conversation (Ctrl+Shift+F)"><Search size={20} /></button>
            <button className="icon-button" type="button" onClick={exportConversation} aria-label="Export conversation as Markdown" title="Export as Markdown"><Download size={20} /></button>
            <button className="icon-button" data-testid="chat-refresh-providers" onClick={() => void handleRefreshProviders()} disabled={busy} aria-label="Refresh providers"><Activity size={22} /></button>
          </div>
        </header>

        {callOpen ? (
          <section className="voice-call-panel" aria-label={`Voice call with ${displayAgentName}`}>
            <div>
              <strong>{displayAgentName}</strong>
              <span className={`voice-call-state ${callState}`}>{callState === "processing" ? "Thinking" : callState.charAt(0).toUpperCase() + callState.slice(1)}</span>
            </div>
            <p>{callState === "error" && playback.error ? playback.error : callTranscript || (callState === "listening" ? "Listening..." : callState === "speaking" ? `${displayAgentName} is speaking...` : "Voice call active")}</p>
            <small>{resolvedVoice?.voiceLabel} · {resolvedVoice?.source}</small>
            <div>
              <button type="button" onClick={toggleCallMute} aria-label={callMuted ? "Unmute microphone" : "Mute microphone"}>{callMuted ? <MicOff size={18} /> : <Mic size={18} />}{callMuted ? "Unmute" : "Mute"}</button>
              {playback.phase === "speaking" || playback.phase === "loading" || playback.phase === "paused" ? <button type="button" onClick={() => void speechPlayback.stop()}><Square size={18} />Interrupt</button> : null}
              <button type="button" className="danger" onClick={() => void endCall()}><PhoneOff size={18} />End call</button>
            </div>
          </section>
        ) : null}

        <section className="conversation-panel">
          {conversationSearchOpen ? (
            <div className="conversation-search-bar">
              <Search size={17} />
              <input autoFocus value={conversationSearch} onChange={(event) => { setConversationSearch(event.target.value); setActiveConversationMatch(0); }} placeholder="Search this conversation…" aria-label="Search this conversation" />
              <span>{conversationSearch.trim() ? `${conversationMatches.length ? activeConversationMatch + 1 : 0} / ${conversationMatches.length}` : "Ctrl+Shift+F"}</span>
              <button type="button" onClick={() => showConversationMatch(activeConversationMatch - 1)} disabled={conversationMatches.length === 0} aria-label="Previous match"><ArrowUp size={16} /></button>
              <button type="button" onClick={() => showConversationMatch(activeConversationMatch + 1)} disabled={conversationMatches.length === 0} aria-label="Next match"><ArrowDown size={16} /></button>
              <button type="button" onClick={() => { setConversationSearchOpen(false); setConversationSearch(""); }} aria-label="Close conversation search"><X size={16} /></button>
            </div>
          ) : null}
          <div className="day-divider">
            <span />
            {status}
            <span />
          </div>
          {stateError && !selectedIsRelayProvider ? <div className="chat-error-banner">Reika server offline. {stateError}</div> : null}
          {!stateError && !selectedIsRelayProvider && selectedProvider && !selectedProviderCanChat ? <div className="chat-error-banner">{selectedProvider.name} is not chat-capable yet.</div> : null}
          {!stateError && !selectedIsRelayProvider && selectedProvider && selectedProviderStatus !== "online" ? <div className="chat-error-banner">{selectedProvider.name} is {statusLabels[selectedProviderStatus].toLowerCase()}.</div> : null}
          {developerDiagnostics && selectedIsRelayProvider ? <div className="chat-inline-note">Relay chat active: {relayRouteSummary}</div> : null}
          {sendError ? <div className="chat-error-banner">{sendError}</div> : null}
          <div
            ref={messageListRef}
            className="message-list"
            data-testid="message-list"
            onScroll={(event) => {
              const element = event.currentTarget;
              followLatestRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
            }}
          >
            {messages.length > visibleMessages.length ? <div className="chat-inline-note">Showing the latest {visibleMessages.length} messages.</div> : null}
            {visibleMessages.map((message, index) => (
              <MessageBubble message={message} key={message.id} agentAvatar={chatAvatar} agentName={displayAgentName} motionIndex={index} searchMatch={conversationMatches.includes(message.id)} activeSearchMatch={conversationMatches[activeConversationMatch] === message.id} copied={copiedMessageId === message.id} onCopy={() => void copyMessage(message)} playback={playback.messageId === message.id ? playback : undefined} onPlay={() => void speakAgentMessage(message, true)} onPause={() => speechPlayback.pauseOrResume()} onStop={() => void speechPlayback.stop()} onMute={() => speechPlayback.setMuted(!playback.muted)} />
            ))}
            {!busy && visibleMessages.length === 0 && !sendError && (!stateError || selectedIsRelayProvider) ? (
              <div className="chat-empty-state">
                <MessageCircle size={22} />
                <span>No messages yet. Start a new conversation when you are ready.</span>
              </div>
            ) : null}
            {busy ? (
              delegationActivity.length ? <DelegationActivityCard activity={delegationActivity} /> : (
                <div className="typing-row" data-testid="thinking-row">
                  <img src={chatAvatar.src} alt="" style={chatAvatar.style} />
                  <span>{displayAgentName} is thinking</span>
                  <i />
                  <i />
                  <i />
                </div>
              )
            ) : null}
          </div>

          <form className="chat-composer" data-testid="chat-composer" onSubmit={handleSubmit}>
            <input data-testid="chat-input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Message ${displayAgentName}...`} />
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
                  disabled={busy || selectedIsRelayProvider || (Boolean(stateError) && !selectedIsRelayProvider)}
                  title={selectedIsRelayProvider ? "Attachments are unavailable for remote chat until secure file transfer is supported." : undefined}
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
            <button className="send-button" data-testid="chat-send" type="submit" aria-label="Send" disabled={!canSend}>
              <Send size={24} />
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}

function MessageBubble({ message, agentAvatar, agentName = "Reika", motionIndex = 0, searchMatch = false, activeSearchMatch = false, copied = false, onCopy, playback, onPlay, onPause, onStop, onMute }: { message: ChatMessage; agentAvatar?: ArtRenderAsset; agentName?: string; motionIndex?: number; searchMatch?: boolean; activeSearchMatch?: boolean; copied?: boolean; onCopy?: () => void; playback?: PlaybackState; onPlay?: () => void; onPause?: () => void; onStop?: () => void; onMute?: () => void }) {
  if (message.sender === "system") return null;
  const isUser = message.sender === "user";

  return (
    <article className={cx("chat-message motion-message", isUser ? "user" : "agent", searchMatch && "search-match", activeSearchMatch && "active-search-match")} data-message-id={message.id} data-testid={isUser ? "chat-message-user" : "chat-message-agent"} style={motionDelay(Math.min(motionIndex, 8), 28)}>
      {!isUser ? <img src={agentAvatar?.src ?? assets.reika.avatar} alt="" style={agentAvatar?.style} /> : null}
      <div className="message-content">
        {!isUser ? (
          <header>
            <strong>{agentName}</strong>
            <time>{message.time}</time>
          </header>
        ) : null}
        <MessageBody text={message.body} />
        {!isUser && message.meta?.memoryMesh && typeof message.meta.memoryMesh === "object" ? <DelegationSummaryCard value={message.meta.memoryMesh as Record<string, unknown>} /> : null}
        <div className="message-actions">
          {!isUser ? <button type="button" onClick={onPlay} aria-label={playback ? "Replay message" : "Play message"} title={playback ? "Replay" : "Play"}><Play size={14} /></button> : null}
          {!isUser && playback && ["speaking", "paused"].includes(playback.phase) ? <button type="button" onClick={onPause} aria-label={playback.phase === "paused" ? "Resume speech" : "Pause speech"}>{playback.phase === "paused" ? <Play size={14} /> : <Pause size={14} />}</button> : null}
          {!isUser && playback && playback.phase !== "idle" ? <button type="button" onClick={onStop} aria-label="Stop speech"><Square size={14} /></button> : null}
          {!isUser ? <button type="button" onClick={onMute} aria-label={playback?.muted ? "Unmute speech" : "Mute speech"}>{playback?.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button> : null}
          {!isUser && playback?.phase === "speaking" ? <span className="speaking-indicator">Speaking</span> : null}
          <button type="button" onClick={onCopy} aria-label={copied ? "Message copied" : "Copy message"} title={copied ? "Copied" : "Copy message"}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
        </div>
        {!isUser ? null : (
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

const delegationStageLabels: Record<string, string> = {
  resolving: "Resolving project",
  route_planned: "Selecting agent and device",
  planning: "Selecting agent and device",
  delegating: "Delegating task",
  awaiting_approval: "Awaiting approval",
  queued: "Queued",
  sent: "Sent to agent",
  accepted: "Accepted",
  working: "Agent working",
  memory_updated: "Project memory updated",
  completed: "Result returned",
  failed: "Delegation failed",
  timed_out: "Timed out",
  cancelled: "Task cancelled",
  clarification_required: "Clarification required"
};

function textField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function arrayOfStrings(value: unknown, limit = 3) {
  return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, limit) : [];
}

function DelegationActivityCard({ activity }: { activity: Array<Record<string, unknown>> }) {
  const current = activity.at(-1) ?? {};
  const stage = String(current.stage || "working");
  const agent = current.agent && typeof current.agent === "object" ? String((current.agent as { displayName?: unknown }).displayName || "") : "";
  const device = current.device && typeof current.device === "object" ? String((current.device as { name?: unknown }).name || "") : "";
  return <div className="delegation-card live" data-testid="delegation-activity"><Activity size={16} /><div><strong>{delegationStageLabels[stage] || stage}</strong>{agent || device ? <span>{[agent, device].filter(Boolean).join(" on ")}</span> : null}</div></div>;
}

function DelegationSummaryCard({ value }: { value: Record<string, unknown> }) {
  const lifecycle = Array.isArray(value.lifecycle) ? value.lifecycle.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
  const reasons = arrayOfStrings(value.reasons, 3);
  const memoryIds = arrayOfStrings(value.memoryWritebackIds, 2);
  const projectName = textField(value.projectName) || textField(value.projectId) || "Project";
  const targetName = textField(value.targetAgentName) || textField(value.targetAgentId) || "No agent selected";
  const deviceName = textField(value.targetDeviceName) || textField(value.targetDeviceId);
  const status = textField(value.status) || "routed";
  const originTools = value.originProviderTools && typeof value.originProviderTools === "object" ? value.originProviderTools as Record<string, unknown> : undefined;
  const toolCalls = originTools && Array.isArray(originTools.toolCalls) ? originTools.toolCalls.length : 0;
  const toolWarning = textField(originTools?.warning);
  return (
    <details className="delegation-card summary" data-testid="delegation-summary">
      <summary><Activity size={15} /><span>Memory Mesh · {String(value.status || "routed")}</span></summary>
      <div className="delegation-timeline">
        <div className="delegation-target">
          <strong>{projectName}</strong>
          <small>{deviceName ? `${targetName} on ${deviceName}` : targetName} - {status.replace(/_/g, " ")}</small>
        </div>
        {lifecycle.map((item, index) => {
          const stage = String(item.stage || item.status || "");
          return <span key={`${stage}-${index}`}><i />{delegationStageLabels[stage] || stage}</span>;
        })}
        {reasons.map((reason) => <small key={reason}>{reason}</small>)}
        {toolCalls ? <small>Origin provider used {toolCalls} Reika planning tool{toolCalls === 1 ? "" : "s"}.</small> : null}
        {toolWarning ? <small>Origin provider tool bridge warning: {toolWarning}</small> : null}
        {memoryIds.length ? <small>Memory writeback: {memoryIds.join(", ")}</small> : null}
        {value.taskId ? <code>Task {String(value.taskId).slice(0, 8)}</code> : null}
      </div>
    </details>
  );
}

function MessageBody({ text }: { text: string }) {
  const parts = text.split(/```([\w+-]*)\n?([\s\S]*?)```/g);
  return (
    <div className="message-body">
      {parts.map((part, index) => {
        if (index % 3 === 1) return null;
        if (index % 3 === 2) {
          const language = parts[index - 1];
          return <pre key={index} data-language={language || undefined}><code>{part.trimEnd()}</code></pre>;
        }
        return part ? <p key={index}>{part}</p> : null;
      })}
    </div>
  );
}

function hasRequestedRelayIdentity(agent: Agent) {
  return Boolean(agent.relayProviderId || agent.relayAgentId);
}

function findRequestedRelayAgent(agents: ReikaProviderRecord["agents"], agent: Agent) {
  const requestedAgentId = typeof agent.relayAgentId === "string" && agent.relayAgentId ? agent.relayAgentId : "";
  if (requestedAgentId) {
    const byRelayId = agents.find((item) => getRelayAgentId(item) === requestedAgentId || item.id === requestedAgentId);
    if (byRelayId) return byRelayId;
  }

  return agents.find((item) => item.id === agent.id || item.relayAgentId === agent.id);
}

function providerMatchesRequestedRelayAgent(provider: ReikaProviderRecord, agent: Agent) {
  const requestedProviderId = typeof agent.relayProviderId === "string" && agent.relayProviderId ? agent.relayProviderId : "";
  const requestedAgentId = typeof agent.relayAgentId === "string" && agent.relayAgentId ? agent.relayAgentId : "";
  if (!requestedProviderId && !requestedAgentId) return false;
  if (requestedProviderId && getRelayProviderId(provider) !== requestedProviderId) return false;

  const providerRelayDeviceId = getRelayDeviceId(provider, undefined);
  if (providerRelayDeviceId && agent.deviceId && providerRelayDeviceId !== agent.deviceId) return false;

  return provider.agents.some((item) => {
    const relayAgentId = getRelayAgentId(item);
    return Boolean(
      (requestedAgentId && relayAgentId === requestedAgentId) ||
      item.id === agent.id ||
      agentMatches(item, requestedAgentId || agent.id, undefined)
    );
  });
}

function makeAgentOptionKey(providerId: string, agentId: string) {
  return `${providerId}::${agentId}`;
}

function makeRelayConversationKey(deviceId: string, providerId: string, agentId: string) {
  return `agenthub:relay-chat:${deviceId}:${providerId}:${agentId}`;
}

type SelectableAgentOption = {
  key: string;
  provider: ReikaProviderRecord;
  agent: ReikaProviderRecord["agents"][number];
  label: string;
};

function collapseDuplicateAgentOptions(options: SelectableAgentOption[], settings: ReikaAgentSelectorSettings, selectedKey = "") {
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
    for (const option of toHide) {
      if (option.key !== selectedKey) hidden.add(option.key);
    }
  }

  return options.filter((option) => !hidden.has(option.key));
}

function formatAgentOptionLabel(agent: ReikaProviderRecord["agents"][number], provider: ReikaProviderRecord, mode: ReikaAgentSelectorSettings["labelMode"], showRole: boolean) {
  const agentName = formatAgentDisplayName(String(agent.name || agent.label || agent.id || "Agent"), agent.role, showRole);
  if (mode === "agent-only") return agentName;
  if (mode === "agent-device") return `${agentName} - ${getProviderDeviceLabel(provider, agent)}`;
  return `${agentName} - ${formatProviderLabel(provider.name)}`;
}

function formatAgentDisplayName(name: string, role: unknown, showRole: boolean) {
  const baseName = stripRoleSuffix(name);
  if (!showRole) return baseName;
  const roleText = cleanRoleLabel(role, baseName);
  return roleText ? `${baseName} / ${roleText}` : name;
}

function stripRoleSuffix(name: string) {
  return String(name || "Agent").split(/\s+\/\s+/u)[0]?.trim() || "Agent";
}

function cleanRoleLabel(role: unknown, baseName: string) {
  const roleText = String(role ?? "").trim();
  if (!roleText) return "";
  if (roleText.toLowerCase() === baseName.toLowerCase()) return "";
  if (/^(agent|assistant)$/iu.test(roleText)) return "";
  return roleText;
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
