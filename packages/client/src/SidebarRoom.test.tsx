import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SidebarRoom, SidebarSection } from './SidebarRoom';
import type { WebChatRoom } from './types';

const lobby: WebChatRoom = { platformId: 'lobby-1', name: 'Lobby', kind: 'lobby' };
const dm: WebChatRoom = { platformId: 'dm-sarah', name: 'Sarah', kind: 'dm', folder: 'sarah' };
const inbox: WebChatRoom = { platformId: 'inbox', name: 'Inbox', kind: 'inbox' };

afterEach(() => {
  cleanup();
});

describe('SidebarRoom', () => {
  it('renders a spacer when the room has no child threads', () => {
    render(
      <SidebarRoom
        room={lobby}
        threads={[{ id: 'main', title: 'Main' }]}
        isActiveRoom
        activeThreadId="main"
        expanded={false}
        unreadCounts={{}}
        onToggleExpand={vi.fn()}
        onSelectMain={vi.fn()}
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onRenameThread={vi.fn()}
        onDeleteThread={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Lobby' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Expand threads/ })).not.toBeInTheDocument();
  });

  it('toggles thread expansion with the caret control', async () => {
    const onToggleExpand = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <SidebarRoom
        room={lobby}
        threads={[
          { id: 'main', title: 'Main' },
          { id: 'thread_b', title: 'Thread B' },
        ]}
        isActiveRoom
        activeThreadId="main"
        expanded={false}
        unreadCounts={{}}
        onToggleExpand={onToggleExpand}
        onSelectMain={vi.fn()}
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onRenameThread={vi.fn()}
        onDeleteThread={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Expand threads in Lobby' }));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);

    rerender(
      <SidebarRoom
        room={lobby}
        threads={[
          { id: 'main', title: 'Main' },
          { id: 'thread_b', title: 'Thread B' },
        ]}
        isActiveRoom
        activeThreadId="main"
        expanded
        unreadCounts={{}}
        onToggleExpand={onToggleExpand}
        onSelectMain={vi.fn()}
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onRenameThread={vi.fn()}
        onDeleteThread={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Collapse threads in Lobby' }));
    expect(onToggleExpand).toHaveBeenCalledTimes(2);
  });

  it('reverts an empty rename and cancels with Escape', async () => {
    const onRenameThread = vi.fn();
    const user = userEvent.setup();

    render(
      <SidebarRoom
        room={lobby}
        threads={[
          { id: 'main', title: 'Main' },
          { id: 'thread_b', title: 'Thread B' },
        ]}
        isActiveRoom
        activeThreadId="main"
        expanded
        unreadCounts={{}}
        onToggleExpand={vi.fn()}
        onSelectMain={vi.fn()}
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onRenameThread={onRenameThread}
        onDeleteThread={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Rename Thread B' }));
    const input = screen.getByLabelText('Thread name');
    await user.clear(input);
    await user.tab();

    expect(onRenameThread).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Thread B' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rename Thread B' }));
    await user.clear(screen.getByLabelText('Thread name'));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('button', { name: 'Thread B' })).toBeInTheDocument();
    expect(onRenameThread).not.toHaveBeenCalled();
  });

  it('uses the bot icon for direct-message rooms', () => {
    const { container } = render(
      <SidebarRoom
        room={dm}
        threads={[{ id: 'main', title: 'Main' }]}
        isActiveRoom
        activeThreadId="main"
        expanded={false}
        unreadCounts={{}}
        onToggleExpand={vi.fn()}
        onSelectMain={vi.fn()}
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onRenameThread={vi.fn()}
        onDeleteThread={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Sarah' })).toBeInTheDocument();
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
  });

  it('hides new-thread control for inbox rooms', () => {
    render(
      <SidebarRoom
        room={inbox}
        threads={[{ id: 'main', title: 'Main' }]}
        isActiveRoom
        activeThreadId="main"
        expanded={false}
        unreadCounts={{}}
        onToggleExpand={vi.fn()}
        onSelectMain={vi.fn()}
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onRenameThread={vi.fn()}
        onDeleteThread={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New thread in Inbox' })).not.toBeInTheDocument();
  });

  it('shows unread badges on room main and child threads', () => {
    render(
      <SidebarRoom
        room={lobby}
        threads={[
          { id: 'main', title: 'Main' },
          { id: 'thread_b', title: 'Thread B' },
        ]}
        isActiveRoom
        activeThreadId="main"
        expanded
        unreadCounts={{ 'lobby-1|main': 2, 'lobby-1|thread_b': 5 }}
        onToggleExpand={vi.fn()}
        onSelectMain={vi.fn()}
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onRenameThread={vi.fn()}
        onDeleteThread={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Lobby, 2 unread messages' })).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'Thread B, 5 unread messages' })).toHaveTextContent('5');
  });
});

describe('SidebarSection', () => {
  it('renders nothing when a section has no rooms', () => {
    const { container } = render(
      <SidebarSection
        label="Empty"
        rooms={[]}
        activeRoomId="lobby-1"
        activeThreadId="main"
        threadsByRoom={{}}
        expandedRooms={new Set()}
        unreadCounts={{}}
        onToggleExpand={vi.fn()}
        onSelectRoomMain={vi.fn()}
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onRenameThread={vi.fn()}
        onDeleteThread={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('falls back to a default main thread when room threads are missing', () => {
    render(
      <SidebarSection
        label="Rooms"
        rooms={[lobby]}
        activeRoomId="lobby-1"
        activeThreadId="main"
        threadsByRoom={{}}
        expandedRooms={new Set()}
        unreadCounts={{}}
        onToggleExpand={vi.fn()}
        onSelectRoomMain={vi.fn()}
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onRenameThread={vi.fn()}
        onDeleteThread={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Lobby' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Expand threads/ })).not.toBeInTheDocument();
  });

  it('wires room callbacks through the section wrapper', async () => {
    const onToggleExpand = vi.fn();
    const onSelectRoomMain = vi.fn();
    const user = userEvent.setup();

    render(
      <SidebarSection
        label="Rooms"
        rooms={[lobby]}
        activeRoomId="lobby-1"
        activeThreadId="main"
        threadsByRoom={{
          'lobby-1': [
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ],
        }}
        expandedRooms={new Set(['lobby-1'])}
        unreadCounts={{}}
        onToggleExpand={onToggleExpand}
        onSelectRoomMain={onSelectRoomMain}
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onRenameThread={vi.fn()}
        onDeleteThread={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Collapse threads in Lobby' }));
    expect(onToggleExpand).toHaveBeenCalledWith('lobby-1');

    await user.click(screen.getByRole('button', { name: 'Lobby' }));
    expect(onSelectRoomMain).toHaveBeenCalledWith(lobby);
  });
});
