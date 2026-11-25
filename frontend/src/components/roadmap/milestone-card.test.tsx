import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MilestoneCard } from './milestone-card';

describe('MilestoneCard (Component 18, C09 §2.4)', () => {
  it('renders completion state, accessible progress bar, SkillBadges, and zero Job Ready wording', () => {
    const { container } = render(
      <MilestoneCard
        title="REST API & SQL Mastery Milestone"
        status="in_progress"
        completedTopics={3}
        totalTopics={5}
        targetCriteria="Complete all core HTTP and PostgreSQL query exercises."
        skills={[
          { label: 'Node.js', status: 'mastered' },
          { label: 'PostgreSQL', status: 'in_progress' },
        ]}
        action={<button type="button">Inspect</button>}
      />,
    );

    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'REST API & SQL Mastery Milestone' }),
    ).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('3 / 5 topics')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('value', '3');
    expect(progress).toHaveAttribute('max', '5');
    expect(screen.getByText('Node.js')).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inspect' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/job ready/i);
  });

  it('preserves 0 / 0 topics display and accessible label while keeping <progress max>=1 when totalTopics is 0', () => {
    render(
      <MilestoneCard
        title="Empty Phase Milestone"
        status="pending"
        completedTopics={0}
        totalTopics={0}
      />,
    );

    expect(screen.getByText('0 / 0 topics')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    const progress = screen.getByRole('progressbar', {
      name: 'Empty Phase Milestone: 0 of 0 topics completed',
    });
    expect(progress).toHaveAttribute('value', '0');
    expect(progress).toHaveAttribute('max', '1');
  });
});
