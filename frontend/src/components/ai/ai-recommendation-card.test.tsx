import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AIRecommendationCard } from './ai-recommendation-card';

describe('AIRecommendationCard (Component 26, C09 §2.7)', () => {
  it('renders grounded rationale with dir="auto", non-guarantee disclaimer, and primary action', () => {
    const onAction = vi.fn();
    render(
      <AIRecommendationCard
        title="Focus on TypeScript Generics next"
        rationale="আপনার বর্তমান skill profile অনুযায়ী TypeScript generics শিখলে backend architecture দ্রুত পরিষ্কার হবে।"
        sourceLabel="AI Roadmap Rationale"
        actionLabel="Review Proposal"
        onAction={onAction}
      />,
    );

    expect(screen.getByText('AI Roadmap Rationale')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Focus on TypeScript Generics next',
      }),
    ).toHaveAttribute('dir', 'auto');
    expect(
      screen.getByText(/does not guarantee employment/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review Proposal' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('supports dismiss and restore for optional merge suggestions without auto-applying', () => {
    render(
      <AIRecommendationCard
        variant="optional_merge_banner"
        title="Optional skill refresh"
        rationale="Optional merge suggestion requiring explicit acceptance."
        dismissible
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByText('AI suggestion dismissed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(
      screen.getByRole('heading', { name: 'Optional skill refresh' }),
    ).toBeInTheDocument();
  });
});
