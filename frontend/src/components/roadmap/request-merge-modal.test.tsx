import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import {
  createRoadmapMerge,
  getJobStatus,
  getRoadmapMerge,
  type MergeProposalDTO,
} from '@/lib/api/client';
import { RequestMergeModal } from '@/components/roadmap/request-merge-modal';

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>(
    '@/lib/api/client',
  );
  return {
    ...actual,
    createRoadmapMerge: vi.fn(),
    getJobStatus: vi.fn(),
    getRoadmapMerge: vi.fn(),
  };
});

const GENERATED_MERGE: MergeProposalDTO = {
  id: 'merge-99',
  roadmap_id: 'rm-locked-1',
  origin: 'level_change',
  status: 'proposed',
  base_version_id: 'ver-2',
  base_version_no: 2,
  result_version_id: null,
  target_level: 'senior',
  instruction: 'Focus on distributed systems',
  reason: 'Elevates roadmap depth to Senior level.',
  operations: [
    {
      id: 'op-1',
      sort_order: 1,
      op: 'add_topic',
      item_id: null,
      lineage_id: null,
      topic_id: 'top-dist',
      skill_id: 'sk-1',
      title: 'Distributed Consensus & Saga Patterns',
      priority: 'core',
      reason: 'Required for Senior backend scope',
      payload: { phase_no: 3 },
    },
  ],
  size_impact: {
    active_topics_before: 12,
    active_topics_after: 13,
    before: 12,
    after: 13,
    delta: 1,
    soft_limit: 45,
    materially_large: false,
    warning: null,
  },
  daily_plan_impact: {
    has_active_plan: true,
    completed_days_unchanged: 5,
    future_days_affected: 4,
  },
  undo_available: false,
  created_at: '2026-11-23T12:00:00.000Z',
  accepted_at: null,
  rejected_at: null,
  undone_at: null,
  undo_window_closed_at: null,
};

describe('RequestMergeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.sessionStorage.clear();
  });

  it('disables submit until user_request instruction >= 3 chars, shows required indicator & teal active tab, and validates after blur', () => {
    render(
      <RequestMergeModal
        open
        initialMode="user_request"
        accessToken="tok-1"
        roadmapId="rm-locked-1"
        roadmapTitle="Backend Engineer"
        currentTargetLevel="mid"
        currentVersionNo={2}
        onClose={vi.fn()}
        onMergeCreated={vi.fn()}
      />,
    );

    const requestTab = screen.getByRole('tab', { name: 'Request Change' });
    expect(requestTab).toHaveAttribute('aria-selected', 'true');
    expect(requestTab).toHaveClass('text-teal-700', 'font-semibold', 'bg-white');

    const textarea = screen.getByLabelText(/what would you like to change/i);
    expect(textarea).toHaveAttribute('required');
    expect(textarea).toHaveAttribute('aria-required', 'true');

    const submitBtn = screen.getByRole('button', {
      name: 'Generate Merge Proposal',
    });
    expect(submitBtn).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: 'hi' } });
    expect(submitBtn).toBeDisabled();
    fireEvent.blur(textarea);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /at least 3 characters/i,
    );

    fireEvent.change(textarea, { target: { value: 'Add Redis caching' } });
    expect(submitBtn).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(createRoadmapMerge).not.toHaveBeenCalled();
  });

  it('resets unconfirmed level selection cleanly on close and reopen', () => {
    const { rerender } = render(
      <RequestMergeModal
        open
        initialMode="level_change"
        accessToken="tok-1"
        roadmapId="rm-locked-1"
        roadmapTitle="Backend Engineer"
        currentTargetLevel="junior"
        currentVersionNo={2}
        onClose={vi.fn()}
        onMergeCreated={vi.fn()}
      />,
    );

    const transitionBadge = screen.getByTestId('level-transition-badge');
    expect(transitionBadge).toHaveTextContent('Current: Junior');
    expect(transitionBadge).toHaveTextContent('Select a level');

    const submitBtn = screen.getByRole('button', {
      name: 'Generate Level Change Proposal',
    });
    expect(submitBtn).toBeDisabled();

    const seniorBtn = screen.getByRole('button', { name: /Senior/i });
    fireEvent.click(seniorBtn);
    expect(seniorBtn).toHaveAttribute('aria-pressed', 'true');
    expect(seniorBtn).toHaveTextContent('Proposed target');
    expect(transitionBadge).toHaveTextContent('Proposed: Senior');
    expect(submitBtn).toBeEnabled();

    // Close and reopen without submitting -> unconfirmed selection resets cleanly
    rerender(
      <RequestMergeModal
        open={false}
        initialMode="level_change"
        accessToken="tok-1"
        roadmapId="rm-locked-1"
        roadmapTitle="Backend Engineer"
        currentTargetLevel="junior"
        currentVersionNo={2}
        onClose={vi.fn()}
        onMergeCreated={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <RequestMergeModal
        open
        initialMode="level_change"
        accessToken="tok-1"
        roadmapId="rm-locked-1"
        roadmapTitle="Backend Engineer"
        currentTargetLevel="junior"
        currentVersionNo={2}
        onClose={vi.fn()}
        onMergeCreated={vi.fn()}
      />,
    );

    const reopenedBadge = screen.getByTestId('level-transition-badge');
    expect(reopenedBadge).toHaveTextContent('Current: Junior');
    expect(reopenedBadge).toHaveTextContent('Select a level');
    expect(
      screen.getByRole('button', { name: /Senior/i }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByRole('button', { name: 'Generate Level Change Proposal' }),
    ).toBeDisabled();
  });

  it('clears sessionStorage on terminal failed job, renders cached error without re-polling on same-session reopen, and resets cleanly on Start a different request', async () => {
    vi.useFakeTimers();

    vi.mocked(createRoadmapMerge).mockResolvedValueOnce({
      job_id: 'job-fail-1',
      kind: 'merge_proposal',
      status: 'queued',
      poll_url: '/api/v1/jobs/job-fail-1',
      retry_after_seconds: 1,
    });
    vi.mocked(getJobStatus).mockResolvedValueOnce({
      job_id: 'job-fail-1',
      kind: 'merge_proposal',
      status: 'failed',
      result_ref: null,
      error: {
        code: 'AI_BUDGET_EXHAUSTED',
        message:
          'AI capacity is temporarily unavailable. Existing data remains accessible.',
        retryable: false,
      },
      retryable: false,
      created_at: '2026-11-23T16:00:55.000Z',
      finished_at: '2026-11-23T16:02:23.000Z',
    });

    const { rerender } = render(
      <RequestMergeModal
        open
        initialMode="user_request"
        accessToken="tok-1"
        roadmapId="rm-locked-1"
        roadmapTitle="Backend Engineer"
        currentTargetLevel="junior"
        currentVersionNo={1}
        onClose={vi.fn()}
        onMergeCreated={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/what would you like to change/i), {
      target: { value: 'Add Airflow DAG orchestration' },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Generate Merge Proposal' }),
      );
      await Promise.resolve();
    });

    // While in-flight, sessionStorage tracks the active job
    expect(
      window.sessionStorage.getItem('acm:merge-job:rm-locked-1'),
    ).not.toBeNull();

    // Poll settles to terminal failed -> sessionStorage cleared immediately & cached error card rendered
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });

    expect(getJobStatus).toHaveBeenCalledTimes(1);
    expect(
      window.sessionStorage.getItem('acm:merge-job:rm-locked-1'),
    ).toBeNull();
    expect(screen.getByTestId('merge-job-failed-card')).toHaveTextContent(
      'AI capacity is temporarily unavailable. Existing data remains accessible.',
    );

    // Same-session close & reopen -> renders cached error immediately, ZERO re-polling, ZERO Preparing flash
    rerender(
      <RequestMergeModal
        open={false}
        initialMode="user_request"
        accessToken="tok-1"
        roadmapId="rm-locked-1"
        roadmapTitle="Backend Engineer"
        currentTargetLevel="junior"
        currentVersionNo={1}
        onClose={vi.fn()}
        onMergeCreated={vi.fn()}
      />,
    );
    rerender(
      <RequestMergeModal
        open
        initialMode="user_request"
        accessToken="tok-1"
        roadmapId="rm-locked-1"
        roadmapTitle="Backend Engineer"
        currentTargetLevel="junior"
        currentVersionNo={1}
        onClose={vi.fn()}
        onMergeCreated={vi.fn()}
      />,
    );

    expect(screen.getByTestId('merge-job-failed-card')).toHaveTextContent(
      'AI capacity is temporarily unavailable. Existing data remains accessible.',
    );
    expect(screen.queryByText(/Preparing/i)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(getJobStatus).toHaveBeenCalledTimes(1);

    // Clicking "Start a different request" clears cached failure and returns to the clean form
    const resetBtn = screen.getByRole('button', {
      name: 'Start a different request',
    });
    expect(resetBtn).toHaveClass(
      'inline-flex',
      'items-center',
      'justify-center',
      'border-slate-200',
      'bg-white',
      'text-slate-700',
      'shadow-xs',
      'leading-none',
    );
    expect(resetBtn.querySelector('svg')).toHaveClass('block', 'shrink-0');
    fireEvent.click(resetBtn);
    expect(
      screen.queryByTestId('merge-job-failed-card'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText(/what would you like to change/i),
    ).toBeInTheDocument();
  });

  it('opens cleanly to fresh form with zero new polls when unmounted and remounted directly after terminal failure', async () => {
    vi.useFakeTimers();

    vi.mocked(createRoadmapMerge).mockResolvedValueOnce({
      job_id: 'job-failed-reload',
      kind: 'merge_proposal',
      status: 'queued',
      poll_url: '/api/v1/jobs/job-failed-reload',
      retry_after_seconds: 1,
    });
    vi.mocked(getJobStatus).mockResolvedValueOnce({
      job_id: 'job-failed-reload',
      kind: 'merge_proposal',
      status: 'failed',
      result_ref: null,
      error: {
        code: 'AI_BUDGET_EXHAUSTED',
        message: 'AI capacity temporarily unavailable.',
        retryable: true,
      },
      retryable: true,
      created_at: '2026-11-23T12:00:00.000Z',
      finished_at: '2026-11-23T12:00:02.000Z',
    });

    const { unmount } = render(
      <RequestMergeModal
        open
        initialMode="user_request"
        accessToken="tok-1"
        roadmapId="rm-locked-1"
        roadmapTitle="Backend Engineer"
        currentTargetLevel="junior"
        currentVersionNo={1}
        onClose={vi.fn()}
        onMergeCreated={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/what would you like to change/i), {
      target: { value: 'Add distributed tracing fundamentals' },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Generate Merge Proposal' }),
      );
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(getJobStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('merge-job-failed-card')).toBeInTheDocument();

    // Unmount and remount directly WITHOUT clicking "Start a different request"
    unmount();
    render(
      <RequestMergeModal
        open
        initialMode="user_request"
        accessToken="tok-1"
        roadmapId="rm-locked-1"
        roadmapTitle="Backend Engineer"
        currentTargetLevel="junior"
        currentVersionNo={1}
        onClose={vi.fn()}
        onMergeCreated={vi.fn()}
      />,
    );

    expect(
      screen.getByLabelText(/what would you like to change/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('merge-job-failed-card'),
    ).not.toBeInTheDocument();

    // Advance timers well past polling interval -> ZERO new polls start
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(getJobStatus).toHaveBeenCalledTimes(1);
  });

  it('excludes current target_level in level_change mode, keeps running job resumable (no reset button while running), supports keyboard mode switch, and retries preview fetch without duplicate job creation', async () => {
    vi.useFakeTimers();
    const onMergeCreated = vi.fn();

    vi.mocked(createRoadmapMerge).mockResolvedValueOnce({
      job_id: 'job-merge-1',
      kind: 'merge_proposal',
      status: 'queued',
      poll_url: '/api/v1/jobs/job-merge-1',
      retry_after_seconds: 1,
    });
    vi.mocked(getJobStatus).mockResolvedValueOnce({
      job_id: 'job-merge-1',
      kind: 'merge_proposal',
      status: 'succeeded',
      result_ref: { type: 'roadmap_merge', id: 'merge-99' },
      error: null,
      retryable: false,
      retry_after_seconds: 1,
      created_at: '2026-11-23T12:00:00.000Z',
      updated_at: '2026-11-23T12:00:01.000Z',
    });
    vi.mocked(getRoadmapMerge)
      .mockRejectedValueOnce(new Error('Network glitch'))
      .mockResolvedValueOnce(GENERATED_MERGE);

    render(
      <RequestMergeModal
        open
        initialMode="user_request"
        accessToken="tok-1"
        roadmapId="rm-locked-1"
        roadmapTitle="Backend Engineer"
        currentTargetLevel="mid"
        currentVersionNo={2}
        onClose={vi.fn()}
        onMergeCreated={onMergeCreated}
      />,
    );

    // Keyboard ArrowRight switches mode from Request Change -> Change Career Level
    const requestTab = screen.getByRole('tab', { name: 'Request Change' });
    const levelTab = screen.getByRole('tab', { name: 'Change Career Level' });
    expect(requestTab).toHaveAttribute('tabindex', '0');
    expect(levelTab).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(requestTab, { key: 'ArrowRight' });
    expect(levelTab).toHaveAttribute('aria-selected', 'true');
    expect(levelTab).toHaveAttribute('tabindex', '0');

    // Current level "Mid-Level" is excluded from selectable target buttons
    expect(
      screen.queryByRole('button', { name: /Mid-Level/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Junior/i })).toBeInTheDocument();
    const seniorBtn = screen.getByRole('button', { name: /Senior/i });
    expect(seniorBtn).toBeInTheDocument();
    expect(
      screen.getByText(/evolves in place without archiving/i),
    ).toBeInTheDocument();

    fireEvent.click(seniorBtn);
    fireEvent.change(screen.getByLabelText(/additional focus notes/i), {
      target: { value: 'Focus on distributed systems' },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Generate Level Change Proposal',
        }),
      );
      await Promise.resolve();
    });

    expect(createRoadmapMerge).toHaveBeenCalledWith(
      'tok-1',
      'rm-locked-1',
      {
        origin: 'level_change',
        target_level: 'senior',
        instruction: 'Focus on distributed systems',
        base_version_no: 2,
      },
      expect.stringMatching(/^[0-9a-f-]{36}$/i),
      2,
    );

    // Persists mode alongside active job in sessionStorage and does NOT render reset button while running
    const storedRaw = window.sessionStorage.getItem('acm:merge-job:rm-locked-1');
    expect(storedRaw && JSON.parse(storedRaw)).toMatchObject({
      mode: 'level_change',
      job: { job_id: 'job-merge-1' },
    });
    expect(
      screen.queryByRole('button', { name: 'Start a different request' }),
    ).not.toBeInTheDocument();

    // Advance timer for AILoadingState EP-J01 poll -> preview fetch fails first, retaining resultId for retry
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });

    expect(getJobStatus).toHaveBeenCalledWith(
      'tok-1',
      'job-merge-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(getRoadmapMerge).toHaveBeenCalledTimes(1);
    expect(onMergeCreated).not.toHaveBeenCalled();

    const retryLoadBtn = screen.getByRole('button', {
      name: 'Retry Loading Proposal',
    });
    await act(async () => {
      fireEvent.click(retryLoadBtn);
      await Promise.resolve();
    });

    expect(getRoadmapMerge).toHaveBeenCalledTimes(2);
    expect(createRoadmapMerge).toHaveBeenCalledTimes(1);
    expect(
      window.sessionStorage.getItem('acm:merge-job:rm-locked-1'),
    ).toBeNull();
    expect(onMergeCreated).toHaveBeenCalledWith(GENERATED_MERGE);
  });
});
