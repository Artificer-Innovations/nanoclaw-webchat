import { useState } from 'react';
import type { ThreadMeta } from './api';
import { formatUnreadCount, formatUnreadAriaLabel, getUnreadCount } from './app-helpers';
import {
  BotIcon,
  CaretDownIcon,
  CaretRightIcon,
  DoorIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from './nav-icons';
import type { WebChatRoom } from './types';

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="nav-unread-badge" aria-hidden="true">
      {formatUnreadCount(count)}
    </span>
  );
}

interface SidebarRoomProps {
  room: WebChatRoom;
  threads: ThreadMeta[];
  unreadCounts: Record<string, number>;
  isActiveRoom: boolean;
  activeThreadId: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onSelectMain: () => void;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  onRenameThread: (thread: ThreadMeta, title: string) => void;
  onDeleteThread: (thread: ThreadMeta) => void;
}

function RoomIcon({ kind }: { kind: WebChatRoom['kind'] }) {
  return kind === 'lobby' ? <DoorIcon /> : <BotIcon />;
}

function ThreadRow({
  thread,
  active,
  unreadCount,
  onSelect,
  onRename,
  onDelete,
}: {
  thread: ThreadMeta;
  active: boolean;
  unreadCount: number;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title);

  const commitRename = () => {
    const next = draft.trim();
    if (next && next !== thread.title) onRename(next);
    else setDraft(thread.title);
    setEditing(false);
  };

  const threadAriaLabel = formatUnreadAriaLabel(thread.title, unreadCount);

  return (
    <li className="nav-thread-row">
      {editing ? (
        <input
          className="nav-thread-rename"
          value={draft}
          aria-label="Thread name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitRename();
            }
            if (e.key === 'Escape') {
              setDraft(thread.title);
              setEditing(false);
            }
          }}
          autoFocus
        />
      ) : (
        <button
          type="button"
          aria-label={threadAriaLabel}
          className={`nav-thread-item${active ? ' active' : ''}`}
          onClick={onSelect}
        >
          <span className="nav-thread-item-label">{thread.title}</span>
          <UnreadBadge count={unreadCount} />
        </button>
      )}
      {!editing && (
        <button
          type="button"
          className="nav-thread-rename-btn"
          aria-label={`Rename ${thread.title}`}
          onClick={(e) => {
            e.stopPropagation();
            setDraft(thread.title);
            setEditing(true);
          }}
        >
          <PencilIcon />
        </button>
      )}
      <button
        type="button"
        className="nav-thread-delete"
        aria-label={`Delete ${thread.title}`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <TrashIcon />
      </button>
    </li>
  );
}

export function SidebarRoom({
  room,
  threads,
  unreadCounts,
  isActiveRoom,
  activeThreadId,
  expanded,
  onToggleExpand,
  onSelectMain,
  onSelectThread,
  onNewThread,
  onRenameThread,
  onDeleteThread,
}: SidebarRoomProps) {
  const childThreads = threads.filter((t) => t.id !== 'main');
  const hasChildThreads = childThreads.length > 0;
  const roomActive = isActiveRoom && activeThreadId === 'main';
  const mainUnread = getUnreadCount(unreadCounts, room.platformId, 'main');
  const roomAriaLabel = formatUnreadAriaLabel(room.name, mainUnread);

  return (
    <div className="nav-room">
      <div className="nav-room-header">
        {hasChildThreads ? (
          <button
            type="button"
            className="nav-room-caret"
            aria-label={expanded ? `Collapse threads in ${room.name}` : `Expand threads in ${room.name}`}
            aria-expanded={expanded}
            onClick={onToggleExpand}
          >
            {expanded ? <CaretDownIcon /> : <CaretRightIcon />}
          </button>
        ) : (
          <span className="nav-room-caret-spacer" aria-hidden="true" />
        )}
        <button
          type="button"
          aria-label={roomAriaLabel}
          className={`nav-item nav-room-item${roomActive ? ' active' : ''}`}
          onClick={onSelectMain}
        >
          <span className="nav-item-icon">
            <RoomIcon kind={room.kind} />
          </span>
          <span className="nav-item-label">{room.name}</span>
          <UnreadBadge count={mainUnread} />
        </button>
        <button
          type="button"
          className="nav-room-add"
          aria-label={`New thread in ${room.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onNewThread();
          }}
        >
          <PlusIcon />
        </button>
      </div>
      {hasChildThreads && expanded && (
        <ul className="nav-thread-list">
          {childThreads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              active={isActiveRoom && activeThreadId === thread.id}
              unreadCount={getUnreadCount(unreadCounts, room.platformId, thread.id)}
              onSelect={() => onSelectThread(thread.id)}
              onRename={(title) => onRenameThread(thread, title)}
              onDelete={() => onDeleteThread(thread)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface SidebarSectionProps {
  label: string;
  rooms: WebChatRoom[];
  activeRoomId: string | undefined;
  activeThreadId: string;
  unreadCounts: Record<string, number>;
  threadsByRoom: Record<string, ThreadMeta[]>;
  expandedRooms: Set<string>;
  onToggleExpand: (platformId: string) => void;
  onSelectRoomMain: (room: WebChatRoom) => void;
  onSelectThread: (room: WebChatRoom, threadId: string) => void;
  onNewThread: (room: WebChatRoom) => void;
  onRenameThread: (room: WebChatRoom, thread: ThreadMeta, title: string) => void;
  onDeleteThread: (room: WebChatRoom, thread: ThreadMeta) => void;
}

export function SidebarSection({
  label,
  rooms,
  activeRoomId,
  activeThreadId,
  unreadCounts,
  threadsByRoom,
  expandedRooms,
  onToggleExpand,
  onSelectRoomMain,
  onSelectThread,
  onNewThread,
  onRenameThread,
  onDeleteThread,
}: SidebarSectionProps) {
  if (rooms.length === 0) return null;

  return (
    <div className="nav-section">
      <span className="nav-section-label">{label}</span>
      {rooms.map((room) => (
        <SidebarRoom
          key={room.platformId}
          room={room}
          unreadCounts={unreadCounts}
          threads={threadsByRoom[room.platformId] ?? [{ id: 'main', title: 'Main' }]}
          isActiveRoom={activeRoomId === room.platformId}
          activeThreadId={activeThreadId}
          expanded={expandedRooms.has(room.platformId)}
          onToggleExpand={() => onToggleExpand(room.platformId)}
          onSelectMain={() => onSelectRoomMain(room)}
          onSelectThread={(threadId) => onSelectThread(room, threadId)}
          onNewThread={() => onNewThread(room)}
          onRenameThread={(thread, title) => onRenameThread(room, thread, title)}
          onDeleteThread={(thread) => onDeleteThread(room, thread)}
        />
      ))}
    </div>
  );
}
