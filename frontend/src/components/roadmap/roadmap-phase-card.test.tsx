import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RoadmapPhaseCard } from './roadmap-phase-card';

describe('RoadmapPhaseCard (Component 16, C09 §2.4)', () => {
  it('renders phase header with dir="auto", non-color-only status badge, and guidance-only hours disclaimer', () => {
    render(
      <RoadmapPhaseCard
        phaseNo={1}
        title="Backend ফাউন্ডেশন ও HTTP API"
        status="draft"
        estimatedHours={12}
        topicCount={4}
      >
        <p>Topic list slot</p>
      </RoadmapPhaseCard>,
    );

    const heading = screen.getByRole('heading', {
      name: 'Phase 1: Backend ফাউন্ডেশন ও HTTP API',
    });
    expect(heading).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('4 topics')).toBeInTheDocument();
    expect(
      screen.getByText(/~12h · আনুমানিক সময় — Guidance only/),
    ).toBeInTheDocument();
    expect(screen.getByText('Topic list slot')).toBeInTheDocument();
  });

  it('toggles collapsible content via accessible aria-expanded control', () => {
    render(
      <RoadmapPhaseCard
        phaseNo={2}
        title="Database Indexing"
        status="locked"
        defaultExpanded={false}
      >
        <p>Phase 2 topics</p>
      </RoadmapPhaseCard>,
    );

    const toggle = screen.getByRole('button', { name: /Show/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Phase 2 topics')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Phase 2 topics')).toBeInTheDocument();
  });
});
