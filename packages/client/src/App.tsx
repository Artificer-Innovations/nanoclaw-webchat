import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  activeUnreadKey,
  applyLiveMessage,
  applyMessageUpdate,
  canSendMessage,
  clearUnread,
  getUnreadCount,
  DEFAULT_ROOM_THREADS,
  incrementUnread,
  isActiveConversation,
  markMessagesSeen,
  mergeUnreadDeltas,
  migrateLegacyThreads,
  mergeThreadsFromBootstrapRooms,
  reconcileOptimisticMessage,
  resolveActiveThreadTitle,
  seedSyncCursors,
  softMergeBootstrap,
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
  attachmentChipKind,
  attachmentChipLabel,
  attachmentIsAudio,
  attachmentIsTextPreviewable,
  attachmentIsVideo,
  formatAttachmentRejections,
  MAX_ATTACHMENTS,
  mergePendingAttachments,
  optimisticAttachmentsFromPending,
  readAttachmentFiles,
  removePendingAtIndex,
  revokeAttachmentPreviews,
  toSendAttachmentsFromUploads,
  uploadPendingAttachments,
  type PendingAttachment,
} from './attachments';
import { isNearBottom, scrollToBottom, scrollToUnreadAnchor } from './chat-scroll';
import { AttachmentDrawer } from './AttachmentDrawer';
import { MessageAttachments } from './MessageAttachments';
import { formatMessageTime } from './format-message-time';
import { FormattedMessage } from './FormattedMessage';
import { InteractiveCard, messageHasInteractiveCard } from './InteractiveCard';
import { engagedStateAfterSend, messageSenderLabel } from './message-sender';
import { SendArrowIcon, PlusIcon, SidebarHideIcon, SidebarShowIcon } from './nav-icons';
import { senderColor } from './sender-color';
import { SidebarSection } from './SidebarRoom';
import { ThemeToggle } from './ThemeToggle';
import {
  ComposerAudioPreview,
  ComposerImagePreview,
  ComposerVideoPreview,
  composerPreviewClassName,
} from './VideoAttachmentPreview';
import {
  getStoredAttachmentDrawerWidth,
  setStoredAttachmentDrawerWidth,
} from './attachment-drawer-layout';
import {
  clampDrawerWidthForLayout,
  clampSidebarWidthForLayout,
  maxDrawerWidthForLayout,
  reconcilePanelWidths,
} from './panel-layout';
import {
  getStoredSidebarCollapsed,
  getStoredSidebarWidth,
  setStoredSidebarCollapsed,
  setStoredSidebarWidth,
  sidebarWidthFromDrag,
  sidebarWidthFromKeyboard,
} from './sidebar-layout';
import { defaultThreadTitle, isAutoThreadTitle, titleFromMessage } from './thread-names';
import type { BootstrapPayload, ThreadMeta, WebChatAttachment, WebChatMessage, WebChatRoom } from './types';
import { Login } from './Login';
import {
  connectWebSocket,
  consumeStashedReturnTo,
  createThread,
  deleteThread,
  detectPublicAuthMode,
  disengageAgent,
  fetchAuthMe,
  fetchBootstrap,
  fetchMessages,
  getReturnToParam,
  getStoredToken,
  isLocalTokenMode,
  logoutSession,
  redirectToReturnTo,
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
  const localToken = getStoredToken();
  const hasMetaToken = isLocalTokenMode();
  const [authMode, setAuthMode] = useState<'loading' | 'local' | 'public'>(hasMetaToken ? 'local' : 'loading');
  const [publicAuthed, setPublicAuthed] = useState<boolean | null>(hasMetaToken ? true : null);
  const authToken = authMode === 'local' ? localToken : '';
  const sessionReady = authMode === 'local' ? Boolean(localToken) : publicAuthed === true;
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<WebChatRoom | null>(null);
  const [threadsByRoom, setThreadsByRoom] = useState<Record<string, ThreadMeta[]>>({});
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(() => new Set());
  const [threadId, setThreadId] = useState('main');
  const [messages, setMessages] = useState<WebChatMessage[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [engagedAgentsByThread, setEngagedAgentsByThread] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [composerDragOver, setComposerDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<WebChatAttachment | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(getStoredSidebarWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed);
  const [drawerWidth, setDrawerWidth] = useState(getStoredAttachmentDrawerWidth);
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const pendingScrollUnreadRef = useRef(0);
  const resizeFrameRef = useRef<number | null>(null);
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
  const disengagingRef = useRef(new Set<string>());
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
    setEngagedAgentsByThread({});
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
        authToken,
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
  }, [authToken, bootstrap]);

  useEffect(() => {
    if (hasMetaToken) return;
    void detectPublicAuthMode()
      .then((isPublic) => {
        setAuthMode(isPublic ? 'public' : 'local');
        if (!isPublic) setPublicAuthed(null);
      })
      .catch(() => setAuthMode('local'));
  }, [hasMetaToken]);

  useEffect(() => {
    if (authMode !== 'public') return;
    void fetchAuthMe()
      .then((me) => {
        if (me != null) {
          const stashed = consumeStashedReturnTo();
          if (redirectToReturnTo(stashed)) return;
          if (redirectToReturnTo(getReturnToParam())) return;
        }
        setPublicAuthed(me != null);
      })
      .catch(() => setPublicAuthed(false));
  }, [authMode]);

  useEffect(() => {
    if (!sessionReady) return;
    if (authMode === 'local' && localToken) storeToken(localToken);
    loadBootstrap(authToken).catch((err: Error) => setError(err.message));
  }, [sessionReady, authToken, authMode, localToken, loadBootstrap]);

  useEffect(() => {
    if (!room) return;
    setExpandedRooms((prev) => new Set(prev).add(room.platformId));
  }, [room?.platformId]);

  useEffect(() => {
    if (!sessionReady || !room) return;
    let cancelled = false;
    fetchMessages(authToken, room.platformId, threadId)
      .then(({ messages: msgs, engagedAgents }) => {
        if (!cancelled) {
          setMessages(msgs);
          if (room.kind === 'lobby') {
            setEngagedAgentsByThread((prev) => ({
              ...prev,
              [unreadKey(room.platformId, threadId)]: engagedAgents,
            }));
          }
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
  }, [authToken, room, threadId, sessionReady]);

  useEffect(() => {
    if (!sessionReady || !bootstrap) return;
    const connection = connectWebSocket(
      authToken,
      (event) => {
        if (event.type === 'engaged') {
          setEngagedAgentsByThread((prev) => ({
            ...prev,
            [unreadKey(event.platformId, event.threadId)]: event.agents,
          }));
          return;
        }
        if (event.type === 'message_update') {
          const msg = event.message;
          if (isActiveConversation(msg, roomRef.current, threadIdRef.current)) {
            setMessages((prev) =>
              applyMessageUpdate(prev, msg, roomRef.current, threadIdRef.current),
            );
          }
          return;
        }
        if (event.type === 'bootstrap') {
          const next = event.bootstrap;
          // WS connects only after bootstrap is loaded, so prev is always set here.
          setBootstrap((prev) => softMergeBootstrap(prev!, next));
          setThreadsByRoom((prev) => mergeThreadsFromBootstrapRooms(prev, next.rooms));
          syncCursorRef.current = seedSyncCursors(
            syncCursorRef.current,
            next.rooms,
            threadsMapFromRooms(next.rooms),
          );
          return;
        }
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
  }, [authToken, bootstrap, syncInactiveRooms, sessionReady]);

  useEffect(() => {
    if (!sessionReady || !bootstrap) return;
    void syncInactiveRooms();
    const id = setInterval(() => {
      if (skipNextIntervalSyncRef.current) {
        skipNextIntervalSyncRef.current = false;
        return;
      }
      void syncInactiveRooms();
    }, 5000);
    return () => clearInterval(id);
  }, [authToken, bootstrap, syncInactiveRooms, sessionReady]);

  const drawerOpen = selectedAttachment != null;

  const applyPanelLayout = useCallback(() => {
    const viewportWidth = window.innerWidth;
    const result = reconcilePanelWidths({
      viewportWidth,
      sidebarWidth,
      drawerWidth,
      sidebarCollapsed,
      drawerOpen,
    });
    if (!sidebarCollapsed && result.sidebarWidth !== sidebarWidth) {
      setSidebarWidth(result.sidebarWidth);
      setStoredSidebarWidth(result.sidebarWidth);
    }
    if (drawerOpen && result.drawerWidth !== drawerWidth) {
      setDrawerWidth(result.drawerWidth);
      setStoredAttachmentDrawerWidth(result.drawerWidth);
    }
  }, [sidebarWidth, drawerWidth, sidebarCollapsed, drawerOpen]);

  useEffect(() => {
    const onResize = () => {
      if (resizeFrameRef.current != null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        applyPanelLayout();
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (resizeFrameRef.current != null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
    };
  }, [applyPanelLayout]);

  useEffect(() => {
    applyPanelLayout();
  }, [drawerOpen, sidebarCollapsed, applyPanelLayout]);

  useLayoutEffect(() => {
    const el = messagesRef.current;
    if (!el || messages.length === 0) return;
    const unread = pendingScrollUnreadRef.current;
    if (unread > 0) {
      scrollToUnreadAnchor(el, unread);
      pendingScrollUnreadRef.current = 0;
      stickToBottomRef.current = false;
      return;
    }
    if (stickToBottomRef.current) {
      scrollToBottom(el);
    }
  }, [messages, room?.platformId, threadId]);

  const handleMessagesScroll = useCallback(() => {
    stickToBottomRef.current = isNearBottom(messagesRef.current);
  }, []);

  const persistSidebarWidth = useCallback(
    (nextWidth: number) => {
      const clamped = clampSidebarWidthForLayout(
        nextWidth,
        window.innerWidth,
        drawerWidth,
        drawerOpen,
      );
      setSidebarWidth(clamped);
      setStoredSidebarWidth(clamped);
    },
    [drawerWidth, drawerOpen],
  );

  const persistDrawerWidth = useCallback(
    (nextWidth: number) => {
      const clamped = clampDrawerWidthForLayout(
        nextWidth,
        window.innerWidth,
        sidebarCollapsed ? 0 : sidebarWidth,
        sidebarCollapsed,
      );
      setDrawerWidth(clamped);
      setStoredAttachmentDrawerWidth(clamped);
    },
    [sidebarCollapsed, sidebarWidth],
  );

  const handleHideSidebar = useCallback(() => {
    setSidebarCollapsed(true);
    setStoredSidebarCollapsed(true);
  }, []);

  const handleShowSidebar = useCallback(() => {
    setSidebarCollapsed(false);
    setStoredSidebarCollapsed(false);
  }, []);

  const handleSidebarResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const nextWidth = sidebarWidthFromKeyboard(sidebarWidth, event.key);
      if (nextWidth == null) return;
      event.preventDefault();
      persistSidebarWidth(nextWidth);
    },
    [persistSidebarWidth, sidebarWidth],
  );

  const clampSidebarDragWidth = useCallback(
    (rawWidth: number) =>
      clampSidebarWidthForLayout(rawWidth, window.innerWidth, drawerWidth, drawerOpen),
    [drawerWidth, drawerOpen],
  );

  const handleSidebarResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      let lastClientX = startX;
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('sidebar-resizing');

      const onPointerMove = (moveEvent: PointerEvent) => {
        lastClientX = moveEvent.clientX;
        setSidebarWidth(
          clampSidebarDragWidth(sidebarWidthFromDrag(startWidth, startX, lastClientX)),
        );
      };

      const cleanupResize = () => {
        handle.releasePointerCapture(event.pointerId);
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', onPointerUp);
        handle.removeEventListener('pointercancel', onPointerCancel);
        document.body.classList.remove('sidebar-resizing');
      };

      const onPointerUp = () => {
        cleanupResize();
        persistSidebarWidth(sidebarWidthFromDrag(startWidth, startX, lastClientX));
      };

      const onPointerCancel = () => {
        cleanupResize();
        setSidebarWidth(startWidth);
        persistSidebarWidth(startWidth);
      };

      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerCancel);
    },
    [clampSidebarDragWidth, persistSidebarWidth, sidebarWidth],
  );

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
    setSelectedAttachment(null);
  }, [room?.platformId, threadId]);

  const handleCloseAttachment = useCallback(() => {
    setSelectedAttachment(null);
  }, []);

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

  const engagedFolders = useMemo(() => {
    if (!room || room.kind !== 'lobby') return [];
    return engagedAgentsByThread[unreadKey(room.platformId, threadId)] ?? [];
  }, [room, threadId, engagedAgentsByThread]);

  const hasEngagedAgents = engagedFolders.length > 0;

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

  const handleDisengageAgent = async (agentFolder: string) => {
    const activeRoom = room!;
    const key = unreadKey(activeRoom.platformId, threadId);
    const inFlightKey = `${key}|${agentFolder}`;
    if (disengagingRef.current.has(inFlightKey)) return;
    disengagingRef.current.add(inFlightKey);
    const prior = engagedFolders;
    setEngagedAgentsByThread((prev) => ({
      ...prev,
      [key]: prior.filter((folder) => folder !== agentFolder),
    }));
    try {
      const agents = await disengageAgent(authToken, activeRoom.platformId, threadId, agentFolder);
      setEngagedAgentsByThread((prev) => ({ ...prev, [key]: agents }));
    } catch (err) {
      setEngagedAgentsByThread((prev) => ({ ...prev, [key]: prior }));
      setError(err instanceof Error ? err.message : 'Failed to remove agent');
    } finally {
      disengagingRef.current.delete(inFlightKey);
    }
  };

  const handleSend = async () => {
    if (!canSendMessage(sessionReady, room, draft, sending, pendingAttachments.length)) return;
    setSending(true);
    setError(null);
    const text = draft.trim();
    const pending = pendingAttachments;
    const hadNoMessages = messages.length === 0;
    const activeRoom = room;
    const activeThread = threadId;
    const activeThreads = threadsFromState(threadsByRoom, activeRoom.platformId);

    let sendAttachments: ReturnType<typeof toSendAttachmentsFromUploads> = [];
    if (pending.length > 0) {
      const { uploads, failed } = await uploadPendingAttachments(
        authToken,
        activeRoom.platformId,
        activeThread,
        pending,
      );
      const rejectionMessage = formatAttachmentRejections(failed);
      if (rejectionMessage) {
        setError(rejectionMessage);
        setSending(false);
        return;
      }
      sendAttachments = toSendAttachmentsFromUploads(uploads);
    }

    setDraft('');

    const optimisticId = `local-${Date.now()}`;
    const optimistic: WebChatMessage = {
      id: optimisticId,
      direction: 'inbound',
      text,
      timestamp: Date.now(),
      platformId: activeRoom.platformId,
      threadId: activeThread,
      ...(bootstrap?.user
        ? { senderName: bootstrap.user.displayName, senderId: bootstrap.user.id }
        : {}),
      ...(pending.length > 0 ? { attachments: optimisticAttachmentsFromPending(pending) } : {}),
    };
    setMessages((prev) => [...prev, optimistic]);
    const lobbyEngagedKey =
      activeRoom.kind === 'lobby' && bootstrap?.agents.length
        ? unreadKey(activeRoom.platformId, activeThread)
        : null;
    const priorEngaged = lobbyEngagedKey ? [...engagedFolders] : null;
    if (lobbyEngagedKey) {
      setEngagedAgentsByThread((prev) =>
        engagedStateAfterSend(prev, lobbyEngagedKey, text, bootstrap!.agents),
      );
    }
    const threadKey = unreadKey(activeRoom.platformId, activeThread);
    pendingOptimisticByThreadRef.current[threadKey] = [
      ...(pendingOptimisticByThreadRef.current[threadKey] ?? []),
      optimisticId,
    ];
    try {
      const sent = await sendMessage(
        authToken,
        activeRoom.platformId,
        activeThread,
        text,
        sendAttachments.length > 0 ? sendAttachments : undefined,
      );
      setMessages((prev) => reconcileOptimisticMessage(prev, optimisticId, sent));
      revokeAttachmentPreviews(pending);
      setPendingAttachments([]);
      dropPendingOptimisticId(
        pendingOptimisticByThreadRef.current,
        activeRoom.platformId,
        activeThread,
        optimisticId,
      );
      trackSeenMessageId(seenMessageIdsRef.current, sent.messageId);
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
            await renameThread(authToken, activeRoom.platformId, activeThread, autoTitle);
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
      if (lobbyEngagedKey && priorEngaged) {
        setEngagedAgentsByThread((prev) => ({ ...prev, [lobbyEngagedKey]: priorEngaged }));
      }
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
    pendingScrollUnreadRef.current = getUnreadCount(unreadCounts, targetRoom.platformId, 'main');
    stickToBottomRef.current = pendingScrollUnreadRef.current <= 0;
    roomRef.current = targetRoom;
    threadIdRef.current = 'main';
    setMessages([]);
    setUnreadCounts((counts) => clearUnread(counts, targetRoom.platformId, 'main'));
    setRoom(targetRoom);
    setThreadId('main');
  };

  const handleSelectThread = (targetRoom: WebChatRoom, nextThreadId: string) => {
    pendingScrollUnreadRef.current = getUnreadCount(unreadCounts, targetRoom.platformId, nextThreadId);
    stickToBottomRef.current = pendingScrollUnreadRef.current <= 0;
    roomRef.current = targetRoom;
    threadIdRef.current = nextThreadId;
    setMessages([]);
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
      const created = await createThread(authToken, targetRoom.platformId, title);
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
      await renameThread(authToken, targetRoom.platformId, thread.id, trimmed);
      updateThreadsForRoom(targetRoom.platformId, (list) =>
        list.map((t) => (t.id === thread.id ? { ...t, title: trimmed } : t)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'rename thread failed');
    }
  };

  const handleDeleteThread = async (targetRoom: WebChatRoom, thread: ThreadMeta) => {
    try {
      await deleteThread(authToken, targetRoom.platformId, thread.id);
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

  const handleLogout = useCallback(async () => {
    try {
      await logoutSession();
    } catch {
      // still return to login if the network call fails
    }
    setBootstrap(null);
    setRoom(null);
    setMessages([]);
    setThreadsByRoom({});
    setUnreadCounts({});
    setEngagedAgentsByThread({});
    setError(null);
    setPublicAuthed(false);
  }, []);

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

  if (authMode === 'loading') {
    return (
      <div className="auth-screen">
        <p className="hint">Connecting…</p>
      </div>
    );
  }

  if (authMode === 'public' && !publicAuthed) {
    return (
      <Login
        onSuccess={() => {
          if (redirectToReturnTo(getReturnToParam())) return;
          setPublicAuthed(true);
        }}
      />
    );
  }

  if (authMode === 'local' && !localToken) {
    return (
      <div className="auth-screen">
        <h1>NanoClaw Web Chat</h1>
        <p className="hint">
          Open this UI from the NanoClaw webchat server (for example http://127.0.0.1:3200).
        </p>
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

  const inboxRooms = bootstrap.rooms.filter((r) => r.kind === 'inbox');
  const lobbyRooms = bootstrap.rooms.filter((r) => r.kind === 'lobby');
  const dmRooms = bootstrap.rooms.filter((r) => r.kind === 'dm');
  const drawerMaxWidth = maxDrawerWidthForLayout(
    window.innerWidth,
    sidebarCollapsed ? 0 : sidebarWidth,
    sidebarCollapsed,
  );
  const layoutStyle = {
    '--sidebar-width': sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
  } as CSSProperties;

  return (
    <div
      className={`layout${sidebarCollapsed ? ' layout--sidebar-collapsed' : ''}`}
      style={layoutStyle}
    >
      <aside className={`sidebar${sidebarCollapsed ? ' sidebar--collapsed' : ''}`}>
        <header className="sidebar-header">
          <h1>NanoClaw</h1>
          <button
            type="button"
            className="sidebar-hide-btn"
            aria-label="Hide sidebar"
            onClick={handleHideSidebar}
          >
            <SidebarHideIcon />
          </button>
        </header>
        <nav className="sidebar-nav">
          {inboxRooms.length > 0 ? (
            <SidebarSection label="Inbox" rooms={inboxRooms} {...sidebarSectionProps} />
          ) : null}
          <SidebarSection label="Rooms" rooms={lobbyRooms} {...sidebarSectionProps} />
          <SidebarSection label="Direct messages" rooms={dmRooms} {...sidebarSectionProps} />
          {agentsHint && (
            <p className="hint">
              Lobby mentions: {agentsHint}
              {bootstrap.agents.some((a) => a.mention === '@team') ? ', @team' : ''}
            </p>
          )}
        </nav>
        <div className="sidebar-footer">
          <ThemeToggle />
          {authMode === 'public' ? (
            <button type="button" className="sidebar-logout-btn" onClick={() => void handleLogout()}>
              Sign out
            </button>
          ) : null}
        </div>
        {!sidebarCollapsed ? (
          <div
            className="sidebar-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            aria-valuemin={180}
            aria-valuemax={Math.round(window.innerWidth * 0.5)}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            onKeyDown={handleSidebarResizeKeyDown}
            onPointerDown={handleSidebarResizePointerDown}
          />
        ) : null}
      </aside>

      <div className={`main${selectedAttachment ? ' main--drawer-open' : ''}`}>
        {sidebarCollapsed ? (
          <button
            type="button"
            className="sidebar-show-btn"
            aria-label="Show sidebar"
            onClick={handleShowSidebar}
          >
            <SidebarShowIcon />
          </button>
        ) : null}
        <div className="main-body">
          <div className="chat-column">
            <header className="header">
              <h2>
                {room.name}
                {activeThreadTitle ? ` — ${activeThreadTitle}` : ''}
              </h2>
            </header>

            <div className="messages" ref={messagesRef} onScroll={handleMessagesScroll}>
              {messages.map((m) => {
                const sender = messageSenderLabel(m, messages, room, bootstrap.agents, bootstrap.user);
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
                        <MessageAttachments
                          attachments={m.attachments}
                          onOpenAttachment={setSelectedAttachment}
                        />
                      )}
                      {messageHasInteractiveCard(m) ? (
                        <InteractiveCard
                          message={m}
                          token={authToken}
                          onUpdated={(updated) => {
                            setMessages((prev) =>
                              applyMessageUpdate(prev, updated, room, threadId),
                            );
                          }}
                        />
                      ) : null}
                      {m.text.trim() && !messageHasInteractiveCard(m) ? (
                        <FormattedMessage text={m.text} />
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="composer">
              {room?.kind === 'inbox' ? (
                <p className="composer-inbox-hint">Approvals and system notifications appear here. Reply in Lobby or a direct message.</p>
              ) : (
              <div
                className={`composer-box${composerDragOver ? ' is-dragover' : ''}`}
                onDragOver={handleComposerDragOver}
                onDragLeave={handleComposerDragLeave}
                onDrop={handleComposerDrop}
              >
                {hasEngagedAgents && (
                  <div className="composer-engaged-chips">
                    {engagedFolders.map((folder) => {
                      const name =
                        bootstrap?.agents.find((a) => a.folder === folder)?.name ?? folder;
                      return (
                        <span key={folder} className="composer-engaged-chip">
                          {name}
                          <button
                            type="button"
                            className="composer-engaged-chip-remove"
                            aria-label={`Stop ${name} from listening`}
                            onClick={() => void handleDisengageAgent(folder)}
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                {pendingAttachments.length > 0 && (
                  <div className="composer-previews">
                    {pendingAttachments.map((att, index) => (
                      <div
                        key={`${att.name}-${index}`}
                        className={composerPreviewClassName(att)}
                      >
                        {att.type === 'image' ? (
                          <ComposerImagePreview
                            previewUrl={att.previewUrl}
                            mimeType={att.mimeType}
                            name={att.name}
                          />
                        ) : attachmentIsVideo(att.mimeType) ? (
                          <ComposerVideoPreview
                            previewUrl={att.previewUrl}
                            mimeType={att.mimeType}
                            name={att.name}
                          />
                        ) : attachmentIsAudio(att.mimeType) ? (
                          <ComposerAudioPreview
                            previewUrl={att.previewUrl}
                            mimeType={att.mimeType}
                            name={att.name}
                          />
                        ) : attachmentIsTextPreviewable(att.mimeType, att.name) ? (
                          <div className="composer-preview-text-wrap">
                            <span className="composer-preview-kind">
                              {attachmentChipLabel(attachmentChipKind(att.mimeType, att.name))}
                            </span>
                            <span className="composer-preview-name" title={att.name}>
                              {att.name}
                            </span>
                            {att.textSnippet ? (
                              <span className="composer-preview-snippet" title={att.textSnippet}>
                                {att.textSnippet}
                              </span>
                            ) : null}
                          </div>
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
                        ? hasEngagedAgents
                          ? "Message… agents you've @'d keep listening in this thread"
                          : 'Message… use @folder to reach an agent (e.g. @sarah hello)'
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
                    disabled={!canSendMessage(sessionReady, room, draft, sending, pendingAttachments.length)}
                    onClick={() => void handleSend()}
                  >
                    <SendArrowIcon />
                  </button>
                </div>
              </div>
              )}
            </div>
            {error && <p className="error composer-error">{error}</p>}
          </div>
          {selectedAttachment ? (
            <AttachmentDrawer
              attachment={selectedAttachment}
              token={authToken}
              width={drawerWidth}
              maxWidth={drawerMaxWidth}
              onWidthChange={persistDrawerWidth}
              onClose={handleCloseAttachment}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
