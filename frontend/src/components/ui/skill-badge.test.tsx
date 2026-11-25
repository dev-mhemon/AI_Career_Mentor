import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SkillBadge } from './skill-badge';

describe('SkillBadge (Component 15, C09 §2.3)', () => {
  it('renders non-color-only icon + status text for mastered, in_progress, gap, and target states', () => {
    const { container } = render(
      <div>
        <SkillBadge label="TypeScript" status="mastered" />
        <SkillBadge label="PostgreSQL" status="in_progress" />
        <SkillBadge label="System Design" status="gap" />
        <SkillBadge label="Kubernetes" status="target" />
      </div>,
    );

    expect(screen.getByText('TypeScript')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText(/Proficient/)).toBeInTheDocument();
    expect(screen.getByText(/In Progress/)).toBeInTheDocument();
    expect(screen.getByText(/Gap/)).toBeInTheDocument();
    expect(screen.getByText(/Target/)).toBeInTheDocument();
    expect(container.querySelectorAll('svg')).toHaveLength(4);
  });

  it('avoids duplicate suffix when label matches priority/gap status text and keeps Retired suffix even when label matches base status', () => {
    render(
      <div>
        <SkillBadge label="Core" status="core" />
        <SkillBadge label="Core" status="core" retired />
        <SkillBadge label="Legacy Tool" status="gap" retired />
      </div>,
    );

    expect(screen.getAllByText('Core')).toHaveLength(2);
    expect(screen.queryByText('· Core')).not.toBeInTheDocument();
    expect(screen.getAllByText(/· Retired/)).toHaveLength(2);
  });
});
