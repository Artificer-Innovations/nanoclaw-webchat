import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canSendMessage,
  shouldAppendMessage,
} from './app-helpers';
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

export function App() {
  const [token, setToken] = useState(getStoredToken);
  const [tokenInput, setTokenInput] = useState(token);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<WebChatRoom | null>(null);
  const [threads, setThreads] = useState<ThreadMeta[]>([{ id: 'main', title: 'Main' }]);
  const [threadId, setThreadId] = useState('main');
  const [messages, setMessages] = useState<WebChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadBootstrap = useCallback(async (authToken: string) => {
    const data = await fetchBootstrap(authToken);
    setBootstrap(data);
    const lobby = data.rooms.find((r) => r.kind === 'lobby') ?? data.rooms[0] ?? null;
    setRoom(lobby);
    if (lobby) {
      const t = loadThreads(lobby.platformId);
      setThreads(t);
      setThreadId(t[0]?.id ?? 'main');
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    storeToken(token);
    loadBootstrap(token).catch((err: Error) => setError(err.message));
  }, [token, loadBootstrap]);

  useEffect(() => {
    if (!token || !room) return;
    const t = loadThreads(room.platformId);
    setThreads(t);
    setThreadId(t[0]?.id ?? 'main');
  }, [room?.platformId, token]);

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
      setMessages((prev) => {
        if (!shouldAppendMessage(prev, msg, room, threadId)) return prev;
        return [...prev, msg];
      });
    });
    return () => ws.close();
  }, [token, room, threadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const agentsHint = useMemo(() => {
    if (!bootstrap?.agents.length) return '';
    return bootstrap.agents.map((a) => a.mention).join(', ');
  }, [bootstrap]);

  const handleAuth = () => {
    const nextToken = tokenInput.trim();
    if (!nextToken) {
      setError('Token required');
      return;
    }
    setError(null);
    setToken(nextToken);
  };

  const handleSend = async () => {
    if (!canSendMessage(token, room, draft, sending)) return;
    setSending(true);
    setError(null);
    const text = draft.trim();
    setDraft('');
    const optimistic: WebChatMessage = {
      id: `local-${Date.now()}`,
      direction: 'inbound',
      text,
      timestamp: Date.now(),
      platformId: room.platformId,
      threadId,
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      await sendMessage(token, room.platformId, threadId, text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'send failed');
    } finally {
      setSending(false);
    }
  };

  const handleNewThread = () => {
    const activeRoom = room!;
    const id = newThreadId();
    const next = [...threads, { id, title: `Thread ${threads.length}` }];
    setThreads(next);
    saveThreads(activeRoom.platformId, next);
    setThreadId(id);
    setMessages([]);
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
        <h1>NanoClaw Chat</h1>
        <section>
          <h2>Rooms</h2>
          <ul className="room-list">
            {lobbyRooms.map((r) => (
              <li key={r.platformId}>
                <button
                  type="button"
                  className={room.platformId === r.platformId ? 'active' : ''}
                  onClick={() => setRoom(r)}
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Direct messages</h2>
          <ul className="room-list">
            {dmRooms.map((r) => (
              <li key={r.platformId}>
                <button
                  type="button"
                  className={room.platformId === r.platformId ? 'active' : ''}
                  onClick={() => setRoom(r)}
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
        {agentsHint && (
          <p className="hint">
            Lobby mentions: {agentsHint}
            {bootstrap.agents.some((a) => a.mention === '@team') ? ', @team' : ''}
          </p>
        )}
      </aside>

      <div className="main">
        <header className="header">
          <h2>{room.name}</h2>
          <button type="button" className="btn secondary" onClick={handleNewThread}>
            New thread
          </button>
        </header>

        <div className="threads-bar">
          <ul className="thread-list">
            {threads.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={threadId === t.id ? 'active' : ''}
                  onClick={() => setThreadId(t.id)}
                >
                  {t.title}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="messages">
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.direction}`}>
              <div className="meta">{m.direction === 'inbound' ? 'You' : 'Agent'}</div>
              {m.text}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="composer">
          <textarea
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
          <button type="button" disabled={sending || !draft.trim()} onClick={() => void handleSend()}>
            Send
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
