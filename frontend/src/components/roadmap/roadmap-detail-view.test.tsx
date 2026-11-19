import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  archiveRoadmap,
  focusRoadmap,
  getRoadmap,
  getRoadmapVersion,
  listRoadmapVersions,
  type RoadmapDetailDTO,
} from '@/lib/api/client';
import { RoadmapDetailView } from '@/components/roadmap/roadmap-detail-view';

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>(
    '@/lib/api/client',
  );
  return {
    ...actual,
    getRoadmap: vi.fn(),
    listRoadmapVersions: vi.fn(),
    getRoadmapVersion: vi.fn(),
    focusRoadmap: vi.fn(),
    archiveRoadmap: vi.fn(),
  };
});

function makeDetail(
  overrides: Partial<RoadmapDetailDTO> = {},
): RoadmapDetailDTO {
  return {
    id: 'rm-locked-1',
    career_goal_id: 'goal-1',
    canonical_role_id: 'role-1',
    role_name: 'Backend Engineer',
    target_level: 'senior',
    status: 'locked',
    is_focus: false,
    version_id: 'ver-2',
    version_no: 2,
    version_state: 'locked',
    summary: {
      current_situation: 'Experienced Node developer targeting distributed backend.',
      target_interpretation: 'Senior backend systems engineer.',
      expected_career_impact: 'Stronger architecture & observability readiness.',
      next_steps: ['Switch Focus to resume daily tasks'],
    },
    level_outline: [
      { career_level: 'junior', outline: ['HTTP & CRUD'] },
      { career_level: 'mid', outline: ['Transactions & Caching'] },
      { career_level: 'senior', outline: ['Queue Idempotency & SLOs'] },
    ],
    phases: [
      {
        phase_no: 1,
        title: 'Reliability Architecture',
        milestones: [{ id: 'ms-1', title: 'Idempotent Consumers' }],
        items: [
          {
            id: 'item-a',
            item_id: 'item-a',
            lineage_id: 'lin-a',
            topic_id: 'top-a',
            skill_id: 'sk-a',
            phase_no: 1,
            phase_title: 'Reliability Architecture',
            title: 'Transactional Outbox Pattern',
            priority: 'core',
            gap_type: 'missing',
            required_depth: 'Production failure recovery',
            estimated_effort_hours: 8,
            sequence_no: 1,
            depends_on: [],
            depends_on_lineage_ids: [],
            reason: 'Required for safe async retries.',
            retired: false,
            sources: [],
          },
        ],
      },
    ],
    items: [],
    size_guardrail: {
      active_topic_count: 1,
      soft_max_topics: 45,
      materially_large: false,
      warning: null,
    },
    warnings: [],
    stale: false,
    stale_reason: null,
    locked_at: '2026-11-19T10:00:00.000Z',
    created_at: '2026-11-19T09:00:00.000Z',
    ...overrides,
  };
}

describe('RoadmapDetailView (Screen 15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('loads locked roadmap and supports accessible Version History Drawer + Read-Only snapshot switching', async () => {
    const currentV2 = makeDetail({ version_no: 2 });
    const snapshotV1 = makeDetail({
      version_id: 'ver-1',
      version_no: 1,
      version_state: 'superseded',
      summary: {
        ...currentV2.summary,
        current_situation: 'Historical v1 snapshot baseline situation.',
      },
    });

    vi.mocked(getRoadmap).mockResolvedValueOnce(currentV2);
    vi.mocked(listRoadmapVersions).mockResolvedValue({
      items: [
        {
          id: 'ver-2',
          version_no: 2,
          state: 'locked',
          created_by: 'user_request',
          target_level: 'senior',
          base_version_id: 'ver-1',
          merge_id: null,
          stale: false,
          locked_at: '2026-11-19T10:00:00.000Z',
          superseded_at: null,
          created_at: '2026-11-19T09:30:00.000Z',
        },
        {
          id: 'ver-1',
          version_no: 1,
          state: 'superseded',
          created_by: 'ai',
          target_level: 'senior',
          base_version_id: null,
          merge_id: null,
          stale: false,
          locked_at: '2026-11-19T09:00:00.000Z',
          superseded_at: '2026-11-19T10:00:00.000Z',
          created_at: '2026-11-19T08:00:00.000Z',
        },
      ],
      meta: { limit: 50, next_cursor: null },
    });
    vi.mocked(getRoadmapVersion).mockResolvedValueOnce(snapshotV1);

    render(<RoadmapDetailView accessToken="token-1" roadmapId="rm-locked-1" />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Backend Engineer' }),
    ).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();

    const historyBtn = screen.getByRole('button', { name: 'Version History' });
    fireEvent.click(historyBtn);

    const drawer = await screen.findByRole('dialog', {
      name: 'Version History',
    });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(await screen.findByText('Version v1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Version v1/i }));

    expect(
      await screen.findByText('Viewing Version v1 (Read-Only)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Historical v1 snapshot baseline situation.'),
    ).toBeInTheDocument();
    expect(vi.mocked(getRoadmapVersion)).toHaveBeenCalledWith(
      'token-1',
      'rm-locked-1',
      1,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Return to Current' }));
    expect(
      screen.queryByText('Viewing Version v1 (Read-Only)'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Experienced Node developer targeting distributed backend.'),
    ).toBeInTheDocument();

    // Verify Escape closes drawer cleanly and restores focus
    fireEvent.click(historyBtn);
    const reopenedDrawer = await screen.findByRole('dialog', {
      name: 'Version History',
    });
    fireEvent.keyDown(reopenedDrawer, { key: 'Escape' });
    expect(
      screen.queryByRole('dialog', { name: 'Version History' }),
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(historyBtn);
  });

  it('handles EP-R14 Focus Switch outcomes (requires_learning_hours vs missing vs existing)', async () => {
    vi.mocked(getRoadmap).mockResolvedValueOnce(
      makeDetail({ id: 'rm-locked-1', is_focus: false }),
    );
    vi.mocked(focusRoadmap).mockResolvedValueOnce({
      focus_roadmap_id: 'rm-locked-1',
      daily_plan: {
        state: 'missing',
        plan_id: null,
        requires_learning_hours: true,
      },
    });

    render(<RoadmapDetailView accessToken="token-1" roadmapId="rm-locked-1" />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Backend Engineer' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Set as Focus Roadmap' }));
    expect(
      await screen.findByText(/set your daily learning hours/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Configure Daily Hours' }),
    ).toHaveAttribute('href', '/settings');
    expect(screen.getByText('Focus Roadmap')).toBeInTheDocument();
  });

  it('handles EP-R14 existing daily plan notice and EP-R15 Archive confirmation', async () => {
    vi.mocked(getRoadmap).mockResolvedValueOnce(
      makeDetail({ id: 'rm-locked-1', is_focus: false }),
    );
    vi.mocked(focusRoadmap).mockResolvedValueOnce({
      focus_roadmap_id: 'rm-locked-1',
      daily_plan: {
        state: 'existing',
        plan_id: 'plan-1',
        requires_learning_hours: false,
      },
    });
    vi.mocked(archiveRoadmap).mockResolvedValueOnce({
      archived_roadmap_id: 'rm-locked-1',
      status: 'archived',
      new_focus_roadmap_id: 'rm-locked-2',
    });

    render(<RoadmapDetailView accessToken="token-1" roadmapId="rm-locked-1" />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Backend Engineer' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Set as Focus Roadmap' }));
    expect(
      await screen.findByText(/existing Daily Plan is active and ready/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Archive Roadmap' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toMatch(/preserves all learning progress/i);
    expect(dialog.textContent).toMatch(/focus will automatically reassign/i);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive Roadmap' }));
    await waitFor(() => {
      expect(vi.mocked(archiveRoadmap)).toHaveBeenCalledWith(
        'token-1',
        'rm-locked-1',
      );
      expect(screen.getByText('Archived')).toBeInTheDocument();
    });
  });

  it('handles EP-R14 missing daily plan without learning hours warning when requires_learning_hours is false', async () => {
    vi.mocked(getRoadmap).mockResolvedValueOnce(
      makeDetail({ id: 'rm-locked-1', is_focus: false }),
    );
    vi.mocked(focusRoadmap).mockResolvedValueOnce({
      focus_roadmap_id: 'rm-locked-1',
      daily_plan: {
        state: 'missing',
        plan_id: null,
        requires_learning_hours: false,
      },
    });

    render(<RoadmapDetailView accessToken="token-1" roadmapId="rm-locked-1" />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Backend Engineer' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Set as Focus Roadmap' }));
    expect(
      await screen.findByText(/set up a Daily Plan for this roadmap next/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Configure Daily Hours' }),
    ).not.toBeInTheDocument();
  });
});
