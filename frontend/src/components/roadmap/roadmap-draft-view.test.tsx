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
  ApiError,
  getRoadmap,
  lockRoadmap,
  reviseRoadmap,
  type JobStatusDTO,
  type RoadmapDetailDTO,
} from '@/lib/api/client';
import { RoadmapDraftView } from '@/components/roadmap/roadmap-draft-view';

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
  }),
}));

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>(
    '@/lib/api/client',
  );
  return {
    ...actual,
    getRoadmap: vi.fn(),
    reviseRoadmap: vi.fn(),
    lockRoadmap: vi.fn(),
  };
});

function makeDraft(overrides: Partial<RoadmapDetailDTO> = {}): RoadmapDetailDTO {
  return {
    id: 'rm-draft-1',
    career_goal_id: 'goal-1',
    canonical_role_id: 'role-1',
    role_name: 'Full-Stack Engineer',
    target_level: 'mid',
    status: 'draft',
    is_focus: false,
    version_id: 'ver-1',
    version_no: 1,
    version_state: 'draft',
    summary: {
      current_situation: 'Strong JS basics, learning backend persistence.',
      target_interpretation: 'Mid-level web platform developer.',
      expected_career_impact: 'Closes SQL and API testing gaps.',
      next_steps: ['Review Phase 1 SQL foundations'],
    },
    level_outline: [
      { career_level: 'junior', outline: ['HTML, CSS, SQL basics'] },
      { career_level: 'mid', outline: ['REST APIs, transactions, testing'] },
      { career_level: 'senior', outline: ['Distributed systems'] },
    ],
    phases: [
      {
        phase_no: 1,
        title: 'Foundations',
        milestones: [{ id: 'm1', title: 'Core DB skills' }],
        items: [
          {
            id: 'item-1',
            item_id: 'item-1',
            lineage_id: 'lin-1',
            topic_id: 'top-1',
            skill_id: 'sk-1',
            phase_no: 1,
            phase_title: 'Foundations',
            title: 'PostgreSQL Fundamentals',
            priority: 'core',
            gap_type: 'missing',
            required_depth: 'Applied queries & joins',
            estimated_effort_hours: 6,
            sequence_no: 1,
            depends_on: [],
            depends_on_lineage_ids: [],
            reason: 'Essential for relational modeling.',
            retired: false,
            sources: [{ publisher: 'PostgreSQL Docs', url: 'https://www.postgresql.org/docs/' }],
          },
          {
            id: 'item-2',
            item_id: 'item-2',
            lineage_id: 'lin-2',
            topic_id: 'top-2',
            skill_id: 'sk-2',
            phase_no: 1,
            phase_title: 'Foundations',
            title: 'TypeORM Query Optimization',
            priority: 'supporting',
            gap_type: 'strengthen',
            required_depth: 'Indexing & query plans',
            estimated_effort_hours: 4,
            sequence_no: 2,
            depends_on: ['item-1'],
            depends_on_lineage_ids: ['lin-1'],
            reason: 'Builds directly on SQL.',
            retired: false,
            sources: [],
          },
        ],
      },
    ],
    items: [],
    size_guardrail: {
      active_topic_count: 14,
      soft_max_topics: 45,
      materially_large: false,
      warning: null,
    },
    warnings: [],
    stale: false,
    stale_reason: null,
    locked_at: null,
    created_at: '2026-11-19T09:00:00.000Z',
    ...overrides,
  };
}

describe('RoadmapDraftView (Screen 12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRoadmap).mockReset();
    vi.mocked(reviseRoadmap).mockReset();
    vi.mocked(lockRoadmap).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders draft details, prerequisites, and blocks Lock until stale draft is refreshed via AILoadingState', async () => {
    const staleDraft = makeDraft({
      version_no: 1,
      stale: true,
      stale_reason: 'Profile skills updated after draft generation.',
    });
    const refreshedDraft = makeDraft({
      version_no: 2,
      stale: false,
      stale_reason: null,
    });

    vi.mocked(getRoadmap)
      .mockResolvedValueOnce(staleDraft)
      .mockResolvedValueOnce(refreshedDraft);
    vi.mocked(reviseRoadmap).mockResolvedValueOnce({
      job_id: 'job-refresh-1',
      kind: 'roadmap_revision',
      status: 'queued',
      poll_url: '/api/v1/jobs/job-refresh-1',
      retry_after_seconds: 1,
    });

    const pollMock = vi.fn(
      async (): Promise<JobStatusDTO> => ({
        job_id: 'job-refresh-1',
        kind: 'roadmap_revision',
        status: 'succeeded',
        result_ref: { type: 'roadmap', id: 'rm-draft-1' },
        error: null,
        retryable: false,
        created_at: '2026-11-19T00:00:00.000Z',
        finished_at: '2026-11-19T00:00:02.000Z',
      }),
    );

    render(<RoadmapDraftView accessToken="token-1" roadmapId="rm-draft-1" pollJobStatus={pollMock} />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Full-Stack Engineer' }),
    ).toBeInTheDocument();

    // Semantic breadcrumb: Roadmaps -> Full-Stack Engineer -> Draft Review (current)
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const hubCrumb = within(breadcrumb).getByRole('link', { name: 'Roadmaps' });
    expect(hubCrumb).toHaveAttribute('href', '/roadmaps');
    expect(hubCrumb).toHaveClass('text-teal-700');
    expect(
      within(breadcrumb).getByRole('link', { name: 'Full-Stack Engineer' }),
    ).toHaveAttribute('href', '/roadmaps/rm-draft-1');
    const currentCrumb = within(breadcrumb).getByText('Draft Review');
    expect(currentCrumb).toHaveAttribute('aria-current', 'page');

    expect(screen.getByText('Draft v1')).toBeInTheDocument();
    expect(screen.getByText(/Prerequisites: PostgreSQL Fundamentals/)).toBeInTheDocument();
    expect(screen.getByText(/Profile skills updated after draft generation/)).toBeInTheDocument();

    const lockButton = screen.getByRole('button', { name: 'Lock Roadmap' });
    expect(lockButton).toBeDisabled();

    vi.useFakeTimers();
    const refreshButtons = screen.getAllByRole('button', { name: /Refresh Stale Draft/i });
    await act(async () => {
      fireEvent.click(refreshButtons[0]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(vi.mocked(reviseRoadmap)).toHaveBeenCalledWith(
      'token-1',
      'rm-draft-1',
      { refresh_stale: true, expected_version_no: 1 },
      expect.stringMatching(/^[0-9a-f-]{36}$/i),
    );
    expect(screen.getByText('Refreshing stale roadmap draft')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.useRealTimers();

    expect(await screen.findByText('Draft v2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lock Roadmap' })).toBeEnabled();
  });

  it('counts Unicode code points for revision instructions (1..2000) and reloads updated draft after polling', async () => {
    const draftV1 = makeDraft({ version_no: 1 });
    const draftV2 = makeDraft({ version_no: 2 });

    vi.mocked(getRoadmap)
      .mockResolvedValueOnce(draftV1)
      .mockResolvedValueOnce(draftV2);
    vi.mocked(reviseRoadmap).mockResolvedValueOnce({
      job_id: 'job-rev-1',
      kind: 'roadmap_revision',
      status: 'queued',
      poll_url: '/api/v1/jobs/job-rev-1',
      retry_after_seconds: 1,
    });

    const pollMock = vi.fn(
      async (): Promise<JobStatusDTO> => ({
        job_id: 'job-rev-1',
        kind: 'roadmap_revision',
        status: 'succeeded',
        result_ref: { type: 'roadmap', id: 'rm-draft-1' },
        error: null,
        retryable: false,
        created_at: '2026-11-19T00:00:00.000Z',
        finished_at: '2026-11-19T00:00:02.000Z',
      }),
    );

    render(<RoadmapDraftView accessToken="token-1" roadmapId="rm-draft-1" pollJobStatus={pollMock} />);
    const draftBadge = await screen.findByText('Draft v1');
    expect(draftBadge).toBeInTheDocument();
    expect(draftBadge).toHaveClass('bg-amber-50', 'text-amber-800', 'border-amber-200');

    const textarea = screen.getByLabelText(/Revision instruction/i);
    expect(textarea).toBeRequired();
    expect(textarea).toHaveAttribute('aria-required', 'true');
    const submitBtns = screen.getAllByRole('button', { name: 'Submit Revision' });
    expect(submitBtns).toHaveLength(1);
    const submitBtn = submitBtns[0];
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveClass(
      'border-slate-200',
      'bg-slate-100',
      'text-slate-400',
      'cursor-not-allowed',
      'shadow-none',
    );
    expect(submitBtn.querySelector('[data-icon="sparkles"]')).toBeInTheDocument();

    // Unified top Review & Finalize Draft panel renders BOTH Lock Roadmap and Submit Revision ABOVE Phases & Topics
    // and stacks cleanly on mobile (`flex-col sm:flex-row`) with full-width mobile buttons (`w-full sm:w-auto`)
    const lockBtns = screen.getAllByRole('button', { name: 'Lock Roadmap' });
    expect(lockBtns).toHaveLength(1);
    expect(lockBtns[0]).toHaveClass('w-full', 'sm:w-auto', 'justify-center', 'whitespace-nowrap');
    expect(submitBtn).toHaveClass('w-full', 'sm:w-auto', 'justify-center');
    const reviewHeading = screen.getByRole('heading', {
      level: 2,
      name: /Review & Finalize Draft/i,
    });
    expect(reviewHeading.parentElement?.parentElement).toHaveClass(
      'flex-col',
      'sm:flex-row',
    );
    const phasesHeading = screen.getByRole('heading', {
      level: 2,
      name: /Phases & Topics/i,
    });
    expect(
      Boolean(
        lockBtns[0].compareDocumentPosition(phasesHeading) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        submitBtn.compareDocumentPosition(phasesHeading) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);

    // Whitespace-only input keeps Submit Revision disabled
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveClass('bg-slate-100', 'text-slate-400');

    // Surrogate-pair emoji counts as 1 Unicode code point, not 2 UTF-16 code units.
    fireEvent.change(textarea, { target: { value: '🚀' } });
    expect(screen.getByText('1 / 2000')).toBeInTheDocument();
    expect(submitBtn).toBeEnabled();
    expect(submitBtn).toHaveClass(
      'border-teal-600',
      'bg-teal-50',
      'text-teal-800',
      'font-semibold',
    );

    const oversized = '🚀'.repeat(2001);
    fireEvent.change(textarea, { target: { value: oversized } });
    expect(screen.getByText('2001 / 2000')).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveClass('bg-slate-100', 'text-slate-400');

    fireEvent.change(textarea, {
      target: { value: 'Add Vitest contract exercises in Phase 1.' },
    });
    expect(submitBtn).toBeEnabled();

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(submitBtn);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(vi.mocked(reviseRoadmap)).toHaveBeenCalledWith(
      'token-1',
      'rm-draft-1',
      {
        instruction: 'Add Vitest contract exercises in Phase 1.',
        expected_version_no: 1,
      },
      expect.stringMatching(/^[0-9a-f-]{36}$/i),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.useRealTimers();

    expect(await screen.findByText('Draft v2')).toBeInTheDocument();
  });

  it('requires confirm_large_roadmap above 45 topics, sends expected_version_no on Lock, and routes without claiming Daily Plan creation', async () => {
    const largeDraft = makeDraft({
      version_no: 3,
      size_guardrail: {
        active_topic_count: 52,
        soft_max_topics: 45,
        materially_large: true,
        warning: '52 active topics exceed the 45-topic soft guideline.',
      },
    });

    vi.mocked(getRoadmap).mockResolvedValueOnce(largeDraft);
    vi.mocked(lockRoadmap).mockResolvedValueOnce({
      roadmap_id: 'rm-draft-1',
      status: 'locked',
      version_no: 3,
      current_version_id: 'ver-3',
      is_focus: true,
      locked_at: '2026-11-19T12:00:00.000Z',
      next_step: 'confirm_learning_hours',
      preferred_daily_hours: 2,
      size_guardrail: largeDraft.size_guardrail,
    });

    render(<RoadmapDraftView accessToken="token-1" roadmapId="rm-draft-1" />);
    expect(await screen.findByText('Draft v3')).toBeInTheDocument();
    expect(screen.getByText('52 / 45 topics')).toBeInTheDocument();
    expect(screen.queryByText(/daily plan was.*created/i)).not.toBeInTheDocument();

    const lockButton = screen.getByRole('button', { name: 'Lock Roadmap' });
    expect(lockButton).toBeDisabled();

    const confirmCheckbox = screen.getByRole('checkbox');
    fireEvent.click(confirmCheckbox);
    expect(lockButton).toBeEnabled();

    fireEvent.click(lockButton);
    await waitFor(() => {
      expect(vi.mocked(lockRoadmap)).toHaveBeenCalledWith(
        'token-1',
        'rm-draft-1',
        { expected_version_no: 3, confirm_large_roadmap: true },
        expect.stringMatching(/^[0-9a-f-]{36}$/i),
      );
      expect(mockReplace).toHaveBeenCalledWith('/roadmaps/rm-draft-1');
    });
    // Zero flicker: Lock button stays stably disabled in "Opening roadmap..." until unmount, with no competing router.refresh()
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(lockButton).toBeDisabled();
    expect(lockButton).toHaveTextContent('Opening roadmap...');
  });

  it('surfaces STALE_VERSION 409 error with Reload Draft recovery', async () => {
    vi.mocked(getRoadmap)
      .mockResolvedValueOnce(makeDraft({ version_no: 1 }))
      .mockResolvedValueOnce(makeDraft({ version_no: 2 }));
    vi.mocked(lockRoadmap).mockRejectedValueOnce(
      new ApiError(409, 'Version changed', 'STALE_VERSION'),
    );

    render(<RoadmapDraftView accessToken="token-1" roadmapId="rm-draft-1" />);
    expect(await screen.findByText('Draft v1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Lock Roadmap' }));
    expect(await screen.findByText(/newer version of this roadmap/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reload Draft' }));
    expect(await screen.findByText('Draft v2')).toBeInTheDocument();
  });

  it('retries a failed retryable job with a fresh Idempotency-Key (no stale activeJob block) and releases draft controls on non-retryable terminal failure', async () => {
    const draftV1 = makeDraft({ version_no: 1 });
    vi.mocked(getRoadmap).mockResolvedValue(draftV1);
    vi.mocked(reviseRoadmap)
      .mockResolvedValueOnce({
        job_id: 'job-fail-1',
        kind: 'roadmap_revision',
        status: 'queued',
        poll_url: '/api/v1/jobs/job-fail-1',
        retry_after_seconds: 1,
      })
      .mockResolvedValueOnce({
        job_id: 'job-fail-2',
        kind: 'roadmap_revision',
        status: 'queued',
        poll_url: '/api/v1/jobs/job-fail-2',
        retry_after_seconds: 1,
      });

    const pollMock = vi
      .fn()
      .mockResolvedValueOnce({
        job_id: 'job-fail-1',
        kind: 'roadmap_revision',
        status: 'failed',
        result_ref: null,
        error: {
          code: 'AI_GENERATION_FAILED',
          message: 'Temporary AI failure',
          retryable: true,
        },
        retryable: true,
        created_at: '2026-11-19T00:00:00.000Z',
        finished_at: '2026-11-19T00:00:02.000Z',
      } satisfies JobStatusDTO)
      .mockResolvedValueOnce({
        job_id: 'job-fail-2',
        kind: 'roadmap_revision',
        status: 'failed',
        result_ref: null,
        error: {
          code: 'STALE_JOB_INPUT',
          message: 'Source data changed',
          retryable: false,
        },
        retryable: false,
        created_at: '2026-11-19T00:00:03.000Z',
        finished_at: '2026-11-19T00:00:04.000Z',
      } satisfies JobStatusDTO);

    render(
      <RoadmapDraftView
        accessToken="token-1"
        roadmapId="rm-draft-1"
        pollJobStatus={pollMock}
      />,
    );
    expect(await screen.findByText('Draft v1')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Revision instruction/i), {
      target: { value: 'Add more SQL exercises.' },
    });

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit Revision' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Poll 1 -> retryable failure -> Retry button appears
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    const retryBtn = screen.getByRole('button', { name: 'Retry' });

    // Clicking Retry MUST dispatch a 2nd reviseRoadmap call with a fresh Idempotency-Key
    await act(async () => {
      fireEvent.click(retryBtn);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(vi.mocked(reviseRoadmap)).toHaveBeenCalledTimes(2);
    const firstKey = vi.mocked(reviseRoadmap).mock.calls[0][3];
    const secondKey = vi.mocked(reviseRoadmap).mock.calls[1][3];
    expect(secondKey).not.toBe(firstKey);

    // Poll 2 -> non-retryable terminal failure -> releases activeJob so Lock & Submit are enabled again + shows dismissible error
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.useRealTimers();

    expect(screen.getByText('Draft update failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lock Roadmap' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Draft update failed')).not.toBeInTheDocument();
  });

  it('binds large-draft confirmation checkbox to draft.version_no so reloading a newer version requires fresh confirmation', async () => {
    const largeV1 = makeDraft({
      version_no: 1,
      size_guardrail: {
        active_topic_count: 50,
        soft_max_topics: 45,
        materially_large: true,
        warning: '50 active topics exceed 45.',
      },
    });
    const largeV2 = makeDraft({
      version_no: 2,
      size_guardrail: {
        active_topic_count: 52,
        soft_max_topics: 45,
        materially_large: true,
        warning: '52 active topics exceed 45.',
      },
    });

    vi.mocked(getRoadmap)
      .mockResolvedValueOnce(largeV1)
      .mockResolvedValueOnce(largeV2);
    vi.mocked(lockRoadmap).mockRejectedValueOnce(
      new ApiError(409, 'Version changed', 'STALE_VERSION'),
    );

    render(<RoadmapDraftView accessToken="token-1" roadmapId="rm-draft-1" />);
    expect(await screen.findByText('Draft v1')).toBeInTheDocument();

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByRole('button', { name: 'Lock Roadmap' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Lock Roadmap' }));
    expect(await screen.findByRole('button', { name: 'Reload Draft' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reload Draft' }));
    expect(await screen.findByText('Draft v2')).toBeInTheDocument();
    // Version changed v1 -> v2: checkbox MUST automatically reset and Lock MUST be disabled
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Lock Roadmap' })).toBeDisabled();
  });

  it('disables Lock Roadmap and revision textarea while revision POST is in flight (submittingRevision)', async () => {
    let resolveRevise!: (val: {
      job_id: string;
      kind: string;
      status: 'queued';
      poll_url: string;
      retry_after_seconds: number;
    }) => void;
    vi.mocked(reviseRoadmap).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRevise = resolve;
        }),
    );

    render(
      <RoadmapDraftView
        accessToken="token-1"
        roadmapId="rm-draft-1"
        initialDraft={makeDraft({ version_no: 1 })}
      />,
    );

    const textarea = screen.getByLabelText(/Revision instruction/i);
    fireEvent.change(textarea, {
      target: { value: 'Add distributed tracing exercises.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Revision' }));

    expect(screen.getByRole('button', { name: 'Lock Roadmap' })).toBeDisabled();
    expect(textarea).toBeDisabled();

    await act(async () => {
      resolveRevise({
        job_id: 'job-in-flight-1',
        kind: 'roadmap_revision',
        status: 'queued',
        poll_url: '/api/v1/jobs/job-in-flight-1',
        retry_after_seconds: 5,
      });
      await Promise.resolve();
    });
  });

  it('renders archived roadmaps on /draft as read-only and hides Refresh Stale Draft when generation feature is disabled', () => {
    const { rerender } = render(
      <RoadmapDraftView
        accessToken="token-1"
        roadmapId="rm-draft-1"
        initialDraft={makeDraft({ status: 'archived', version_no: 2 })}
      />,
    );

    expect(screen.getByText('Archived roadmap — read-only')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'View Archived Roadmap' }),
    ).toHaveAttribute('href', '/roadmaps/rm-draft-1');
    expect(
      screen.queryByRole('button', { name: 'Lock Roadmap' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Submit Revision' }),
    ).not.toBeInTheDocument();

    rerender(
      <RoadmapDraftView
        accessToken="token-1"
        roadmapId="rm-draft-1"
        featureEnabled={false}
        initialDraft={makeDraft({
          status: 'draft',
          stale: true,
          stale_reason: 'Profile skills changed.',
        })}
      />,
    );

    expect(
      screen.getByText('Stale draft — refresh required before locking'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Refresh Stale Draft/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lock Roadmap' })).toBeDisabled();
  });
});
