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
  acceptRoadmapMerge,
  archiveRoadmap,
  createDailyPlan,
  createRoadmapMerge,
  focusRoadmap,
  getRoadmap,
  getRoadmapMerge,
  getRoadmapVersion,
  listRoadmapMerges,
  listRoadmapVersions,
  rejectRoadmapMerge,
  undoLastRoadmapMerge,
  type MergeProposalDTO,
  type RoadmapDetailDTO,
} from '@/lib/api/client';
import { RoadmapDetailView } from '@/components/roadmap/roadmap-detail-view';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>(
    '@/lib/api/client',
  );
  return {
    ...actual,
    getRoadmap: vi.fn(),
    listRoadmapVersions: vi.fn(),
    getRoadmapVersion: vi.fn(),
    listRoadmapMerges: vi.fn(),
    getRoadmapMerge: vi.fn(),
    createRoadmapMerge: vi.fn(),
    acceptRoadmapMerge: vi.fn(),
    rejectRoadmapMerge: vi.fn(),
    undoLastRoadmapMerge: vi.fn(),
    focusRoadmap: vi.fn(),
    archiveRoadmap: vi.fn(),
    createDailyPlan: vi.fn(),
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
    vi.mocked(listRoadmapMerges).mockResolvedValue({
      items: [],
      meta: { limit: 20, next_cursor: null },
    });
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
      phases: [
        {
          ...currentV2.phases[0],
          items: [
            ...currentV2.phases[0].items,
            {
              ...currentV2.phases[0].items[0],
              id: 'item-legacy',
              item_id: 'item-legacy',
              lineage_id: 'lin-legacy',
              topic_id: 'top-legacy-removed',
              title: 'Legacy SOAP Adapter',
              sequence_no: 2,
              retired: false,
            },
          ],
        },
      ],
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
    expect(
      screen.getByRole('link', {
        name: 'Ask Mentor about Transactional Outbox Pattern',
      }),
    ).toHaveAttribute('href', '/mentor?context=topic&topicId=top-a');

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
    // Topic still active in current v2 keeps Ask Mentor link; topic removed in current v2 hides it
    expect(
      screen.getByRole('link', {
        name: 'Ask Mentor about Transactional Outbox Pattern',
      }),
    ).toHaveAttribute('href', '/mentor?context=topic&topicId=top-a');
    expect(
      screen.queryByRole('link', {
        name: 'Ask Mentor about Legacy SOAP Adapter',
      }),
    ).not.toBeInTheDocument();
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
    const nonFocusBadge = screen.getByText('Non-Focus').parentElement!;
    expect(nonFocusBadge).toHaveClass(
      'bg-amber-50',
      'text-amber-700',
      'border-amber-200',
      'inline-flex',
      'items-center',
      'gap-1',
      'leading-none',
    );
    expect(nonFocusBadge.querySelector('svg')).toHaveClass('block', 'shrink-0');
    expect(screen.queryByText('Focus Roadmap')).not.toBeInTheDocument();
    expect(screen.getByText('Roadmap Sections')).toBeInTheDocument();
    expect(screen.getByTestId('segmented-tabs-indicator')).toBeInTheDocument();

    const setFocusBtn = screen.getByRole('button', { name: 'Set as Focus Roadmap' });
    expect(setFocusBtn).toHaveClass('inline-flex', 'items-center', 'justify-center', 'gap-1.5', 'leading-none');
    expect(setFocusBtn.querySelector('svg')).toHaveClass('block', 'shrink-0');
    fireEvent.click(setFocusBtn);
    expect(
      await screen.findByText(/set your daily learning hours/i),
    ).toBeInTheDocument();
    // Opens HoursPromptModal immediately for missing Daily Plan
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByRole('button', { name: 'Create Daily Plan' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Focus Roadmap')).toBeInTheDocument();
    expect(screen.queryByText('Non-Focus')).not.toBeInTheDocument();

    // Re-opening via alert action creates plan and navigates to /today
    vi.mocked(createDailyPlan).mockResolvedValueOnce({
      plan_id: 'plan-new',
      roadmap_id: 'rm-locked-1',
      roadmap_version_no: 2,
      is_focus: true,
      hours_per_day: 2,
      total_days: 4,
      completed_days: 0,
      next_incomplete_day_no: 1,
      days: [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Daily Plan' }));
    const reopened = screen.getByRole('dialog');
    fireEvent.click(within(reopened).getByRole('button', { name: '2h' }));
    fireEvent.click(
      within(reopened).getByRole('button', { name: 'Create Daily Plan' }),
    );
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/today');
    });
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
      await screen.findByText(/Create a Daily Plan to begin sequential daily lessons/i),
    ).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByRole('button', { name: 'Create Daily Plan' }),
    ).toBeInTheDocument();
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

  it('shows Open Merge Proposal banner, opens RoadmapDiffViewer on Review Diff, and supports Undo Last Merge (EP-R13)', async () => {
    const currentV3 = makeDetail({ version_no: 3, target_level: 'senior' });
    const mergeDetail: MergeProposalDTO = {
      id: 'merge-open-1',
      roadmap_id: 'rm-locked-1',
      origin: 'ai_proposal',
      status: 'proposed',
      base_version_id: 'ver-3',
      base_version_no: 3,
      result_version_id: null,
      target_level: null,
      instruction: null,
      reason: 'New LTS release impacts runtime security topics.',
      operations: [
        {
          id: 'op-1',
          sort_order: 1,
          op: 'add_topic',
          item_id: null,
          lineage_id: null,
          topic_id: 'top-lts',
          skill_id: 'sk-a',
          title: 'Node.js Permission Model',
          priority: 'supporting',
          reason: 'Recommended for modern LTS security',
          payload: { phase_no: 1 },
        },
      ],
      size_impact: {
        active_topics_before: 10,
        active_topics_after: 11,
        before: 10,
        after: 11,
        delta: 1,
        soft_limit: 45,
        materially_large: false,
        warning: null,
      },
      daily_plan_impact: {
        has_active_plan: true,
        completed_days_unchanged: 3,
        future_days_affected: 2,
      },
      undo_available: false,
      created_at: '2026-11-23T10:00:00.000Z',
      accepted_at: null,
      rejected_at: null,
      undone_at: null,
      undo_window_closed_at: null,
    };

    const initialMergeListItems = [
      {
        id: 'merge-open-1',
        roadmap_id: 'rm-locked-1',
        origin: 'ai_proposal' as const,
        status: 'proposed' as const,
        base_version_no: 3,
        target_level: null,
        reason: 'New LTS release impacts runtime security topics.',
        materially_large: false,
        undo_available: false,
        created_at: '2026-11-23T10:00:00.000Z',
        accepted_at: null,
        rejected_at: null,
        undone_at: null,
      },
      {
        id: 'merge-prev-1',
        roadmap_id: 'rm-locked-1',
        origin: 'level_change' as const,
        status: 'accepted' as const,
        base_version_no: 2,
        target_level: 'senior' as const,
        reason: 'Moved to Senior level',
        materially_large: false,
        undo_available: true,
        created_at: '2026-11-22T10:00:00.000Z',
        accepted_at: '2026-11-22T10:05:00.000Z',
        rejected_at: null,
        undone_at: null,
      },
      {
        id: 'merge-undone-1',
        roadmap_id: 'rm-locked-1',
        origin: 'user_request' as const,
        status: 'undone' as const,
        base_version_no: 2,
        target_level: null,
        reason: 'Experimental GraphQL swap',
        materially_large: false,
        undo_available: false,
        created_at: '2026-11-21T10:00:00.000Z',
        accepted_at: '2026-11-21T10:05:00.000Z',
        rejected_at: null,
        undone_at: '2026-11-21T10:15:00.000Z',
      },
      {
        id: 'merge-rej-1',
        roadmap_id: 'rm-locked-1',
        origin: 'user_request' as const,
        status: 'rejected' as const,
        base_version_no: 1,
        target_level: null,
        reason: 'Declined legacy SOAP migration',
        materially_large: false,
        undo_available: false,
        created_at: '2026-11-20T10:00:00.000Z',
        accepted_at: null,
        rejected_at: '2026-11-20T10:05:00.000Z',
        undone_at: null,
      },
    ];
    vi.mocked(listRoadmapMerges)
      .mockResolvedValueOnce({
        items: initialMergeListItems,
        meta: { limit: 20, next_cursor: null },
      })
      .mockResolvedValue({
        items: initialMergeListItems.map((m) =>
          m.id === 'merge-prev-1'
            ? {
                ...m,
                status: 'undone' as const,
                undo_available: false,
                undone_at: '2026-11-23T12:05:00.000Z',
              }
            : m.id === 'merge-open-1'
              ? { ...m, status: 'superseded' as const }
              : m,
        ),
        meta: { limit: 20, next_cursor: null },
      });
    const acceptedDetail: MergeProposalDTO = {
      ...mergeDetail,
      id: 'merge-prev-1',
      origin: 'level_change',
      status: 'accepted',
      base_version_no: 2,
      target_level: 'senior',
      reason: 'Moved to Senior level',
      operations: [
        {
          ...mergeDetail.operations[0]!,
          id: 'op-senior-1',
          title: 'Distributed Consensus Internals',
        },
      ],
    };
    vi.mocked(getRoadmapMerge).mockImplementation(async (_tok, _rm, mergeId) =>
      mergeId === 'merge-prev-1' ? acceptedDetail : mergeDetail,
    );
    vi.mocked(undoLastRoadmapMerge).mockResolvedValueOnce({
      restored_version_no: 2,
      merge_id: 'merge-prev-1',
      status: 'undone',
    });
    vi.mocked(getRoadmap).mockResolvedValue(
      makeDetail({ version_no: 2, target_level: 'mid' }),
    );
    vi.mocked(listRoadmapVersions).mockResolvedValue({
      items: [],
      meta: { limit: 50, next_cursor: null },
    });

    render(
      <RoadmapDetailView
        accessToken="token-1"
        roadmapId="rm-locked-1"
        initialRoadmap={currentV3}
      />,
    );

    // Sticky top header; Open Merge Proposal banner is NOT shown above tabs on Active Roadmap
    const stickyHeader = screen
      .getByRole('heading', { level: 1, name: 'Backend Engineer' })
      .closest('header')!;
    expect(stickyHeader).toHaveClass('sticky', 'z-20', 'backdrop-blur-sm');

    expect(
      await screen.findByRole('tab', { name: 'Merge Proposals (1)' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Open Merge Proposal \(AI Proposal\)/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('open-merge-banner-progress'),
    ).not.toBeInTheDocument();

    const requestChangeBtn = screen.getByRole('button', {
      name: 'Request Change',
    });
    const changeLevelBtn = screen.getByRole('button', {
      name: 'Change Career Level',
    });
    expect(requestChangeBtn).toBeDisabled();
    expect(requestChangeBtn).toHaveAttribute(
      'title',
      'Accept or reject the open merge proposal before creating a new one.',
    );
    expect(changeLevelBtn).toBeDisabled();
    expect(changeLevelBtn).toHaveAttribute(
      'title',
      'Accept or reject the open merge proposal before creating a new one.',
    );

    // Switch to Merge Proposals tab -> NO redundant Open Merge Proposal banner, distinct status cards, per-card accordion expansion
    fireEvent.click(
      screen.getByRole('tab', { name: 'Merge Proposals (1)' }),
    );
    expect(
      screen.queryByText(/Open Merge Proposal \(AI Proposal\)/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Request Change' }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: 'Change Career Level' }),
    ).toHaveLength(1);

    const proposedCard = screen
      .getByText('New LTS release impacts runtime security topics.')
      .closest('li')!;
    const acceptedCard = screen
      .getByText('Moved to Senior level')
      .closest('li')!;
    const undoneCard = screen
      .getByText('Experimental GraphQL swap')
      .closest('li')!;
    const rejectedCard = screen
      .getByText('Declined legacy SOAP migration')
      .closest('li')!;

    expect(proposedCard).toHaveAttribute('data-merge-status', 'proposed');
    expect(proposedCard.firstElementChild).toHaveClass(
      'border-l-4',
      'border-l-teal-600',
      'bg-white',
    );
    expect(within(proposedCard).getByText('Pending Review')).toBeInTheDocument();

    expect(undoneCard).toHaveAttribute('data-merge-status', 'undone');
    expect(undoneCard.firstElementChild).toHaveClass(
      'border-l-4',
      'border-l-amber-400',
    );
    expect(within(undoneCard).getByText('Undone')).toBeInTheDocument();

    expect(rejectedCard).toHaveAttribute('data-merge-status', 'rejected');
    expect(rejectedCard.firstElementChild).toHaveClass(
      'border-l-4',
      'border-l-rose-400',
      'border-rose-200/80',
      'bg-rose-50/45',
    );
    expect(within(rejectedCard).getByText('Rejected')).toBeInTheDocument();

    // Clicking Review Changes expands diff inside the proposed card's accordion region
    const reviewBtn = within(proposedCard).getByRole('button', {
      name: /Review Changes/i,
    });
    const proposedPanelId = reviewBtn.getAttribute('aria-controls')!;
    expect(reviewBtn).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(proposedPanelId)).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    fireEvent.click(reviewBtn);

    expect(
      await within(proposedCard).findByText('Node.js Permission Model'),
    ).toBeInTheDocument();
    expect(
      within(proposedCard).getByRole('button', { name: /Hide Changes/i }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(proposedPanelId)).toHaveAttribute(
      'aria-hidden',
      'false',
    );
    expect(document.getElementById(proposedPanelId)).toHaveClass(
      'grid-rows-[1fr]',
      'opacity-100',
    );
    expect(
      within(proposedCard).getByRole('button', { name: 'Accept Merge' }),
    ).toBeInTheDocument();
    expect(
      within(proposedCard).getByRole('button', { name: 'Reject Proposal' }),
    ).toBeInTheDocument();

    // Opening a second proposal collapses the first smoothly (keeps cached diff mounted inside aria-hidden + inert 0fr track)
    const inspectBtn = within(acceptedCard).getByRole('button', {
      name: /View Changes/i,
    });
    const acceptedPanelId = inspectBtn.getAttribute('aria-controls')!;
    fireEvent.click(inspectBtn);
    expect(
      await within(acceptedCard).findByText('Distributed Consensus Internals'),
    ).toBeInTheDocument();
    expect(document.getElementById(acceptedPanelId)).toHaveAttribute(
      'aria-hidden',
      'false',
    );
    expect(
      within(proposedCard).getByRole('button', { name: /Review Changes/i }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(proposedPanelId)).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(document.getElementById(proposedPanelId)).toHaveClass(
      'grid-rows-[0fr]',
      'opacity-0',
    );

    // Clicking Hide Changes collapses the second card smoothly with aria-hidden="true"
    fireEvent.click(
      within(acceptedCard).getByRole('button', { name: /Hide Changes/i }),
    );
    expect(
      within(acceptedCard).getByRole('button', { name: /View Changes/i }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(acceptedPanelId)).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(document.getElementById(acceptedPanelId)).toHaveClass(
      'grid-rows-[0fr]',
      'opacity-0',
    );
    expect(getRoadmapMerge).toHaveBeenCalledWith(
      'token-1',
      'rm-locked-1',
      'merge-open-1',
      expect.any(Object),
    );

    // Undo Last Merge banner + confirmation calls EP-R13 with Idempotency-Key
    fireEvent.click(screen.getByRole('button', { name: 'Undo Last Merge' }));
    const undoDialog = await screen.findByRole('dialog', {
      name: /Undo last accepted merge/i,
    });
    fireEvent.click(
      within(undoDialog).getByRole('button', { name: 'Confirm Undo' }),
    );

    await waitFor(() => {
      expect(undoLastRoadmapMerge).toHaveBeenCalledWith(
        'token-1',
        'rm-locked-1',
        expect.stringMatching(/^[0-9a-f-]{36}$/i),
        3,
      );
    });
    expect(
      await screen.findByText('Last merge undone — restored v2.'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('v2')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Undo Last Merge' }),
      ).not.toBeInTheDocument();
    });
  });

  it('renders semantic Version History state badges (Locked, Superseded, Restored) with icons', async () => {
    vi.mocked(listRoadmapVersions).mockResolvedValue({
      items: [
        {
          id: 'ver-3',
          version_no: 3,
          state: 'locked',
          created_by: 'merge',
          target_level: 'mid',
          base_version_id: 'ver-2',
          merge_id: 'm-2',
          stale: false,
          locked_at: '2026-11-23T10:00:00.000Z',
          superseded_at: null,
          created_at: '2026-11-23T10:00:00.000Z',
        },
        {
          id: 'ver-2',
          version_no: 2,
          state: 'restored',
          created_by: 'merge',
          target_level: 'mid',
          base_version_id: 'ver-1',
          merge_id: 'm-1',
          stale: false,
          locked_at: '2026-11-22T10:00:00.000Z',
          superseded_at: '2026-11-23T10:00:00.000Z',
          created_at: '2026-11-22T10:00:00.000Z',
        },
        {
          id: 'ver-1',
          version_no: 1,
          state: 'superseded',
          created_by: 'ai',
          target_level: 'junior',
          base_version_id: null,
          merge_id: null,
          stale: false,
          locked_at: '2026-11-21T10:00:00.000Z',
          superseded_at: '2026-11-22T10:00:00.000Z',
          created_at: '2026-11-21T10:00:00.000Z',
        },
      ],
      meta: { limit: 50, next_cursor: null },
    });

    render(
      <RoadmapDetailView
        accessToken="token-1"
        roadmapId="rm-locked-1"
        initialRoadmap={makeDetail({ version_no: 3 })}
        initialTab="versions"
      />,
    );

    const versionPanel = await screen.findByRole('tabpanel');
    const lockedBadge = (await within(versionPanel).findByText('Locked'))
      .parentElement!;
    expect(lockedBadge).toHaveClass(
      'bg-emerald-50',
      'text-emerald-700',
      'border-emerald-200',
      'inline-flex',
      'items-center',
      'gap-1.5',
      'leading-none',
    );
    expect(lockedBadge.querySelector('svg')).toHaveClass('block', 'shrink-0');

    const restoredBadge =
      within(versionPanel).getByText('Restored').parentElement!;
    expect(restoredBadge).toHaveClass(
      'bg-sky-50',
      'text-sky-700',
      'border-sky-200',
    );
    expect(restoredBadge.querySelector('svg')).toHaveClass('block', 'shrink-0');

    const supersededBadge =
      within(versionPanel).getByText('Superseded').parentElement!;
    expect(supersededBadge).toHaveClass(
      'bg-slate-100',
      'text-slate-600',
      'border-slate-200/90',
    );
    expect(supersededBadge.querySelector('svg')).toHaveClass(
      'block',
      'shrink-0',
    );
  });

  it('preserves read-only browsing, Merge Proposals tab, and Undo when roadmapGeneratorEnabled is false', async () => {
    const currentV3 = makeDetail({ version_no: 3 });
    vi.mocked(listRoadmapMerges).mockResolvedValue({
      items: [
        {
          id: 'merge-acc-1',
          roadmap_id: 'rm-locked-1',
          origin: 'user_request',
          status: 'accepted',
          base_version_no: 2,
          target_level: null,
          reason: 'Added testing topic',
          materially_large: false,
          undo_available: true,
          created_at: '2026-11-22T10:00:00.000Z',
          accepted_at: '2026-11-22T10:05:00.000Z',
          rejected_at: null,
          undone_at: null,
        },
      ],
      meta: { limit: 20, next_cursor: null },
    });

    render(
      <RoadmapDetailView
        accessToken="token-1"
        roadmapId="rm-locked-1"
        initialRoadmap={currentV3}
        initialTab="merges"
        roadmapGeneratorEnabled={false}
      />,
    );

    expect(
      await screen.findByText(/Roadmap generation is currently disabled/i),
    ).toBeInTheDocument();
    // Generation actions disabled
    for (const btn of screen.getAllByRole('button', {
      name: 'Request Change',
    })) {
      expect(btn).toBeDisabled();
    }
    // Undo & Merge Proposals list stay accessible
    expect(
      screen.getByRole('button', { name: 'Undo Last Merge' }),
    ).toBeEnabled();
    expect(screen.getByText('Added testing topic')).toBeInTheDocument();

    // Ensure unused mock imports stay referenced cleanly
    expect(createRoadmapMerge).not.toHaveBeenCalled();
    expect(acceptRoadmapMerge).not.toHaveBeenCalled();
    expect(rejectRoadmapMerge).not.toHaveBeenCalled();
  });
});
