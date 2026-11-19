import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  ApiError,
  archiveRoadmap,
  focusRoadmap,
  generateRoadmap,
  listRoadmaps,
  type JobStatusDTO,
  type RoadmapSummaryDTO,
} from '@/lib/api/client';
import { RoadmapsHubView } from '@/components/roadmap/roadmaps-hub-view';
import { RoadmapGenerateHandoff } from '@/components/roadmap/roadmap-generate-handoff';

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
    listRoadmaps: vi.fn(),
    focusRoadmap: vi.fn(),
    archiveRoadmap: vi.fn(),
    generateRoadmap: vi.fn(),
  };
});

function makeSummary(
  overrides: Partial<RoadmapSummaryDTO> = {},
): RoadmapSummaryDTO {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    career_goal_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    canonical_role_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    role_name: 'Backend Developer',
    target_level: 'junior',
    status: 'locked',
    is_focus: true,
    current_version_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    current_version_no: 2,
    draft_version_no: null,
    has_open_draft: false,
    has_open_merge: false,
    has_daily_plan: true,
    stale: false,
    stale_draft: false,
    locked_at: '2026-11-19T10:00:00.000Z',
    archived_at: null,
    created_at: '2026-11-19T09:00:00.000Z',
    updated_at: '2026-11-19T10:00:00.000Z',
    ...overrides,
  };
}

describe('RoadmapsHubView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('loads roadmaps, displays focus/stale/open-merge badges, filters by status, and loads more via cursor', async () => {
    const focusedLocked = makeSummary({
      id: 'rm-1',
      role_name: 'Backend Developer',
      status: 'locked',
      is_focus: true,
      has_open_merge: true,
      current_version_no: 2,
    });
    const staleDraft = makeSummary({
      id: 'rm-2',
      role_name: 'QA Automation Engineer',
      status: 'draft',
      is_focus: false,
      current_version_id: null,
      current_version_no: null,
      draft_version_no: 1,
      has_open_draft: true,
      stale: true,
      stale_draft: true,
      has_daily_plan: false,
    });
    const pageTwoItem = makeSummary({
      id: 'rm-3',
      role_name: 'Cloud DevOps Engineer',
      status: 'archived',
      is_focus: false,
      current_version_no: 1,
    });

    vi.mocked(listRoadmaps)
      .mockResolvedValueOnce({
        items: [focusedLocked, staleDraft],
        meta: { limit: 20, next_cursor: 'cursor-page-2' },
      })
      .mockResolvedValueOnce({
        items: [pageTwoItem],
        meta: { limit: 20, next_cursor: null },
      })
      .mockResolvedValueOnce({
        items: [staleDraft],
        meta: { limit: 20, next_cursor: null },
      });

    render(<RoadmapsHubView accessToken="token-1" />);

    expect(await screen.findByText('Backend Developer')).toBeInTheDocument();
    expect(screen.getByText('QA Automation Engineer')).toBeInTheDocument();
    expect(screen.getByText('Focus Roadmap')).toBeInTheDocument();
    expect(screen.getByText('Stale Draft')).toBeInTheDocument();
    expect(screen.getByText('Open Merge')).toBeInTheDocument();

    expect(
      screen.getByRole('link', { name: /Review Draft/i }),
    ).toHaveAttribute('href', '/roadmaps/rm-2/draft');
    expect(
      screen.getByRole('link', { name: /View Roadmap/i }),
    ).toHaveAttribute('href', '/roadmaps/rm-1');

    fireEvent.click(screen.getByRole('button', { name: 'Load more roadmaps' }));
    expect(await screen.findByText('Cloud DevOps Engineer')).toBeInTheDocument();
    expect(vi.mocked(listRoadmaps)).toHaveBeenCalledWith(
      'token-1',
      { cursor: 'cursor-page-2', limit: 20 },
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Draft' }));
    await waitFor(() => {
      expect(vi.mocked(listRoadmaps)).toHaveBeenCalledWith(
        'token-1',
        { status: 'draft', limit: 20 },
        expect.any(Object),
      );
    });
  });

  it('handles inline Focus Switch (EP-R14) and Archive confirmation modal (EP-R15)', async () => {
    const rmLocked = makeSummary({
      id: 'rm-locked-2',
      role_name: 'Frontend Developer',
      status: 'locked',
      is_focus: false,
      has_daily_plan: false,
    });
    const rmOther = makeSummary({
      id: 'rm-locked-1',
      role_name: 'Backend Developer',
      status: 'locked',
      is_focus: true,
    });

    vi.mocked(listRoadmaps).mockResolvedValueOnce({
      items: [rmOther, rmLocked],
      meta: { limit: 20, next_cursor: null },
    });
    vi.mocked(focusRoadmap).mockResolvedValueOnce({
      focus_roadmap_id: 'rm-locked-2',
      daily_plan: {
        state: 'missing',
        plan_id: null,
        requires_learning_hours: true,
      },
    });
    vi.mocked(archiveRoadmap).mockResolvedValueOnce({
      archived_roadmap_id: 'rm-locked-2',
      status: 'archived',
      new_focus_roadmap_id: 'rm-locked-1',
    });

    render(<RoadmapsHubView accessToken="token-1" />);

    expect(await screen.findByText('Frontend Developer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Set as Focus' }));
    expect(
      await screen.findByText(/daily learning hours needed/i),
    ).toBeInTheDocument();
    expect(vi.mocked(focusRoadmap)).toHaveBeenCalledWith(
      'token-1',
      'rm-locked-2',
    );

    const archiveButtons = screen.getAllByRole('button', { name: 'Archive' });
    fireEvent.click(archiveButtons[1]);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.textContent).toMatch(/preserves all learning progress/i);
    expect(dialog.textContent).toMatch(/focus will automatically reassign/i);

    fireEvent.click(screen.getByRole('button', { name: 'Archive Roadmap' }));
    expect(
      await screen.findByText(/focus automatically reassigned/i),
    ).toBeInTheDocument();
    expect(vi.mocked(archiveRoadmap)).toHaveBeenCalledWith(
      'token-1',
      'rm-locked-2',
    );
  });
});

describe('RoadmapGenerateHandoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('triggers EP-R01 with client UUID Idempotency-Key, polls EP-J01 via AILoadingState, and routes to draft', async () => {
    vi.useFakeTimers();
    vi.mocked(generateRoadmap).mockResolvedValueOnce({
      job_id: 'job-r01-1',
      kind: 'roadmap_generate',
      status: 'queued',
      poll_url: '/api/v1/jobs/job-r01-1',
      retry_after_seconds: 1,
    });

    const pollMock = vi.fn(
      async (): Promise<JobStatusDTO> => ({
        job_id: 'job-r01-1',
        kind: 'roadmap_generate',
        status: 'succeeded',
        result_ref: { type: 'roadmap', id: 'roadmap-new-1' },
        error: null,
        retryable: false,
        created_at: '2026-11-19T00:00:00.000Z',
        finished_at: '2026-11-19T00:00:02.000Z',
      }),
    );

    render(
      <RoadmapGenerateHandoff
        accessToken="token-1"
        careerGoalId="goal-uuid-1"
        targetLevel="mid"
        levelConfirmed={true}
        pollJobStatus={pollMock}
      />,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Generate Roadmap Draft' }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(vi.mocked(generateRoadmap)).toHaveBeenCalledTimes(1);

    const call = vi.mocked(generateRoadmap).mock.calls[0];
    expect(call[1]).toEqual({
      career_goal_id: 'goal-uuid-1',
      target_level: 'mid',
      level_confirmed: true,
    });
    expect(call[2]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    expect(
      screen.getByText('Generating your roadmap draft'),
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
    });

    expect(mockPush).toHaveBeenCalledWith('/roadmaps/roadmap-new-1/draft');
  });

  it('reuses Idempotency-Key across retry of a failed HTTP POST and clears on 409 conflict', async () => {
    vi.mocked(generateRoadmap)
      .mockRejectedValueOnce(new ApiError(503, 'Service unavailable', 'AI_BUDGET_EXHAUSTED', undefined, [], true))
      .mockRejectedValueOnce(new ApiError(409, 'Conflict', 'ROADMAP_LIMIT_REACHED'));

    render(
      <RoadmapGenerateHandoff
        accessToken="token-1"
        careerGoalId="goal-uuid-1"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Generate Roadmap Draft' }),
    );
    expect(
      await screen.findByText(/capacity is temporarily unavailable/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByText(/maximum of 3 active roadmaps/i)).toBeInTheDocument();

    const firstKey = vi.mocked(generateRoadmap).mock.calls[0][2];
    const secondKey = vi.mocked(generateRoadmap).mock.calls[1][2];
    expect(secondKey).toBe(firstKey);
  });
});
