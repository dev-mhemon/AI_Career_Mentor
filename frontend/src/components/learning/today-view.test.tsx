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
  generateQuiz,
  getJobStatus,
  getToday,
  listLearningResources,
  submitRating,
  submitReport,
  type TodayResponseDTO,
} from '@/lib/api/client';
import { TodayView } from './today-view';

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
    getToday: vi.fn(),
    getJobStatus: vi.fn(),
    createDailyPlan: vi.fn(),
    generateQuiz: vi.fn(),
    listLearningResources: vi.fn(),
    submitRating: vi.fn(),
    submitReport: vi.fn(),
  };
});

function makeReadyToday(): TodayResponseDTO {
  return {
    status: 'ready',
    roadmap_id: 'rm-1',
    plan_id: 'plan-1',
    plan_day: {
      day_no: 2,
      total_days: 10,
      plan_item_id: 'item-1',
    },
    topic: {
      topic_id: 'top-1',
      title: 'Transactional Outbox Pattern',
      career_level: 'senior',
      required_depth: 'Production failure recovery',
      content_version: 1,
      learning_state: 'learning',
      explanation_markdown:
        '## Core Idea\n\nWrite domain changes and **outbox events** in one transaction.\n\n```sql\nINSERT INTO outbox (payload) VALUES ($1);\n```\n\n- Prevents dual-write drift\n- Supports idempotent workers',
      important_questions: [
        {
          question:
            'Why does dual-writing to Postgres and Kafka fail under partial outages?',
          answer_markdown:
            'A crash between the database commit and broker publish leaves **state and events diverged**.',
        },
      ],
      sources: [
        {
          publisher: 'PostgreSQL Docs',
          url: 'https://www.postgresql.org/docs/current/transaction-iso.html',
          retrieved_at: '2026-11-18T00:00:00.000Z',
        },
      ],
      rating_allowed: false,
      report_allowed: false,
    },
    quiz: {
      attempt_id: null,
      status: null,
      can_retry: false,
    },
    job: null,
    requires_learning_hours: false,
    preferred_daily_hours: 2,
  };
}

describe('TodayView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getToday).mockReset();
    vi.mocked(getJobStatus).mockReset();
    vi.mocked(createDailyPlan).mockReset();
    vi.mocked(listLearningResources).mockReset();
    vi.mocked(listLearningResources).mockResolvedValue({
      items: [
        {
          id: 'res-1',
          title: 'Transaction Isolation',
          publisher: 'PostgreSQL Docs',
          url: 'https://www.postgresql.org/docs/current/transaction-iso.html',
          resource_type: 'official_docs',
          retrieved_at: '2026-11-18T00:00:00.000Z',
        },
      ],
      meta: { limit: 20, next_cursor: null },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders no_focus_roadmap state with primary link to /roadmaps', async () => {
    vi.mocked(getToday).mockResolvedValueOnce({
      status: 'no_focus_roadmap',
      roadmap_id: null,
      plan_id: null,
      plan_day: null,
      topic: null,
      quiz: { attempt_id: null, status: null, can_retry: false },
      job: null,
      requires_learning_hours: false,
      preferred_daily_hours: null,
    });

    render(<TodayView accessToken="token-1" />);

    expect(
      await screen.findByRole('heading', {
        name: /Select a Focus Roadmap to start learning/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go to Roadmaps/i })).toHaveAttribute(
      'href',
      '/roadmaps',
    );
    expect(screen.getByRole('link', { name: /Ask Mentor/i })).toHaveAttribute(
      'href',
      '/mentor?context=general',
    );
  });

  it('renders no_daily_plan state, opens HoursPromptModal, creates plan via EP-L02, and reloads EP-L04', async () => {
    vi.mocked(getToday)
      .mockResolvedValueOnce({
        status: 'no_daily_plan',
        roadmap_id: 'rm-1',
        plan_id: null,
        plan_day: null,
        topic: null,
        quiz: { attempt_id: null, status: null, can_retry: false },
        job: null,
        requires_learning_hours: false,
        preferred_daily_hours: 2,
      })
      .mockResolvedValueOnce(makeReadyToday());

    vi.mocked(createDailyPlan).mockResolvedValueOnce({
      plan_id: 'plan-1',
      roadmap_id: 'rm-1',
      roadmap_version_no: 1,
      is_focus: true,
      hours_per_day: 2,
      total_days: 10,
      completed_days: 0,
      next_incomplete_day_no: 1,
      days: [],
    });

    render(<TodayView accessToken="token-1" />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: /Confirm Hours & Create Daily Plan/i,
      }),
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Create Daily Plan' }),
    );

    expect(
      await screen.findByRole('heading', {
        name: 'Transactional Outbox Pattern',
      }),
    ).toBeInTheDocument();
    expect(createDailyPlan).toHaveBeenCalledWith(
      'token-1',
      { roadmap_id: 'rm-1', hours_per_day: 2 },
      expect.stringMatching(/^[0-9a-f-]{36}$/i),
    );
    expect(getToday).toHaveBeenCalledTimes(2);
  });

  it('renders plan_completed state with links to /daily-plan and /roadmaps', async () => {
    vi.mocked(getToday).mockResolvedValueOnce({
      status: 'plan_completed',
      roadmap_id: 'rm-1',
      plan_id: 'plan-1',
      plan_day: null,
      topic: null,
      quiz: { attempt_id: null, status: null, can_retry: false },
      job: null,
      requires_learning_hours: false,
      preferred_daily_hours: 2,
    });

    render(<TodayView accessToken="token-1" />);

    expect(
      await screen.findByRole('heading', { name: 'Daily Plan completed' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Review Daily Plan/i }),
    ).toHaveAttribute('href', '/daily-plan');
    expect(
      screen.getByRole('link', { name: /Switch Focus Roadmap/i }),
    ).toHaveAttribute('href', '/roadmaps');
  });

  it('polls EP-J01 during preparing state and transitions cleanly into ready state on job success', async () => {
    vi.useFakeTimers();

    vi.mocked(getToday)
      .mockResolvedValueOnce({
        status: 'preparing',
        roadmap_id: 'rm-1',
        plan_id: 'plan-1',
        plan_day: { day_no: 2, total_days: 10 },
        topic: null,
        quiz: { attempt_id: null, status: null, can_retry: false },
        job: {
          job_id: 'job-tc-1',
          kind: 'topic_content',
          status: 'queued',
          poll_url: '/api/v1/jobs/job-tc-1',
          retry_after_seconds: 1,
        },
        requires_learning_hours: false,
        preferred_daily_hours: 2,
      })
      .mockResolvedValueOnce(makeReadyToday());

    vi.mocked(getJobStatus).mockResolvedValueOnce({
      job_id: 'job-tc-1',
      kind: 'topic_content',
      status: 'succeeded',
      result_ref: { type: 'topic', id: 'top-1' },
      retryable: false,
      error: null,
      created_at: '2026-11-20T00:00:00.000Z',
      finished_at: '2026-11-20T00:00:05.000Z',
    });

    render(<TodayView accessToken="token-1" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      screen.getByText(/Preparing today's topic study guide/i),
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.useRealTimers();

    expect(
      await screen.findByRole('heading', {
        name: 'Transactional Outbox Pattern',
      }),
    ).toBeInTheDocument();
    expect(getJobStatus).toHaveBeenCalledWith(
      'token-1',
      'job-tc-1',
      expect.any(Object),
    );
  });

  it('renders ready state with safe Markdown, collapsible Q&A, verified resource attribution, disabled M08 quiz CTA, and ZERO Mark Complete button', async () => {
    vi.mocked(getToday).mockResolvedValueOnce(makeReadyToday());

    render(<TodayView accessToken="token-1" />);

    expect(
      await screen.findByRole('heading', {
        name: 'Transactional Outbox Pattern',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Day 2 of 10')).toBeInTheDocument();
    expect(screen.getByText('Core Idea')).toBeInTheDocument();
    expect(screen.getByText('outbox events')).toBeInTheDocument();
    expect(screen.getByText(/INSERT INTO outbox/i)).toBeInTheDocument();

    // Collapsible Q&A
    const qaToggle = screen.getByRole('button', {
      name: /Why does dual-writing to Postgres and Kafka fail/i,
    });
    expect(qaToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(qaToggle);
    expect(qaToggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText(/state and events diverged/i),
    ).toBeInTheDocument();

    // Verified external resource attribution
    await waitFor(() => {
      const resourceLink = screen.getByRole('link', {
        name: /Transaction Isolation/i,
      });
      expect(resourceLink).toHaveAttribute('target', '_blank');
      expect(resourceLink).toHaveAttribute('rel', 'noopener noreferrer');
      expect(resourceLink).toHaveAttribute(
        'href',
        'https://www.postgresql.org/docs/current/transaction-iso.html',
      );
    });

    // 2-column responsive layout: left AIExplanationCard + right sticky rail with Daily Practice Quiz on top and Verified Learning Resources below
    const readyGrid = screen.getByTestId('today-ready-grid');
    expect(readyGrid.className).toContain('lg:grid-cols-12');
    const rightRail = screen.getByRole('complementary', {
      name: /Practice quiz and verified learning resources/i,
    });
    expect(rightRail.className).toContain('lg:sticky');
    expect(rightRail.className).toContain('lg:col-span-4');

    // Live M08 Start Practice Quiz button + zero "Mark Complete" button
    vi.mocked(generateQuiz).mockResolvedValueOnce({
      attempt_id: 'att-99',
      status: 'generated',
      attempt_no: 1,
      topic_id: 'top-1',
      career_level: 'senior',
      questions: [],
      saved_answers: [],
      submitted_at: null,
    });
    const quizBtn = screen.getByRole('button', {
      name: /Start Practice Quiz/i,
    });
    expect(quizBtn).not.toBeDisabled();
    expect(
      screen.queryByRole('button', { name: /Mark Complete/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(quizBtn);
    await waitFor(() => {
      expect(generateQuiz).toHaveBeenCalledWith(
        'token-1',
        { daily_plan_item_id: 'item-1' },
        expect.stringMatching(/^[0-9a-f-]{36}$/i),
      );
      expect(mockPush).toHaveBeenCalledWith('/quiz/att-99');
    });
  });

  it('renders calm info recovery when EP-L04 returns 403 FEATURE_DISABLED', async () => {
    vi.mocked(getToday).mockRejectedValueOnce(
      new ApiError(403, 'disabled', 'FEATURE_DISABLED'),
    );

    render(<TodayView accessToken="token-1" />);

    expect(
      await screen.findByText(
        /New topic content generation is temporarily paused/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Open Daily Plan/i }),
    ).toHaveAttribute('href', '/daily-plan');
    expect(screen.getByRole('link', { name: /Ask Mentor/i })).toHaveAttribute(
      'href',
      '/mentor',
    );
  });

  it('hides preparing subtext and renders Try Again button when topic_content job fails with retryable=false, re-invoking EP-L04', async () => {
    vi.useFakeTimers();

    vi.mocked(getToday)
      .mockResolvedValueOnce({
        status: 'preparing',
        roadmap_id: 'rm-1',
        plan_id: 'plan-1',
        plan_day: { day_no: 1, total_days: 10 },
        topic: null,
        quiz: { attempt_id: null, status: null, can_retry: false },
        job: {
          job_id: 'job-tc-fail',
          kind: 'topic_content',
          status: 'queued',
          poll_url: '/api/v1/jobs/job-tc-fail',
          retry_after_seconds: 1,
        },
        requires_learning_hours: false,
        preferred_daily_hours: 2,
      })
      .mockResolvedValueOnce(makeReadyToday());

    vi.mocked(getJobStatus).mockResolvedValueOnce({
      job_id: 'job-tc-fail',
      kind: 'topic_content',
      status: 'failed',
      result_ref: null,
      retryable: false,
      created_at: '2026-11-20T00:00:00.000Z',
      finished_at: '2026-11-20T00:00:05.000Z',
      error: {
        code: 'AI_GENERATION_FAILED',
        message: 'AI generation failed. No partial data was saved.',
        retryable: false,
      },
    });

    render(<TodayView accessToken="token-1" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      screen.getByText(/while this study unit finishes preparing/i),
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.useRealTimers();

    expect(
      screen.queryByText(/while this study unit finishes preparing/i),
    ).not.toBeInTheDocument();
    const tryAgainBtn = await screen.findByRole('button', {
      name: /Try Again/i,
    });
    fireEvent.click(tryAgainBtn);

    expect(
      await screen.findByRole('heading', {
        name: 'Transactional Outbox Pattern',
      }),
    ).toBeInTheDocument();
    expect(getToday).toHaveBeenCalledTimes(2);
  });

  it('re-invokes EP-L04 via AILoadingState built-in Retry when topic_content job fails with retryable=true without duplicating Try Again', async () => {
    vi.useFakeTimers();

    vi.mocked(getToday)
      .mockResolvedValueOnce({
        status: 'preparing',
        roadmap_id: 'rm-1',
        plan_id: 'plan-1',
        plan_day: { day_no: 1, total_days: 10 },
        topic: null,
        quiz: { attempt_id: null, status: null, can_retry: false },
        job: {
          job_id: 'job-tc-retryable',
          kind: 'topic_content',
          status: 'queued',
          poll_url: '/api/v1/jobs/job-tc-retryable',
          retry_after_seconds: 1,
        },
        requires_learning_hours: false,
        preferred_daily_hours: 2,
      })
      .mockResolvedValueOnce(makeReadyToday());

    vi.mocked(getJobStatus).mockResolvedValueOnce({
      job_id: 'job-tc-retryable',
      kind: 'topic_content',
      status: 'failed',
      result_ref: null,
      retryable: true,
      created_at: '2026-11-20T00:00:00.000Z',
      finished_at: '2026-11-20T00:00:05.000Z',
      error: {
        code: 'AI_TIMEOUT',
        message: 'AI generation timed out. Please try again.',
        retryable: true,
      },
    });

    render(<TodayView accessToken="token-1" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.useRealTimers();

    expect(
      screen.queryByRole('button', { name: /Try Again/i }),
    ).not.toBeInTheDocument();
    const retryBtn = await screen.findByRole('button', { name: 'Retry' });
    fireEvent.click(retryBtn);

    expect(
      await screen.findByRole('heading', {
        name: 'Transactional Outbox Pattern',
      }),
    ).toBeInTheDocument();
    expect(getToday).toHaveBeenCalledTimes(2);
  });

  it('parses markdown containing Unicode line separators without hanging and normalizes heading hierarchy below card h2', async () => {
    const ready = makeReadyToday();
    ready.topic = {
      ...ready.topic!,
      explanation_markdown:
        '# First\u2028Second\n\n## Section Heading\n\n### Subheading Detail\n\nPlain paragraph.',
      important_questions: [
        {
          question: 'How does heading normalization work?',
          answer_markdown: '## Answer Heading\n\n### Nested Point',
        },
      ],
    };
    vi.mocked(getToday).mockResolvedValueOnce(ready);

    render(<TodayView accessToken="token-1" />);

    expect(
      await screen.findByRole('heading', { level: 3, name: 'First' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Section Heading' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 4, name: 'Subheading Detail' }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: /How does heading normalization work/i,
      }),
    );
    expect(
      screen.getByRole('heading', { level: 4, name: 'Answer Heading' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 5, name: 'Nested Point' }),
    ).toBeInTheDocument();
  });

  it('ignores late EP-Q01 generateQuiz resolution after unmount and never calls router.push', async () => {
    let resolveQuiz!: (val: {
      attempt_id: string;
      status: 'generated';
      attempt_no: number;
      topic_id: string;
      career_level: 'senior';
      questions: [];
      saved_answers: [];
      submitted_at: null;
    }) => void;
    vi.mocked(generateQuiz).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveQuiz = resolve;
      }),
    );

    const { unmount } = render(
      <TodayView accessToken="token-1" initialToday={makeReadyToday()} />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Start Practice Quiz/i }),
    );
    unmount();

    await act(async () => {
      resolveQuiz({
        attempt_id: 'att-late',
        status: 'generated',
        attempt_no: 1,
        topic_id: 'top-1',
        career_level: 'senior',
        questions: [],
        saved_answers: [],
        submitted_at: null,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('delegates R34 Screen 17 topic_content rating and report capabilities via AIExplanationCard and hydrates already-reported state', async () => {
    vi.mocked(listLearningResources).mockResolvedValue({
      items: [],
      meta: { limit: 20, next_cursor: null },
    });
    vi.mocked(submitRating).mockResolvedValueOnce({
      target_type: 'topic_content',
      target_id: 'top-1',
      score: 5,
    });
    vi.mocked(submitReport).mockResolvedValueOnce({
      report_id: 'rep-top-1',
      status: 'received',
    });

    const readyAllowed = makeReadyToday();
    readyAllowed.topic = {
      ...readyAllowed.topic!,
      rating_allowed: true,
      report_allowed: true,
    };

    const { rerender } = render(
      <TodayView accessToken="token-1" initialToday={readyAllowed} />,
    );

    const explanationSection = screen.getByRole('region', {
      name: 'Topic study explanation',
    });
    const ratingGroup = within(explanationSection).getByRole('radiogroup', {
      name: 'Rate this content',
    });
    fireEvent.click(within(ratingGroup).getByRole('radio', { name: '5 stars' }));
    fireEvent.click(
      within(explanationSection).getByRole('button', { name: /Submit rating/i }),
    );
    await waitFor(() => {
      expect(submitRating).toHaveBeenCalledWith(
        'token-1',
        {
          target_type: 'topic_content',
          target_id: 'top-1',
          score: 5,
        },
        { timeoutMs: 15_000 },
      );
    });

    // Report capability is also exposed on approved topic_content and submits topic_content for top-1
    const reportBtn = within(explanationSection).getByRole('button', {
      name: /report issue/i,
    });
    expect(reportBtn).toBeInTheDocument();
    fireEvent.click(reportBtn);
    const reportDialog = await screen.findByRole('dialog', {
      name: /Report content issue/i,
    });
    fireEvent.click(
      within(reportDialog).getByRole('button', { name: /Submit report/i }),
    );
    await waitFor(() => {
      expect(submitReport).toHaveBeenCalledWith(
        'token-1',
        {
          target_type: 'topic_content',
          target_id: 'top-1',
          reason: 'incorrect',
        },
        { timeoutMs: 15_000 },
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // When report_allowed === false, renders disabled "Reported" state while preserving rating
    const alreadyReportedToday = makeReadyToday();
    alreadyReportedToday.topic = {
      ...alreadyReportedToday.topic!,
      topic_id: 'top-already-rep',
      rating_allowed: true,
      report_allowed: false,
    };

    rerender(
      <TodayView accessToken="token-2" initialToday={alreadyReportedToday} />,
    );

    expect(
      within(explanationSection).getByRole('radiogroup', {
        name: 'Rate this content',
      }),
    ).toBeInTheDocument();
    expect(
      within(explanationSection)
        .getByText('Reported')
        .closest('[aria-disabled]'),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('tracks replaced initialToday ownership across A/R0 -> B/R1 -> C/R1 without displaying B plan for C or suppressing getToday(C)', async () => {
    const r0 = makeReadyToday();
    r0.topic = { ...r0.topic!, title: 'Topic For Account A' };

    const r1 = makeReadyToday();
    r1.topic = { ...r1.topic!, title: 'Topic For Account B' };

    const r2 = makeReadyToday();
    r2.topic = { ...r2.topic!, title: 'Topic For Account C' };

    vi.mocked(getToday).mockResolvedValueOnce(r2);

    const { rerender } = render(
      <TodayView accessToken="token-A" initialToday={r0} />,
    );
    expect(screen.getByText('Topic For Account A')).toBeInTheDocument();
    expect(getToday).not.toHaveBeenCalled();

    // Parent replaces both token and seed -> B/R1 hydrates cleanly
    rerender(<TodayView accessToken="token-B" initialToday={r1} />);
    expect(screen.getByText('Topic For Account B')).toBeInTheDocument();
    expect(getToday).not.toHaveBeenCalled();

    // Parent switches token to C while retaining stale R1 reference -> MUST NOT show B's plan and MUST fetch getToday(C)
    rerender(<TodayView accessToken="token-C" initialToday={r1} />);
    expect(screen.queryByText('Topic For Account B')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(getToday).toHaveBeenCalledWith('token-C', expect.any(Object));
    });
    expect(await screen.findByText('Topic For Account C')).toBeInTheDocument();
  });

  it('replaces a stale same-token fetch error when a valid initialToday seed arrives for that token', async () => {
    vi.mocked(getToday).mockRejectedValueOnce(
      new ApiError(503, 'Temporary outage', 'SERVICE_UNAVAILABLE'),
    );
    vi.mocked(listLearningResources).mockResolvedValue({
      items: [],
      meta: { limit: 20, next_cursor: null },
    });

    const { rerender } = render(<TodayView accessToken="token-same" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    const recoveredSeed = makeReadyToday();
    recoveredSeed.topic = {
      ...recoveredSeed.topic!,
      title: 'Recovered Seeded Topic',
    };

    rerender(
      <TodayView accessToken="token-same" initialToday={recoveredSeed} />,
    );
    expect(screen.getByText('Recovered Seeded Topic')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
