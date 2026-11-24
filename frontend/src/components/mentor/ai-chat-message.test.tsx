import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AIChatMessage } from './ai-chat-message';

describe('AIChatMessage (Component 27)', () => {
  it('renders user sending state and failed_retryable state invoking retry with exact clientMessageId', () => {
    const onRetry = vi.fn();
    const clientMessageId = '11111111-1111-4111-8111-111111111111';

    const { rerender } = render(
      <AIChatMessage
        message={{
          id: `pending-${clientMessageId}`,
          role: 'user',
          content: 'SQL JOIN কীভাবে কাজ করে?',
          language: 'bn',
          created_at: '2026-11-24T09:00:00.000Z',
          clientMessageId,
          deliveryState: 'sending',
        }}
        onRetrySend={onRetry}
      />,
    );

    const textEl = screen.getByText('SQL JOIN কীভাবে কাজ করে?');
    expect(textEl).toHaveAttribute('dir', 'auto');
    expect(screen.getByRole('status')).toHaveTextContent(/Sending/i);

    rerender(
      <AIChatMessage
        message={{
          id: `pending-${clientMessageId}`,
          role: 'user',
          content: 'SQL JOIN কীভাবে কাজ করে?',
          language: 'bn',
          created_at: '2026-11-24T09:00:00.000Z',
          clientMessageId,
          deliveryState: 'failed_retryable',
          errorMessage: 'The AI request timed out. Your data is saved.',
        }}
        onRetrySend={onRetry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/timed out/i);
    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    expect(retryBtn).toBeEnabled();
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(clientMessageId);

    // Cooldown disables retry button and displays countdown
    rerender(
      <AIChatMessage
        message={{
          id: `pending-${clientMessageId}`,
          role: 'user',
          content: 'SQL JOIN কীভাবে কাজ করে?',
          language: 'bn',
          created_at: '2026-11-24T09:00:00.000Z',
          clientMessageId,
          deliveryState: 'failed_retryable',
          errorMessage: 'Rate limit reached.',
          retryCooldownSeconds: 25,
        }}
        onRetrySend={onRetry}
      />,
    );

    const cooldownBtn = screen.getByRole('button', { name: /Retry in 25s/i });
    expect(cooldownBtn).toBeDisabled();
  });

  it('renders assistant message with learning_claim_recorded note and zero rating/report controls (R34)', () => {
    render(
      <AIChatMessage
        message={{
          id: 'asst-1',
          role: 'assistant',
          content: 'Great work reviewing indexes! Complete a practice quiz to verify mastery.',
          language: 'mixed',
          created_at: '2026-11-24T09:01:00.000Z',
          learningClaimRecorded: true,
        }}
      />,
    );

    const article = screen.getByTestId('chat-message-assistant-asst-1');
    expect(article).toHaveAttribute('data-variant', 'assistant');
    expect(
      screen.getByText(/Great work reviewing indexes/i),
    ).toHaveAttribute('dir', 'auto');
    expect(screen.getByRole('note')).toHaveTextContent(
      /Recorded as conversation context only.*practice quiz/i,
    );
    expect(screen.queryByText(/Bangla|English|Mixed/i)).not.toBeInTheDocument();

    // R34: strictly zero rating, thumbs, or report buttons on mentor messages
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByLabelText(/thumb|rate|report|flag/i)).not.toBeInTheDocument();
  });

  it('renders safety_redirection variant when safetyMode is true', () => {
    render(
      <AIChatMessage
        message={{
          id: 'asst-safety-1',
          role: 'assistant',
          content: 'It sounds like you are going through a difficult time. Please reach out to a trusted person or local support line.',
          language: 'en',
          created_at: '2026-11-24T09:02:00.000Z',
          safetyMode: true,
        }}
      />,
    );

    const article = screen.getByTestId('chat-message-assistant-asst-safety-1');
    expect(article).toHaveAttribute('data-variant', 'safety_redirection');
    expect(
      screen.getByRole('region', { name: /Support and care redirection/i }),
    ).toHaveTextContent(/Non-Clinical Guidance/i);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
