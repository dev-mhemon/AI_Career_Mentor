import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  act,
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

    // Closed drawer shell must NOT expose dialog role to assistive tech or Testing Library
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const backdrop = screen.getByTestId('version-history-backdrop');
    expect(backdrop).toHaveClass('opacity-0', 'transition-opacity', 'duration-300');
    expect(backdrop.parentElement).toHaveClass('invisible', 'pointer-events-none');
    expect(backdrop.parentElement).toHaveAttribute('aria-hidden', 'true');

    const historyBtn = screen.getByRole('button', { name: 'Version History' });
    fireEvent.click(historyBtn);

    const drawer = await screen.findByRole('dialog', {
      name: 'Version History',
    });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(drawer).toHaveClass(
      'transform-gpu',
      'will-change-transform',
      'transition-transform',
      'duration-300',
      'translate-x-0',
    );
    expect(backdrop).toHaveClass('opacity-100');
    expect(backdrop.parentElement).toHaveClass('visible', 'pointer-events-auto');
    expect(backdrop.parentElement).toHaveAttribute('aria-hidden', 'false');
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
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Return to Current' }));
    expect(
      screen.queryByText('Viewing Version v1 (Read-Only)'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Experienced Node developer targeting distributed backend.'),
    ).toBeInTheDocument();

    // Verify Escape closes drawer cleanly, hides dialog role, slides out, and restores focus
    fireEvent.click(historyBtn);
    const reopenedDrawer = await screen.findByRole('dialog', {
      name: 'Version History',
    });
    fireEvent.keyDown(reopenedDrawer, { key: 'Escape' });
    expect(
      screen.queryByRole('dialog', { name: 'Version History' }),
    ).not.toBeInTheDocument();
    expect(reopenedDrawer).toHaveClass('translate-x-full');
    expect(backdrop).toHaveClass('opacity-0');
    expect(backdrop.parentElement).toHaveClass('invisible', 'pointer-events-none');
    expect(document.activeElement).toBe(historyBtn);

    // Verify backdrop click closes drawer cleanly and restores focus
    fireEvent.click(historyBtn);
    await screen.findByRole('dialog', { name: 'Version History' });
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(backdrop).toHaveClass('opacity-0');
    expect(document.activeElement).toBe(historyBtn);

    // Verify Close button closes drawer cleanly
    fireEvent.click(historyBtn);
    const closeDialog = await screen.findByRole('dialog', {
      name: 'Version History',
    });
    fireEvent.click(
      within(closeDialog).getByRole('button', { name: 'Close version history' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
    expect(dialog.textContent).toMatch(/discontinues its linked career goal/i);
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

    const toast = screen.getByTestId('toast-container');
    expect(toast).toHaveTextContent('Roadmap archived');
    expect(toast).toHaveTextContent(
      /All learning progress, shared skill evidence, and daily plans are preserved\. Focus automatically reassigned/i,
    );
    const bar = within(toast).getByTestId('toast-countdown-bar');
    expect(bar).toHaveClass('agy-toast-bar');
    expect(bar.style.getPropertyValue('--toast-duration')).toBe('6000ms');

    fireEvent.click(
      within(toast).getByRole('button', { name: 'Dismiss notification' }),
    );
    expect(screen.queryByTestId('toast-container')).not.toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Archive Roadmap' }),
    ).not.toBeInTheDocument();
  });

  it('auto-dismisses the Roadmap archived toast after 6000ms without altering Archived state', async () => {
    vi.useFakeTimers();
    const initial = makeDetail({ id: 'rm-locked-1', is_focus: true });
    vi.mocked(archiveRoadmap).mockResolvedValueOnce({
      archived_roadmap_id: 'rm-locked-1',
      status: 'archived',
      new_focus_roadmap_id: null,
    });

    render(
      <RoadmapDetailView
        accessToken="token-1"
        roadmapId="rm-locked-1"
        initialRoadmap={initial}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Archive Roadmap' }));
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Archive Roadmap' }),
      );
      await Promise.resolve();
    });

    const toast = screen.getByTestId('toast-container');
    expect(toast).toHaveTextContent('Roadmap archived');
    expect(
      within(toast).getByTestId('toast-countdown-bar'),
    ).toHaveClass('agy-toast-bar');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(screen.queryByTestId('toast-container')).not.toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
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

  it('renders amber Draft badge and clear 3-button header hierarchy (ghost Archive -> secondary Version History -> primary Open Draft Review)', async () => {
    vi.mocked(getRoadmap).mockResolvedValueOnce(
      makeDetail({
        id: 'rm-draft-9',
        status: 'draft',
        is_focus: false,
        version_no: 1,
        version_state: 'draft',
        locked_at: null,
      }),
    );

    render(<RoadmapDetailView accessToken="token-1" roadmapId="rm-draft-9" />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Backend Engineer' }),
    ).toBeInTheDocument();

    // Semantic breadcrumb: aligned inline-flex leading-none segments
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const list = breadcrumb.querySelector('ol')!;
    expect(list).toHaveClass('flex', 'items-center', 'text-sm', 'leading-none');
    const hubCrumb = within(breadcrumb).getByRole('link', { name: 'Roadmaps' });
    expect(hubCrumb).toHaveAttribute('href', '/roadmaps');
    expect(hubCrumb).toHaveClass('text-teal-700', 'leading-none');
    const currentCrumb = within(breadcrumb).getByText('Backend Engineer');
    expect(currentCrumb).toHaveAttribute('aria-current', 'page');
    expect(currentCrumb).toHaveClass('inline-flex', 'items-center', 'leading-none');

    const draftBadge = screen.getByText('Draft').parentElement!;
    expect(draftBadge).toHaveClass('bg-amber-50', 'text-amber-800', 'border-amber-200');
    expect(draftBadge).not.toHaveClass('bg-feedback-success-background');

    const archiveBtn = screen.getByRole('button', { name: 'Archive Roadmap' });
    const historyBtn = screen.getByRole('button', { name: 'Version History' });
    const openDraftLink = screen.getByRole('link', { name: 'Open Draft Review' });

    expect(archiveBtn).toHaveClass(
      'whitespace-nowrap',
      'border-slate-200',
      'bg-white',
      'text-slate-600',
      'hover:border-rose-200',
      'hover:bg-rose-50',
      'hover:text-rose-700',
    );
    expect(archiveBtn.querySelector('[data-icon="archive"]')).toBeInTheDocument();
    expect(historyBtn).toHaveClass('whitespace-nowrap', 'border-slate-200', 'bg-white', 'text-slate-700');
    expect(openDraftLink).toHaveAttribute('href', '/roadmaps/rm-draft-9/draft');
    expect(openDraftLink).toHaveClass(
      'whitespace-nowrap',
      'bg-action-primary-background',
      'text-action-primary-foreground',
    );
    expect(openDraftLink.querySelector('[data-icon="arrow-right"]')).toBeInTheDocument();

    // Order left-to-right: Archive Roadmap -> Version History -> Open Draft Review
    expect(
      Boolean(archiveBtn.compareDocumentPosition(historyBtn) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(
      Boolean(historyBtn.compareDocumentPosition(openDraftLink) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it('enforces strict read-only header and archived notice when roadmap status is archived', async () => {
    vi.mocked(getRoadmap).mockResolvedValueOnce(
      makeDetail({
        id: 'rm-archived-4',
        status: 'archived',
        is_focus: false,
        version_no: 2,
        version_state: 'locked',
      }),
    );

    render(<RoadmapDetailView accessToken="token-1" roadmapId="rm-archived-4" />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Backend Engineer' }),
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        'This roadmap is archived and read-only. Your learning progress and skill evidence remain preserved.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Version History' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive Roadmap' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set as Focus Roadmap' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open Draft Review/i })).not.toBeInTheDocument();
  });

  it('cancels/ignores late version snapshot after drawer closes, shows drawer errors inside the drawer, and omits focus reassignment copy when archiving non-focus roadmap', async () => {
    const currentV2 = makeDetail({
      id: 'rm-locked-1',
      version_no: 2,
      is_focus: false,
    });
    const snapshotV1 = makeDetail({
      id: 'rm-locked-1',
      version_id: 'ver-1',
      version_no: 1,
      version_state: 'superseded',
      summary: {
        ...currentV2.summary,
        current_situation: 'Late v1 snapshot must be ignored.',
      },
    });

    let resolveVersionFetch!: (val: RoadmapDetailDTO) => void;
    vi.mocked(getRoadmapVersion)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveVersionFetch = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('Version snapshot failed'));
    vi.mocked(archiveRoadmap).mockResolvedValueOnce({
      archived_roadmap_id: 'rm-locked-1',
      status: 'archived',
      new_focus_roadmap_id: 'rm-other-focus',
    });

    render(
      <RoadmapDetailView
        accessToken="token-1"
        roadmapId="rm-locked-1"
        initialRoadmap={currentV2}
        initialVersions={{
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
              locked_at: null,
              superseded_at: '2026-11-19T10:00:00.000Z',
              created_at: '2026-11-19T08:00:00.000Z',
            },
          ],
          meta: { limit: 50, next_cursor: null },
        }}
      />,
    );

    // 1. Open drawer, start snapshot fetch, then close via Close button before it resolves
    fireEvent.click(screen.getByRole('button', { name: 'Version History' }));
    const drawer = await screen.findByRole('dialog', { name: 'Version History' });
    fireEvent.click(within(drawer).getByRole('button', { name: /Version v1/i }));
    fireEvent.click(
      within(drawer).getByRole('button', { name: 'Close version history' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => {
      resolveVersionFetch(snapshotV1);
      await Promise.resolve();
    });
    expect(
      screen.queryByText('Late v1 snapshot must be ignored.'),
    ).not.toBeInTheDocument();

    // 2. Reopen drawer and trigger a failed snapshot fetch -> error renders INSIDE the open drawer
    fireEvent.click(screen.getByRole('button', { name: 'Version History' }));
    const drawerAgain = await screen.findByRole('dialog', {
      name: 'Version History',
    });
    fireEvent.click(
      within(drawerAgain).getByRole('button', { name: /Version v1/i }),
    );
    expect(await within(drawerAgain).findByRole('alert')).toBeInTheDocument();
    fireEvent.click(
      within(drawerAgain).getByRole('button', { name: 'Close version history' }),
    );

    // 3. Archive non-focus roadmap when backend echoes existing focus ID -> toast omits reassignment text
    fireEvent.click(screen.getByRole('button', { name: 'Archive Roadmap' }));
    const modal = screen.getByRole('dialog');
    fireEvent.click(
      within(modal).getByRole('button', { name: 'Archive Roadmap' }),
    );
    const toast = await screen.findByTestId('toast-container');
    expect(toast).toHaveTextContent('Roadmap archived');
    expect(toast).not.toHaveTextContent(/focus automatically reassigned/i);
  });

  it('disables Load older versions while first-page Version History refresh is in flight on drawer reopen', async () => {
    const currentV3 = makeDetail({ id: 'rm-locked-1', version_no: 3 });
    const v3Meta = {
      id: 'ver-3',
      version_no: 3,
      state: 'locked' as const,
      created_by: 'user_request' as const,
      target_level: 'senior' as const,
      base_version_id: 'ver-2',
      merge_id: null,
      stale: false,
      locked_at: '2026-11-19T11:00:00.000Z',
      superseded_at: null,
      created_at: '2026-11-19T10:30:00.000Z',
    };

    let resolveSecondOpen!: (val: {
      items: (typeof v3Meta)[];
      meta: { limit: number; next_cursor: string | null };
    }) => void;

    vi.mocked(listRoadmapVersions)
      .mockResolvedValueOnce({
        items: [v3Meta],
        meta: { limit: 50, next_cursor: 'cursor-v2' },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondOpen = resolve;
          }),
      );

    render(
      <RoadmapDetailView
        accessToken="token-1"
        roadmapId="rm-locked-1"
        initialRoadmap={currentV3}
      />,
    );

    // 1st open: loads page 1 with next_cursor
    fireEvent.click(screen.getByRole('button', { name: 'Version History' }));
    const drawer1 = await screen.findByRole('dialog', { name: 'Version History' });
    expect(
      await within(drawer1).findByRole('button', { name: 'Load older versions' }),
    ).toBeEnabled();

    // Close and reopen -> 1st-page refresh in flight MUST disable Load older versions until it settles
    fireEvent.click(
      within(drawer1).getByRole('button', { name: 'Close version history' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Version History' }));
    const drawer2 = await screen.findByRole('dialog', { name: 'Version History' });
    expect(
      within(drawer2).getByRole('button', { name: 'Load older versions' }),
    ).toBeDisabled();

    await act(async () => {
      resolveSecondOpen({
        items: [v3Meta],
        meta: { limit: 50, next_cursor: 'cursor-v2' },
      });
      await Promise.resolve();
    });
    expect(
      within(drawer2).getByRole('button', { name: 'Load older versions' }),
    ).toBeEnabled();
  });
});
