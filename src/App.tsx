import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  activeUnreadKey,
  applyLiveMessage,
  canSendMessage,
  clearUnread,
  DEFAULT_ROOM_THREADS,
  incrementUnread,
  isActiveConversation,
  markMessagesSeen,
  mergeUnreadDeltas,
  migrateLegacyThreads,
  reconcileOptimisticMessage,
  resolveActiveThreadTitle,
  seedSyncCursors,
  syncInactiveUnread,
  takePendingOptimisticId,
  dropPendingOptimisticId,
  threadsForRoom,
  threadsFromState,
  trackSeenMessageId,
  unreadKey,
  updateSyncCursor,
  appendThreadToRoomMap,
  defaultRoomThreads,
} from './app-helpers';
import {
  formatAttachmentRejections,
  MAX_ATTACHMENTS,
  mergePendingAttachments,
  readAttachmentFiles,
  removePendingAtIndex,
  revokeAttachmentPreviews,
  toSendAttachments,
  type PendingAttachment,
} from './attachments';
import { MessageAttachments } from './MessageAttachments';
import { formatMessageTime } from './format-message-time';
import { FormattedMessage } from './FormattedMessage';
import { messageSenderLabel } from './message-sender';
import { SendArrowIcon, PlusIcon } from './nav-icons';
import { senderColor } from './sender-color';
import { SidebarSection } from './SidebarRoom';
import { ThemeToggle } from './ThemeToggle';
import { defaultThreadTitle, isAutoThreadTitle, titleFromMessage } from './thread-names';
import type { BootstrapPayload, ThreadMeta, WebChatMessage, WebChatRoom } from './types';
import {
  connectWebSocket,
  createThread,
  deleteThread,
  fetchBootstrap,
  fetchMessages,
  getStoredToken,
  renameThread,
  sendMessage,
  storeToken,
} from './api';

function threadsMapFromRooms(rooms: WebChatRoom[]): Record<string, ThreadMeta[]> {
  const map: Record<string, ThreadMeta[]> = {};
  for (const room of rooms) {
    map[room.platformId] = room.threads?.length ? room.threads : [...DEFAULT_ROOM_THREADS];
  }
  return map;
}

export function App() {
  const [token, setToken] = useState(getStoredToken);
  const [tokenInput, setTokenInput] = useState(token);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<WebChatRoom | null>(null);
  const [threadsByRoom, setThreadsByRoom] = useState<Record<string, ThreadMeta[]>>({});
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(() => new Set());
  const [threadId, setThreadId] = useState('main');
  const [messages, setMessages] = useState<WebChatMessage[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [composerDragOver, setComposerDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingAttachmentsRef = useRef(pendingAttachments);
  pendingAttachmentsRef.current = pendingAttachments;
  const roomRef = useRef(room);
  const threadIdRef = useRef(threadId);
  const threadsByRoomRef = useRef(threadsByRoom);
  const seenMessageIdsRef = useRef(new Set<string>());
  const syncCursorRef = useRef<Record<string, number>>({});
  const syncInFlightRef = useRef(false);
  const skipNextIntervalSyncRef = useRef(false);
  const pendingOptimisticByThreadRef = useRef<Record<string, string[]>>({});
  roomRef.current = room;
  threadIdRef.current = threadId;
  threadsByRoomRef.current = threadsByRoom;

  const loadBootstrap = useCallback(async (authToken: string) => {
    const data = await fetchBootstrap(authToken);
    const baseThreads = threadsMapFromRooms(data.rooms);
    let threadsMap = baseThreads;
    try {
      threadsMap = await migrateLegacyThreads(authToken, data.rooms, baseThreads);
    } catch {
      // migration is best-effort; bootstrap already succeeded
    }
    setBootstrap(data);
    setThreadsByRoom(threadsMap);
    setUnreadCounts({});
    seenMessageIdsRef.current = new Set();
    syncCursorRef.current = seedSyncCursors({}, data.rooms, threadsMap);
    const lobby = data.rooms.find((r) => r.kind === 'lobby') ?? data.rooms[0] ?? null;
    roomRef.current = lobby;
    threadIdRef.current = 'main';
    setRoom(lobby);
    setThreadId('main');
    if (lobby) {
      setExpandedRooms(new Set([lobby.platformId]));
    }
  }, []);

  const syncInactiveRooms = useCallback(async () => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    try {
      const result = await syncInactiveUnread(
        token,
        bootstrap!,
        threadsByRoomRef.current,
        roomRef.current,
        threadIdRef.current,
        syncCursorRef.current,
        seenMessageIdsRef.current,
        fetchMessages,
      );
      syncCursorRef.current = { ...syncCursorRef.current, ...result.syncCursor };
      if (Object.keys(result.counts).length === 0) return;
      setUnreadCounts((prev) =>
        mergeUnreadDeltas(prev, result.counts, activeUnreadKey(roomRef.current, threadIdRef.current)),
      );
    } finally {
      syncInFlightRef.current = false;
    }
  }, [token, bootstrap]);

  useEffect(() => {
    if (!token) return;
    storeToken(token);
    loadBootstrap(token).catch((err: Error) => setError(err.message));
  }, [token, loadBootstrap]);

  useEffect(() => {
    if (!room) return;
    setExpandedRooms((prev) => new Set(prev).add(room.platformId));
  }, [room?.platformId]);

  useEffect(() => {
    if (!token || !room) return;
    let cancelled = false;
    fetchMessages(token, room.platformId, threadId)
      .then((msgs) => {
        if (!cancelled) {
          setMessages(msgs);
          const maxTs = markMessagesSeen(msgs, seenMessageIdsRef.current);
          syncCursorRef.current = updateSyncCursor(
            syncCursorRef.current,
            room.platformId,
            threadId,
            maxTs,
          );
          setUnreadCounts((counts) => clearUnread(counts, room.platformId, threadId));
        }
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [token, room, threadId]);

  useEffect(() => {
    if (!token || !bootstrap) return;
    const connection = connectWebSocket(
      token,
      (event) => {
        if (event.type !== 'message') return;
        const msg = event.message;
        const seenIds = seenMessageIdsRef.current;
        syncCursorRef.current = updateSyncCursor(
          syncCursorRef.current,
          msg.platformId,
          msg.threadId,
          msg.timestamp,
        );
        if (isActiveConversation(msg, roomRef.current, threadIdRef.current)) {
          let pendingId: string | null = null;
          if (msg.direction === 'inbound') {
            const key = unreadKey(msg.platformId, msg.threadId);
            const queues = pendingOptimisticByThreadRef.current;
            const { optimisticId, remaining } = takePendingOptimisticId(queues[key]);
            pendingId = optimisticId;
            if (optimisticId) {
              if (remaining.length) queues[key] = remaining;
              else delete queues[key];
            }
          }
          setMessages((prev) => {
            const next = applyLiveMessage(
              prev,
              msg,
              roomRef.current,
              threadIdRef.current,
              pendingId,
            );
            if (next === prev) return prev;
            trackSeenMessageId(seenIds, msg.id);
            return next;
          });
          setUnreadCounts((counts) =>
            clearUnread(counts, msg.platformId, msg.threadId),
          );
        } else if (!seenIds.has(msg.id)) {
          trackSeenMessageId(seenIds, msg.id);
          setUnreadCounts((counts) => incrementUnread(counts, msg));
        }
      },
      () => {
        skipNextIntervalSyncRef.current = true;
        void syncInactiveRooms();
      },
    );
    return () => connection.close();
  }, [token, bootstrap, syncInactiveRooms]);

  useEffect(() => {
    if (!token || !bootstrap) return;
    void syncInactiveRooms();
    const id = setInterval(() => {
      if (skipNextIntervalSyncRef.current) {
        skipNextIntervalSyncRef.current = false;
        return;
      }
      void syncInactiveRooms();
    }, 5000);
    return () => clearInterval(id);
  }, [token, bootstrap, syncInactiveRooms]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const resizeComposer = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    resizeComposer();
  }, [draft, pendingAttachments.length, resizeComposer]);

  useEffect(() => {
    return () => {
      revokeAttachmentPreviews(pendingAttachmentsRef.current);
    };
  }, []);

  const agentsHint = useMemo(() => {
    if (!bootstrap?.agents.length) return '';
    return bootstrap.agents.map((a) => a.mention).join(', ');
  }, [bootstrap]);

  const activeThreadTitle = useMemo(() => {
    if (!room) return null;
    return resolveActiveThreadTitle(threadsByRoom[room.platformId], threadId);
  }, [room, threadId, threadsByRoom]);

  const handleAuth = () => {
    const nextToken = tokenInput.trim();
    if (!nextToken) {
      setError('Token required');
      return;
    }
    setError(null);
    setToken(nextToken);
  };

  const updateThreadsForRoom = useCallback(
    (platformId: string, updater: (threads: ThreadMeta[]) => ThreadMeta[]) => {
      setThreadsByRoom((prev) => {
        const current = threadsForRoom(prev, platformId, defaultRoomThreads);
        const next = updater(current);
        return { ...prev, [platformId]: next };
      });
    },
    [],
  );

  const handleSend = async () => {
    if (!canSendMessage(token, room, draft, sending, pendingAttachments.length)) return;
    setSending(true);
    setError(null);
    const text = draft.trim();
    const attachments = toSendAttachments(pendingAttachments);
    const hadNoMessages = messages.length === 0;
    const activeRoom = room;
    const activeThread = threadId;
    const activeThreads = threadsFromState(threadsByRoom, activeRoom.platformId);
    setDraft('');
    revokeAttachmentPreviews(pendingAttachments);
    setPendingAttachments([]);
    const optimisticId = `local-${Date.now()}`;
    const optimistic: WebChatMessage = {
      id: optimisticId,
      direction: 'inbound',
      text,
      timestamp: Date.now(),
      platformId: activeRoom.platformId,
      threadId: activeThread,
      ...(attachments.length > 0 ? { attachments } : {}),
    };
    setMessages((prev) => [...prev, optimistic]);
    const threadKey = unreadKey(activeRoom.platformId, activeThread);
    pendingOptimisticByThreadRef.current[threadKey] = [
      ...(pendingOptimisticByThreadRef.current[threadKey] ?? []),
      optimisticId,
    ];
    try {
      const sent = await sendMessage(
        token,
        activeRoom.platformId,
        activeThread,
        text,
        attachments.length > 0 ? attachments : undefined,
      );
      dropPendingOptimisticId(
        pendingOptimisticByThreadRef.current,
        activeRoom.platformId,
        activeThread,
        optimisticId,
      );
      trackSeenMessageId(seenMessageIdsRef.current, sent.messageId);
      setMessages((prev) => reconcileOptimisticMessage(prev, optimisticId, sent));
      syncCursorRef.current = updateSyncCursor(
        syncCursorRef.current,
        activeRoom.platformId,
        activeThread,
        sent.timestamp,
      );
      if (hadNoMessages && activeThread !== 'main') {
        const thread = activeThreads.find((t) => t.id === activeThread);
        if (thread && isAutoThreadTitle(thread.title)) {
          const autoTitle = titleFromMessage(text);
          try {
            await renameThread(token, activeRoom.platformId, activeThread, autoTitle);
            updateThreadsForRoom(activeRoom.platformId, (list) =>
              list.map((t) => (t.id === activeThread ? { ...t, title: autoTitle } : t)),
            );
          } catch {
            // title sync is best-effort
          }
        }
      }
    } catch (err) {
      dropPendingOptimisticId(
        pendingOptimisticByThreadRef.current,
        activeRoom.platformId,
        activeThread,
        optimisticId,
      );
      setError(err instanceof Error ? err.message : 'send failed');
    } finally {
      setSending(false);
    }
  };

  const addPendingFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const existingCount = pendingAttachmentsRef.current.length;
    try {
      const { attachments: next, rejected } = await readAttachmentFiles(files, existingCount);
      if (next.length === 0) {
        const rejectionMessage = formatAttachmentRejections(rejected);
        if (rejectionMessage) setError(rejectionMessage);
        return;
      }

      let dropped: PendingAttachment[] = [];
      setPendingAttachments((prev) => {
        const merged = mergePendingAttachments(prev, next);
        dropped = merged.dropped;
        return merged.attachments;
      });
      revokeAttachmentPreviews(dropped);
      const capRejected = dropped.map((att) => ({ name: att.name, reason: 'capacity' as const }));

      const rejectionMessage = formatAttachmentRejections([...rejected, ...capRejected]);
      if (rejectionMessage) setError(rejectionMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'attachment failed');
    }
  };

  const handleRemovePendingAttachment = (index: number) => {
    setPendingAttachments((prev) => removePendingAtIndex(prev, index));
  };

  const handleComposerDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setComposerDragOver(true);
  };

  const handleComposerDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setComposerDragOver(false);
  };

  const handleComposerDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setComposerDragOver(false);
    void addPendingFiles(e.dataTransfer.files);
  };

  const handleSelectRoomMain = (targetRoom: WebChatRoom) => {
    roomRef.current = targetRoom;
    threadIdRef.current = 'main';
    setUnreadCounts((counts) => clearUnread(counts, targetRoom.platformId, 'main'));
    setRoom(targetRoom);
    setThreadId('main');
  };

  const handleSelectThread = (targetRoom: WebChatRoom, nextThreadId: string) => {
    roomRef.current = targetRoom;
    threadIdRef.current = nextThreadId;
    setUnreadCounts((counts) => clearUnread(counts, targetRoom.platformId, nextThreadId));
    setRoom(targetRoom);
    setThreadId(nextThreadId);
    setExpandedRooms((prev) => new Set(prev).add(targetRoom.platformId));
  };

  const handleToggleExpand = (platformId: string) => {
    setExpandedRooms((prev) => {
      const next = new Set(prev);
      if (next.has(platformId)) next.delete(platformId);
      else next.add(platformId);
      return next;
    });
  };

  const handleNewThread = async (targetRoom: WebChatRoom) => {
    const current = threadsForRoom(threadsByRoom, targetRoom.platformId, defaultRoomThreads);
    const childCount = current.filter((t) => t.id !== 'main').length;
    const title = defaultThreadTitle(childCount);
    try {
      const created = await createThread(token, targetRoom.platformId, title);
      setThreadsByRoom((prev) => appendThreadToRoomMap(prev, targetRoom.platformId, created));
      setExpandedRooms((prev) => new Set(prev).add(targetRoom.platformId));
      syncCursorRef.current = updateSyncCursor(
        syncCursorRef.current,
        targetRoom.platformId,
        created.id,
        Date.now(),
      );
      roomRef.current = targetRoom;
      threadIdRef.current = created.id;
      setRoom(targetRoom);
      setThreadId(created.id);
      setMessages([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create thread failed');
    }
  };

  const handleRenameThread = async (targetRoom: WebChatRoom, thread: ThreadMeta, title: string) => {
    const trimmed = title.trim();
    try {
      await renameThread(token, targetRoom.platformId, thread.id, trimmed);
      updateThreadsForRoom(targetRoom.platformId, (list) =>
        list.map((t) => (t.id === thread.id ? { ...t, title: trimmed } : t)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'rename thread failed');
    }
  };

  const handleDeleteThread = async (targetRoom: WebChatRoom, thread: ThreadMeta) => {
    try {
      await deleteThread(token, targetRoom.platformId, thread.id);
      updateThreadsForRoom(targetRoom.platformId, (list) => list.filter((t) => t.id !== thread.id));
      setUnreadCounts((counts) => clearUnread(counts, targetRoom.platformId, thread.id));
      if (room && room.platformId === targetRoom.platformId && threadId === thread.id) {
        threadIdRef.current = 'main';
        setThreadId('main');
        setMessages([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete thread failed');
    }
  };

  const sidebarSectionProps = {
    activeRoomId: room?.platformId,
    activeThreadId: threadId,
    unreadCounts,
    threadsByRoom,
    expandedRooms,
    onToggleExpand: handleToggleExpand,
    onSelectRoomMain: handleSelectRoomMain,
    onSelectThread: handleSelectThread,
    onNewThread: handleNewThread,
    onRenameThread: handleRenameThread,
    onDeleteThread: handleDeleteThread,
  };

  if (!token) {
    return (
      <div className="auth-screen">
        <h1>NanoClaw Web Chat</h1>
        <p className="hint">Enter your WEBCHAT_SECRET to connect to the local channel.</p>
        <label htmlFor="token">Bearer token</label>
        <input
          id="token"
          type="password"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="Paste WEBCHAT_SECRET"
        />
        {error && <p className="error">{error}</p>}
        <button type="button" className="btn" onClick={handleAuth}>
          Connect
        </button>
      </div>
    );
  }

  if (!bootstrap || !room) {
    return (
      <div className="auth-screen">
        <p className="hint">Connecting…</p>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const lobbyRooms = bootstrap.rooms.filter((r) => r.kind === 'lobby');
  const dmRooms = bootstrap.rooms.filter((r) => r.kind === 'dm');

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>NanoClaw</h1>
        <nav className="sidebar-nav">
          <SidebarSection label="Rooms" rooms={lobbyRooms} {...sidebarSectionProps} />
          <SidebarSection label="Direct messages" rooms={dmRooms} {...sidebarSectionProps} />
          {agentsHint && (
            <p className="hint">
              Lobby mentions: {agentsHint}
              {bootstrap.agents.some((a) => a.mention === '@team') ? ', @team' : ''}
            </p>
          )}
        </nav>
        <ThemeToggle />
      </aside>

      <div className="main">
        <header className="header">
          <h2>
            {room.name}
            {activeThreadTitle ? ` — ${activeThreadTitle}` : ''}
          </h2>
        </header>

        <div className="messages">
          {messages.map((m) => {
            const sender = messageSenderLabel(m, messages, room, bootstrap.agents);
            return (
              <div key={m.id} className="msg">
                <time className="msg-time" dateTime={new Date(m.timestamp).toISOString()}>
                  {formatMessageTime(m.timestamp)}
                </time>
                <span className="msg-sender" style={{ color: senderColor(sender) }}>
                  {sender}
                </span>
                <div className="msg-text">
                  {m.attachments && m.attachments.length > 0 && (
                    <MessageAttachments attachments={m.attachments} />
                  )}
                  {m.text.trim() ? <FormattedMessage text={m.text} /> : null}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="composer">
          <div
            className={`composer-box${composerDragOver ? ' is-dragover' : ''}`}
            onDragOver={handleComposerDragOver}
            onDragLeave={handleComposerDragLeave}
            onDrop={handleComposerDrop}
          >
            {pendingAttachments.length > 0 && (
              <div className="composer-previews">
                {pendingAttachments.map((att, index) => (
                  <div
                    key={`${att.name}-${index}`}
                    className={`composer-preview${att.type === 'file' ? ' composer-preview-file' : ''}`}
                  >
                    {att.type === 'image' ? (
                      <img src={att.previewUrl} alt={att.name} />
                    ) : (
                      <span className="composer-preview-name" title={att.name}>
                        {att.name}
                      </span>
                    )}
                    <button
                      type="button"
                      className="composer-preview-remove"
                      aria-label={`Remove ${att.name}`}
                      onClick={() => handleRemovePendingAttachment(index)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="composer-input-row">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void addPendingFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="composer-attach"
                aria-label="Attach file"
                disabled={sending || pendingAttachments.length >= MAX_ATTACHMENTS}
                onClick={() => fileInputRef.current?.click()}
              >
                <PlusIcon />
              </button>
              <textarea
                ref={composerRef}
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  room.kind === 'lobby'
                    ? 'Message… use @folder to reach an agent (e.g. @sarah hello)'
                    : 'Message…'
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
              />
              <button
                type="button"
                className="composer-send"
                aria-label="Send message"
                disabled={!canSendMessage(token, room, draft, sending, pendingAttachments.length)}
                onClick={() => void handleSend()}
              >
                <SendArrowIcon />
              </button>
            </div>
          </div>
        </div>
        {error && <p className="error composer-error">{error}</p>}
      </div>
    </div>
  );
}
