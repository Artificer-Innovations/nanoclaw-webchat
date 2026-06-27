import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractiveCard, messageHasInteractiveCard } from './InteractiveCard';
import type { WebChatMessage } from './types';

vi.mock('./api', () => ({
  submitAction: vi.fn(() => Promise.resolve()),
}));

import { submitAction } from './api';

const baseMessage: WebChatMessage = {
  id: 'web-out-1',
  direction: 'outbound',
  text: 'Install MCP server',
  timestamp: 1000,
  platformId: 'inbox',
  threadId: 'main',
  card: {
    type: 'ask_question',
    questionId: 'approval-1',
    title: 'Install MCP server',
    question: 'Add memory server?',
    options: [
      { label: 'Approve', selectedLabel: '✅ Approved', value: 'approve' },
      { label: 'Reject', selectedLabel: '❌ Rejected', value: 'reject' },
    ],
    status: 'pending',
  },
};

describe('InteractiveCard', () => {
  beforeEach(() => {
    vi.mocked(submitAction).mockReset();
    vi.mocked(submitAction).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when message has no card', () => {
    const { container } = render(
      <InteractiveCard message={{ ...baseMessage, card: undefined }} token="secret" onUpdated={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('ignores clicks while a submission is in flight', async () => {
    let resolveSubmit: (() => void) | undefined;
    vi.mocked(submitAction).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const user = userEvent.setup();
    const onUpdated = vi.fn();
    render(<InteractiveCard message={baseMessage} token="secret" onUpdated={onUpdated} />);

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Reject' }));

    expect(submitAction).toHaveBeenCalledTimes(1);
    resolveSubmit?.();
    await waitFor(() => {
      expect(submitAction).toHaveBeenCalledTimes(1);
    });
  });

  it('uses selectedValue when answered card has no selectedLabel', () => {
    render(
      <InteractiveCard
        message={{
          ...baseMessage,
          card: {
            ...baseMessage.card!,
            status: 'answered',
            selectedValue: 'approve',
          },
        }}
        token="secret"
        onUpdated={vi.fn()}
      />,
    );

    expect(screen.getByText('approve')).toBeInTheDocument();
  });

  it('does not submit when the card is already answered', async () => {
    render(
      <InteractiveCard
        message={{
          ...baseMessage,
          card: { ...baseMessage.card!, status: 'answered', selectedLabel: 'Done' },
        }}
        token="secret"
        onUpdated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Done'));
    expect(submitAction).not.toHaveBeenCalled();
  });

  it('uses option label when selectedLabel is omitted', async () => {
    const onUpdated = vi.fn();
    render(
      <InteractiveCard
        message={{
          ...baseMessage,
          card: {
            ...baseMessage.card!,
            options: [{ label: 'Go', value: 'go' }],
          },
        }}
        token="secret"
        onUpdated={onUpdated}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          card: expect.objectContaining({ selectedLabel: 'Go' }),
        }),
      );
    });
  });

  it('shows generic error text for non-Error failures', async () => {
    vi.mocked(submitAction).mockRejectedValueOnce('nope');
    render(<InteractiveCard message={baseMessage} token="secret" onUpdated={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(screen.getByText('Action failed')).toBeInTheDocument();
    });
  });

  it('messageHasInteractiveCard requires ask_question type', () => {
    expect(messageHasInteractiveCard(baseMessage)).toBe(true);
    expect(messageHasInteractiveCard({ ...baseMessage, card: undefined })).toBe(false);
    expect(
      messageHasInteractiveCard({
        ...baseMessage,
        card: {
          type: 'ask_question',
          questionId: 'q',
          title: 't',
          question: 'q',
          options: [],
        },
      }),
    ).toBe(true);
    expect(
      messageHasInteractiveCard({
        ...baseMessage,
        card: {
          type: 'other',
          questionId: 'q',
          title: 't',
          question: 'q',
          options: [],
        } as unknown as WebChatMessage['card'],
      }),
    ).toBe(false);
  });

  it('renders pending options and submits selection', async () => {
    const onUpdated = vi.fn();
    render(<InteractiveCard message={baseMessage} token="secret" onUpdated={onUpdated} />);

    expect(screen.getByText('Install MCP server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(submitAction).toHaveBeenCalledWith('secret', 'inbox', 'main', 'approval-1', 'approve');
    });
    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        card: expect.objectContaining({ status: 'answered', selectedValue: 'approve' }),
      }),
    );
  });

  it('shows answered state without buttons', () => {
    render(
      <InteractiveCard
        message={{
          ...baseMessage,
          card: {
            ...baseMessage.card!,
            status: 'answered',
            selectedValue: 'reject',
            selectedLabel: '❌ Rejected',
          },
        }}
        token="secret"
        onUpdated={vi.fn()}
      />,
    );

    expect(screen.getByText('❌ Rejected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('restores card and shows error when submit fails', async () => {
    vi.mocked(submitAction).mockRejectedValueOnce(new Error('action failed: 409'));
    const onUpdated = vi.fn();
    render(<InteractiveCard message={baseMessage} token="secret" onUpdated={onUpdated} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    await waitFor(() => {
      expect(screen.getByText('action failed: 409')).toBeInTheDocument();
    });
    expect(onUpdated).toHaveBeenCalledWith(baseMessage);
  });
});
