import { useState } from 'react';
import type { WebChatAskQuestionCard, WebChatMessage } from './types';
import { submitAction } from './api';

interface InteractiveCardProps {
  message: WebChatMessage;
  token: string;
  onUpdated: (message: WebChatMessage) => void;
}

export function InteractiveCard({ message, token, onUpdated }: InteractiveCardProps) {
  const card = message.card;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!card) return null;

  const answered = card.status === 'answered';

  const handleSelect = async (value: string) => {
    setSubmitting(true);
    setError(null);
    const selectedOption = card.options.find((opt) => opt.value === value)!;
    const optimistic: WebChatMessage = {
      ...message,
      card: {
        ...card,
        status: 'answered',
        selectedValue: value,
        selectedLabel: selectedOption.selectedLabel ?? selectedOption.label,
      },
    };
    onUpdated(optimistic);
    try {
      await submitAction(token, message.platformId, message.threadId, card.questionId, value);
    } catch (err) {
      onUpdated(message);
      setError(err instanceof Error ? err.message : 'Action failed');
      setSubmitting(false);
    }
  };

  return (
    <div className={`interactive-card${answered ? ' interactive-card--answered' : ''}`}>
      <div className="interactive-card-title">{card.title}</div>
      <div className="interactive-card-question">{card.question}</div>
      {answered ? (
        <div className="interactive-card-selection">{card.selectedLabel ?? card.selectedValue}</div>
      ) : (
        <div className="interactive-card-actions">
          {card.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className="interactive-card-btn"
              disabled={submitting}
              onClick={() => void handleSelect(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      {error ? <div className="interactive-card-error">{error}</div> : null}
    </div>
  );
}

export function messageHasInteractiveCard(message: WebChatMessage): message is WebChatMessage & {
  card: WebChatAskQuestionCard;
} {
  return message.card?.type === 'ask_question';
}
