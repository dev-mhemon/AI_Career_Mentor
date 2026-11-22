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
  createDailyPlan,
  getDailyPlan,
  listRoadmaps,
  rebuildDailyPlan,
  type DailyPlanResponseDTO,
  type RoadmapSummaryDTO,
} from '@/lib/api/client';
import { DailyPlanView } from './daily-plan-view';

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>(
    '@/lib/api/client',
  );
  return {
    ...actual,
    getDailyPlan: vi.fn(),
    listRoadmaps: vi.fn(),
    createDailyPlan: vi.fn(),
    rebuildDailyPlan: vi.fn(),
  };
});

function makeRoadmapSummary(
  overrides: Partial<RoadmapSummaryDTO> = {},
): RoadmapSummaryDTO {
  return {
    id: 'rm-1',
    career_goal_id: 'goal-1',
    canonical_role_id: 'role-1',
    role_name: 'Backend Engineer',
    target_level: 'senior',
    status: 'locked',
    is_focus: true,
    current_version_id: 'ver-1',
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

function makePlan(
  overrides: Partial<DailyPlanResponseDTO> = {},
): DailyPlanResponseDTO {
  return {
    plan_id: 'plan-1',
    roadmap_id: 'rm-1',
    roadmap_version_no: 2,
    is_focus: true,
    hours_per_day: 2,
    total_days: 3,
    completed_days: 1,
    next_incomplete_day_no: 2,
    days: [
      {
        day_no: 1,
        status: 'completed',
        completed_at: '2026-11-19T12:00:00.000Z',
        topics: [
          {
            plan_item_id: 'pi-1',
            topic_id: 'top-1',
            title: 'HTTP & REST Semantics',
          },
        ],
      },
      {
        day_no: 2,
        status: 'pending',
        completed_at: null,
        topics: [
          {
            plan_item_id: 'pi-2',
            topic_id: 'top-2',
            title: 'Transactional Outbox Pattern',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('DailyPlanView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDailyPlan).mockReset();
    vi.mocked(listRoadmaps).mockReset();
    vi.mocked(createDailyPlan).mockReset();
    vi.mocked(rebuildDailyPlan).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders sequential Day N cards without calendar dates, loads next cursor page, and switches locked roadmap tabs', async () => {
    vi.mocked(listRoadmaps).mockResolvedValueOnce({
      items: [
        makeRoadmapSummary({
          id: 'rm-1',
          role_name: 'Backend Engineer',
          is_focus: true,
        }),
        makeRoadmapSummary({
          id: 'rm-2',
          role_name: 'Platform Engineer',
          is_focus: false,
        }),
      ],
      meta: { limit: 50, next_cursor: null },
    });

    vi.mocked(getDailyPlan)
      .mockResolvedValueOnce({
        plan: makePlan(),
        meta: { limit: 20, next_cursor: 'cursor-day-3' },
      })
      .mockResolvedValueOnce({
        plan: makePlan({
          days: [
            {
              day_no: 3,
              status: 'pending',
              completed_at: null,
              topics: [
                {
                  plan_item_id: 'pi-3',
                  topic_id: 'top-3',
                  title: 'Distributed Tracing',
                },
              ],
            },
          ],
        }),
        meta: { limit: 20, next_cursor: null },
      })
      .mockResolvedValueOnce({
        plan: makePlan({
          plan_id: 'plan-2',
          roadmap_id: 'rm-2',
          is_focus: false,
          hours_per_day: 1.5,
          total_days: 1,
          completed_days: 0,
          next_incomplete_day_no: 1,
          days: [
            {
              day_no: 1,
              status: 'pending',
              completed_at: null,
              topics: [
                {
                  plan_item_id: 'pi-9',
                  topic_id: 'top-9',
                  title: 'Kubernetes Ingress',
                },
              ],
            },
          ],
        }),
        meta: { limit: 20, next_cursor: null },
      });

    render(<DailyPlanView accessToken="token-1" />);

    expect(
      await screen.findByText('Transactional Outbox Pattern'),
    ).toBeInTheDocument();
    const timeline = screen.getByRole('region', {
      name: 'Sequential learning days',
    });
    expect(within(timeline).getByText('Day 1')).toBeInTheDocument();
    expect(within(timeline).getByText('Completed')).toBeInTheDocument();
    expect(within(timeline).getByText('Day 2')).toBeInTheDocument();
    expect(within(timeline).getByText('Today')).toBeInTheDocument();
    expect(within(timeline).queryByText('Up Next')).not.toBeInTheDocument();
    expect(within(timeline).queryByText('Pending')).not.toBeInTheDocument();
    expect(within(timeline).queryByText('Upcoming')).not.toBeInTheDocument();
    expect(screen.getByText('1 / 3 days')).toBeInTheDocument();
    expect(screen.getByText('Current Day')).toBeInTheDocument();
    expect(
      screen.getByText(/Sequential learning days paced to your available hours/i),
    ).toHaveClass('w-full', 'max-w-xl', 'text-pretty');
    expect(
      screen.getByRole('button', { name: /Rebuild Plan/i }),
    ).toHaveClass('whitespace-nowrap', 'shrink-0');
    expect(
      screen.getByRole('link', { name: /Open Today/i }),
    ).toHaveClass('whitespace-nowrap', 'shrink-0');
    expect(
      screen.getByRole('link', { name: /Study Day 2/i }),
    ).toHaveClass('whitespace-nowrap', 'shrink-0');
    expect(
      screen.queryByRole('button', { name: /Mark Complete/i }),
    ).not.toBeInTheDocument();

    // Load more days via cursor -> future Day 3 is unambiguously labeled Upcoming (never Pending/Up Next)
    fireEvent.click(screen.getByRole('button', { name: 'Load more days' }));
    expect(
      await screen.findByText('Distributed Tracing'),
    ).toBeInTheDocument();
    expect(within(timeline).getByText('Upcoming')).toBeInTheDocument();
    expect(within(timeline).queryByText('Pending')).not.toBeInTheDocument();
    expect(within(timeline).queryByText('Up Next')).not.toBeInTheDocument();
    expect(getDailyPlan).toHaveBeenCalledWith(
      'token-1',
      { roadmap_id: 'rm-1', limit: 20, cursor: 'cursor-day-3' },
      expect.any(Object),
    );

    // Switch locked roadmap tab
    fireEvent.click(screen.getByRole('tab', { name: /Platform Engineer/i }));
    expect(
      await screen.findByText('Kubernetes Ingress'),
    ).toBeInTheDocument();
    expect(getDailyPlan).toHaveBeenLastCalledWith(
      'token-1',
      { roadmap_id: 'rm-2', limit: 20 },
      expect.any(Object),
    );
  });

  it('rebuilds future incomplete days via HoursPromptModal (EP-L03) and keeps Rebuild disabled when dailyPlanEnabled is false', async () => {
    vi.mocked(listRoadmaps).mockResolvedValue({
      items: [makeRoadmapSummary()],
      meta: { limit: 50, next_cursor: null },
    });
    vi.mocked(getDailyPlan)
      .mockResolvedValueOnce({
        plan: makePlan(),
        meta: { limit: 20, next_cursor: null },
      })
      .mockResolvedValueOnce({
        plan: makePlan({ hours_per_day: 3, total_days: 2 }),
        meta: { limit: 20, next_cursor: null },
      });
    vi.mocked(rebuildDailyPlan).mockResolvedValueOnce(
      makePlan({ hours_per_day: 3, total_days: 2 }),
    );

    const { rerender } = render(
      <DailyPlanView accessToken="token-1" dailyPlanEnabled={true} />,
    );

    expect(
      await screen.findByText('Transactional Outbox Pattern'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Rebuild Plan/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '3h' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Save & Rebuild Plan' }),
    );

    expect(
      await screen.findByText(/Daily Plan rebuilt at 3 hrs\/day/i),
    ).toBeInTheDocument();
    const progressBar = screen.getByTestId('daily-plan-banner-progress');
    expect(progressBar).toHaveClass('agy-plan-banner-bar');
    expect(progressBar.style.getPropertyValue('--banner-duration')).toBe(
      '5000ms',
    );

    rerender(<DailyPlanView accessToken="token-1" dailyPlanEnabled={false} />);
    expect(
      screen.getByRole('button', { name: /Rebuild Plan/i }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Plan creation & rebuild paused/i),
    ).toBeInTheDocument();
  });

  it('auto-dismisses the Daily Plan success banner after 5000ms and supports manual dismiss', async () => {
    vi.useFakeTimers();
    vi.mocked(listRoadmaps).mockResolvedValue({
      items: [makeRoadmapSummary()],
      meta: { limit: 50, next_cursor: null },
    });
    vi.mocked(getDailyPlan).mockResolvedValue({
      plan: makePlan({ hours_per_day: 3, total_days: 2 }),
      meta: { limit: 20, next_cursor: null },
    });
    vi.mocked(rebuildDailyPlan).mockResolvedValueOnce(
      makePlan({ hours_per_day: 3, total_days: 2 }),
    );

    render(
      <DailyPlanView
        accessToken="token-1"
        initialPlan={makePlan()}
        initialLockedRoadmaps={[makeRoadmapSummary()]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Rebuild Plan/i }));
    fireEvent.click(screen.getByRole('button', { name: '3h' }));
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Save & Rebuild Plan' }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      screen.getByTestId('daily-plan-success-banner'),
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(
      screen.queryByTestId('daily-plan-success-banner'),
    ).not.toBeInTheDocument();
  });

  it('renders DAILY_PLAN_NOT_FOUND empty state and creates Daily Plan via HoursPromptModal (EP-L02)', async () => {
    vi.mocked(listRoadmaps).mockResolvedValueOnce({
      items: [makeRoadmapSummary({ id: 'rm-1', has_daily_plan: false })],
      meta: { limit: 50, next_cursor: null },
    });
    vi.mocked(getDailyPlan)
      .mockRejectedValueOnce(
        new ApiError(404, 'missing plan', 'DAILY_PLAN_NOT_FOUND'),
      )
      .mockResolvedValueOnce({
        plan: makePlan({ hours_per_day: 2 }),
        meta: { limit: 20, next_cursor: null },
      });
    vi.mocked(createDailyPlan).mockResolvedValueOnce(
      makePlan({ hours_per_day: 2 }),
    );

    render(
      <DailyPlanView
        accessToken="token-1"
        initialRoadmapId="rm-1"
        preferredDailyHours={2}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: 'No Daily Plan created yet' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Daily Plan' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create Daily Plan' }),
    );

    await waitFor(() => {
      expect(createDailyPlan).toHaveBeenCalledWith(
        'token-1',
        { roadmap_id: 'rm-1', hours_per_day: 2 },
        expect.stringMatching(/^[0-9a-f-]{36}$/i),
      );
      expect(
        screen.getByText(/Daily Plan created at 2 hrs\/day/i),
      ).toBeInTheDocument();
    });
  });

  it('shows inline metadata failure recovery with Retry button when listRoadmaps fails without initialRoadmapId, and recovers on Retry', async () => {
    vi.mocked(listRoadmaps)
      .mockRejectedValueOnce(new ApiError(503, 'upstream down', 'SERVICE_UNAVAILABLE'))
      .mockResolvedValueOnce({
        items: [makeRoadmapSummary({ id: 'rm-focus', is_focus: true, has_daily_plan: false })],
        meta: { limit: 50, next_cursor: null },
      });
    vi.mocked(getDailyPlan).mockRejectedValueOnce(
      new ApiError(404, 'missing plan', 'DAILY_PLAN_NOT_FOUND'),
    );

    render(<DailyPlanView accessToken="token-1" />);

    expect(
      await screen.findByText(/Could not load locked roadmap details/i),
    ).toBeInTheDocument();
    const createBtn = screen.getByRole('button', { name: 'Create Daily Plan' });
    expect(createBtn).toBeDisabled();

    fireEvent.click(
      screen.getByRole('button', { name: /Retry Roadmap Load/i }),
    );

    await waitFor(() => {
      expect(
        screen.queryByText(/Could not load locked roadmap details/i),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Create Daily Plan' }),
      ).not.toBeDisabled();
    });
  });

  it('shows both Today and In Progress badges only when the active day has status in_progress, and resets loadingMore on token/request invalidation', async () => {
    let resolveLoadMore!: (val: {
      plan: DailyPlanResponseDTO;
      meta: { limit: number; next_cursor: string | null };
    }) => void;
    const pendingPage = new Promise<{
      plan: DailyPlanResponseDTO;
      meta: { limit: number; next_cursor: string | null };
    }>((resolve) => {
      resolveLoadMore = resolve;
    });

    vi.mocked(getDailyPlan)
      .mockReturnValueOnce(pendingPage)
      .mockResolvedValueOnce({
        plan: makePlan({
          days: [
            {
              day_no: 2,
              status: 'in_progress',
              completed_at: null,
              topics: [
                {
                  plan_item_id: 'pi-2',
                  topic_id: 'top-2',
                  title: 'In Progress Topic',
                },
              ],
            },
          ],
        }),
        meta: { limit: 20, next_cursor: 'cursor-page-2' },
      });

    const { rerender } = render(
      <DailyPlanView
        accessToken="token-1"
        initialPlan={makePlan({
          days: [
            {
              day_no: 2,
              status: 'in_progress',
              completed_at: null,
              topics: [
                {
                  plan_item_id: 'pi-2',
                  topic_id: 'top-2',
                  title: 'In Progress Topic',
                },
              ],
            },
          ],
        })}
        initialNextCursor="cursor-day-3"
        initialLockedRoadmaps={[makeRoadmapSummary()]}
      />,
    );

    const timeline = screen.getByRole('region', {
      name: 'Sequential learning days',
    });
    expect(within(timeline).getByText('Today')).toBeInTheDocument();
    expect(within(timeline).getByText('In Progress')).toBeInTheDocument();

    // Start Load More then immediately change accessToken to invalidate in-flight pagination
    fireEvent.click(screen.getByRole('button', { name: 'Load more days' }));
    expect(
      screen.getByRole('button', { name: /Loading more days/i }),
    ).toBeDisabled();

    rerender(
      <DailyPlanView
        accessToken="token-2"
        initialLockedRoadmaps={[makeRoadmapSummary()]}
      />,
    );

    const loadMoreBtn = await screen.findByRole('button', {
      name: 'Load more days',
    });
    expect(loadMoreBtn).not.toBeDisabled();

    // Resolve the stale pagination promise inside act -> must remain ignored and keep Load more days enabled
    await act(async () => {
      resolveLoadMore({
        plan: makePlan({ days: [] }),
        meta: { limit: 20, next_cursor: null },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('In Progress Topic')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Load more days' }),
    ).not.toBeDisabled();
  });
});
