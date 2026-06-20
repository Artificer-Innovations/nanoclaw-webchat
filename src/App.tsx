import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canSendMessage,
  clearUnread,
  incrementUnread,
  resolveActiveThreadTitle,
  shouldAppendMessage,
  threadsForRoom,
  threadsFromState,
} from './app-helpers';
import { formatMessageTime } from './format-message-time';
import { FormattedMessage } from './FormattedMessage';
import { messageSenderLabel } from './message-sender';
import { SendArrowIcon } from './nav-icons';
import { senderColor } from './sender-color';
import { SidebarSection } from './SidebarRoom';
import { ThemeToggle } from './ThemeToggle';
import { defaultThreadTitle, isAutoThreadTitle, titleFromMessage } from './thread-names';
import type { BootstrapPayload, WebChatMessage, WebChatRoom } from './types';
import {
  connectWebSocket,
  fetchBootstrap,
  fetchMessages,
  getStoredToken,
  loadThreads,
  newThreadId,
  saveThreads,
  sendMessage,
  storeToken,
  type ThreadMeta,
} from './api';

function buildThreadsMap(rooms: WebChatRoom[]): Record<string, ThreadMeta[]> {
  const map: Record<string, ThreadMeta[]> = {};
  for (const room of rooms) {
    map[room.platformId] = loadThreads(room.platformId);
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
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const roomRef = useRef(room);
  const threadIdRef = useRef(threadId);
  const seenMessageIdsRef = useRef(new Set<string>());
  roomRef.current = room;
  threadIdRef.current = threadId;

  const loadBootstrap = useCallback(async (authToken: string) => {
    const data = await fetchBootstrap(authToken);
    setBootstrap(data);
    setThreadsByRoom(buildThreadsMap(data.rooms));
    setUnreadCounts({});
    seenMessageIdsRef.current = new Set();
    const lobby = data.rooms.find((r) => r.kind === 'lobby') ?? data.rooms[0] ?? null;
    setRoom(lobby);
    setThreadId('main');
    if (lobby) {
      setExpandedRooms(new Set([lobby.platformId]));
    }
  }, []);

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
        if (!cancelled) setMessages(msgs);
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [token, room, threadId]);

  useEffect(() => {
    if (!token) return;
    const ws = connectWebSocket(token, (event) => {
      if (event.type !== 'message') return;
      const msg = event.message;
      const seenIds = seenMessageIdsRef.current;
      setMessages((prev) => {
        if (!shouldAppendMessage(prev, msg, roomRef.current, threadIdRef.current)) return prev;
        seenIds.add(msg.id);
        return [...prev, msg];
      });
      if (!shouldAppendMessage([], msg, roomRef.current, threadIdRef.current)) {
        setUnreadCounts((counts) => incrementUnread(counts, msg, seenIds));
      }
    });
    return () => ws.close();
  }, [token]);

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
  }, [draft, resizeComposer]);

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
        const current = threadsForRoom(prev, platformId, loadThreads);
        const next = updater(current);
        saveThreads(platformId, next);
        return { ...prev, [platformId]: next };
      });
    },
    [],
  );

  const handleSend = async () => {
    if (!canSendMessage(token, room, draft, sending)) return;
    setSending(true);
    setError(null);
    const text = draft.trim();
    const hadNoMessages = messages.length === 0;
    const activeRoom = room;
    const activeThread = threadId;
    const activeThreads = threadsFromState(threadsByRoom, activeRoom.platformId);
    setDraft('');
    const optimistic: WebChatMessage = {
      id: `local-${Date.now()}`,
      direction: 'inbound',
      text,
      timestamp: Date.now(),
      platformId: activeRoom.platformId,
      threadId: activeThread,
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      await sendMessage(token, activeRoom.platformId, activeThread, text);
      if (hadNoMessages && activeThread !== 'main') {
        const thread = activeThreads.find((t) => t.id === activeThread);
        if (thread && isAutoThreadTitle(thread.title)) {
          const autoTitle = titleFromMessage(text);
          updateThreadsForRoom(activeRoom.platformId, (list) =>
            list.map((t) => (t.id === activeThread ? { ...t, title: autoTitle } : t)),
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'send failed');
    } finally {
      setSending(false);
    }
  };

  const handleSelectRoomMain = (targetRoom: WebChatRoom) => {
    setUnreadCounts((counts) => clearUnread(counts, targetRoom.platformId, 'main'));
    setRoom(targetRoom);
    setThreadId('main');
  };

  const handleSelectThread = (targetRoom: WebChatRoom, nextThreadId: string) => {
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

  const handleNewThread = (targetRoom: WebChatRoom) => {
    const current = threadsForRoom(threadsByRoom, targetRoom.platformId, loadThreads);
    const id = newThreadId();
    const childCount = current.filter((t) => t.id !== 'main').length;
    const next = [...current, { id, title: defaultThreadTitle(childCount) }];
    saveThreads(targetRoom.platformId, next);
    setThreadsByRoom((prev) => ({ ...prev, [targetRoom.platformId]: next }));
    setExpandedRooms((prev) => new Set(prev).add(targetRoom.platformId));
    setRoom(targetRoom);
    setThreadId(id);
    setMessages([]);
  };

  const handleRenameThread = (targetRoom: WebChatRoom, thread: ThreadMeta, title: string) => {
    const trimmed = title.trim();
    updateThreadsForRoom(targetRoom.platformId, (list) =>
      list.map((t) => (t.id === thread.id ? { ...t, title: trimmed } : t)),
    );
  };

  const handleDeleteThread = (targetRoom: WebChatRoom, thread: ThreadMeta) => {
    updateThreadsForRoom(targetRoom.platformId, (list) => list.filter((t) => t.id !== thread.id));
    setUnreadCounts((counts) => clearUnread(counts, targetRoom.platformId, thread.id));
    if (room && room.platformId === targetRoom.platformId && threadId === thread.id) {
      setThreadId('main');
      setMessages([]);
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
                  <FormattedMessage text={m.text} />
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="composer">
          <div className="composer-box">
            <div className="composer-input-row">
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
                disabled={sending || !draft.trim()}
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
