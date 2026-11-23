import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  getPracticeReviewFeedback,
  getQuizAttempt,
  getQuizResult,
  listPracticeReviews,
  patchQuizAnswers,
  retryPracticeReview,
  retryQuizAttempt,
  startQuizAttempt,
  submitQuizAttempt,
  type QuizAttemptDTO,
  type QuizResultDTO,
} from '@/lib/api/client';
import { QuizSessionView } from './quiz-session-view';

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
    getQuizAttempt: vi.fn(),
    startQuizAttempt: vi.fn(),
    patchQuizAnswers: vi.fn(),
    submitQuizAttempt: vi.fn(),
    getQuizResult: vi.fn(),
    retryQuizAttempt: vi.fn(),
    listPracticeReviews: vi.fn(),
    getPracticeReviewFeedback: vi.fn(),
    retryPracticeReview: vi.fn(),
    getJobStatus: vi.fn(),
  };
});

function makeQuizAttempt(
  status: QuizAttemptDTO['status'] = 'generated',
): QuizAttemptDTO {
  return {
    attempt_id: 'att-1',
    status,
    attempt_no: 1,
    topic_id: 'top-1',
    topic_title: 'SQL Joins & Indexing',
    career_level: 'mid',
    submitted_at: status === 'submitted' ? '2026-11-22T10:00:00.000Z' : null,
    saved_answers: [],
    questions: [
      {
        question_id: 'q-mcq-1',
        type: 'mcq',
        difficulty: 'application',
        prompt: 'Which SQL join preserves unmatched rows from the left table?',
        options: [
          { option_id: 'a', text: 'LEFT JOIN' },
          { option_id: 'b', text: 'INNER JOIN' },
        ],
        response_hint: null,
        max_length: null,
        allow_i_dont_know: true,
      },
      {
        question_id: 'q-fr-1',
        type: 'free_response',
        difficulty: 'analysis',
        prompt: 'Write a SQL query joining users and orders with LEFT JOIN.',
        options: null,
        response_hint: 'sql',
        max_length: 2000,
        allow_i_dont_know: true,
      },
    ],
  };
}

function makeQuizResult(
  frStatus: 'pending' | 'reviewed' | 'failed' = 'reviewed',
): QuizResultDTO {
  return {
    attempt_id: 'att-1',
    status: frStatus === 'pending' ? 'submitted' : 'feedback_available',
    attempt_no: 1,
    topic_title: 'SQL Joins & Indexing',
    mcq_score: { correct: 1, total: 1 },
    performance_level: 'good',
    improvement_recommendations: [
      'Practice composite index ordering on join predicates.',
    ],
    progress_change: {
      skill_id: 'skill-1',
      career_level: 'mid',
      from: 'not_started',
      to: 'practicing',
      reason: 'Recorded strong initial practice evidence at mid level.',
    },
    retry_available: true,
    questions: [
      {
        question_id: 'q-mcq-1',
        type: 'mcq',
        your_answer: 'a',
        correct_answer: 'a',
        is_correct: true,
        explanation: 'LEFT JOIN retains all rows from the left table.',
        reportable: true,
      },
      {
        question_id: 'q-fr-1',
        type: 'free_response',
        user_answer:
          'SELECT u.id, o.id FROM users u LEFT JOIN orders o ON u.id = o.user_id;',
        explanation:
          'Key concepts expected in a complete response:\n• Join users and orders using LEFT JOIN on u.id = o.user_id so users without orders are retained.',
        practice_review_id: 'rev-1',
        review_status: frStatus,
        reportable: true,
      },
    ],
  };
}

describe('QuizSessionView & QuizResultView (Screen 18 — EP-Q02..EP-Q07, EP-PR01..EP-PR03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('starts a generated quiz via EP-Q03, debounces EP-Q04 autosave, confirms unanswered questions, and submits via EP-Q05 with H-IDEM', async () => {
    vi.useFakeTimers();
    vi.mocked(startQuizAttempt).mockResolvedValueOnce(
      makeQuizAttempt('started'),
    );
    vi.mocked(patchQuizAnswers).mockResolvedValue({
      saved: 1,
      saved_at: '2026-11-22T10:01:00.000Z',
    });
    vi.mocked(submitQuizAttempt).mockResolvedValueOnce({
      attempt_id: 'att-1',
      status: 'feedback_available',
      mcq_score: { correct: 1, total: 1 },
      plan_day_unlocked: true,
      next_plan_day_no: 3,
      review_job_id: null,
    });
    vi.mocked(getQuizResult).mockResolvedValue(makeQuizResult('reviewed'));
    vi.mocked(getPracticeReviewFeedback).mockResolvedValue({
      id: 'rev-1',
      question_id: 'q-fr-1',
      review_status: 'reviewed',
      performance_level: 'good',
      dimensions: {
        correctness: 'good',
        understanding: 'good',
        reasoning: 'good',
      },
      strengths: ['Accurate LEFT JOIN syntax and ON clause.'],
      mistakes: [],
      weaknesses: [],
      improvement_recommendations: ['Test NULL filtering with WHERE vs ON.'],
      evidence_eligible: true,
      reportable: true,
    });

    render(
      <QuizSessionView
        accessToken="tok-1"
        attemptId="att-1"
        initialAttempt={makeQuizAttempt('generated')}
      />,
    );

    // Start quiz (EP-Q03)
    fireEvent.click(
      screen.getByRole('button', { name: /Start Practice Quiz/i }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(startQuizAttempt).toHaveBeenCalledWith('tok-1', 'att-1');

    // Select MCQ option A -> triggers debounced EP-Q04 autosave & sessionStorage backup
    const navBtn1Before = screen.getByRole('button', {
      name: 'Question 1 (Unanswered)',
    });
    expect(navBtn1Before).toBeInTheDocument();
    expect(navBtn1Before.className).toContain('rounded-full');
    expect(navBtn1Before.className).toContain('h-10');
    expect(navBtn1Before.className).toContain('w-10');

    const navBtn2Before = screen.getByRole('button', {
      name: 'Question 2 (Unanswered)',
    });
    expect(navBtn2Before.className).toContain('rounded-full');
    expect(navBtn2Before.className).toContain('bg-indigo-50/60');

    const radioA = screen.getByRole('radio', { name: /LEFT JOIN/i });
    fireEvent.click(radioA);

    // Question 1 navigator button transitions to Answered (teal) and clicking Question 2 scrolls smoothly to #quiz-q-q-fr-1
    const navBtn1After = screen.getByRole('button', {
      name: 'Question 1 (Answered)',
    });
    expect(navBtn1After).toBeInTheDocument();
    expect(navBtn1After.className).toContain('bg-teal-600');
    const targetCard2 = document.getElementById('quiz-q-q-fr-1');
    expect(targetCard2).not.toBeNull();
    const scrollIntoViewMock = vi.fn();
    const focusMock = vi.fn();
    targetCard2!.scrollIntoView = scrollIntoViewMock;
    targetCard2!.focus = focusMock;

    const jumpToggle = screen.getByRole('button', { name: /Jump \(1\/2\)/i });
    fireEvent.click(jumpToggle);
    expect(jumpToggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(
      screen.getByRole('button', { name: 'Question 2 (Unanswered)' }),
    );
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    expect(focusMock).toHaveBeenCalledWith({ preventScroll: true });
    expect(jumpToggle).toHaveAttribute('aria-expanded', 'false');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(950);
    });
    expect(patchQuizAnswers).toHaveBeenCalledWith('tok-1', 'att-1', {
      answers: [{ question_id: 'q-mcq-1', selected_option_id: 'a' }],
    });
    expect(screen.getByText(/Saved just now/i)).toBeInTheDocument();

    // Click Submit while FR question is still unanswered -> opens ConfirmUnansweredModal
    fireEvent.click(screen.getByRole('button', { name: /^Submit Quiz$/i }));
    expect(
      screen.getByRole('heading', {
        name: /Submit with unanswered questions\?/i,
      }),
    ).toBeInTheDocument();

    // Confirm "Submit Anyway" -> calls EP-Q05 with confirm_unanswered: true and Idempotency-Key
    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: /Submit Anyway/i }));

    expect(
      await screen.findByRole('heading', { name: 'Practice Quiz Summary' }),
    ).toBeInTheDocument();
    expect(submitQuizAttempt).toHaveBeenCalledWith(
      'tok-1',
      'att-1',
      {
        answers: [{ question_id: 'q-mcq-1', selected_option_id: 'a' }],
        confirm_unanswered: true,
      },
      expect.stringMatching(/^[0-9a-f-]{36}$/i),
    );
    expect(screen.getByText('Day 3 Unlocked')).toBeInTheDocument();
    expect(screen.getByText('SQL Joins & Indexing')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Today's Learning/i }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('link', { name: /^Daily Plan$/i }),
    ).toHaveLength(2);
    expect(
      screen.queryByRole('link', { name: /View Daily Plan/i }),
    ).not.toBeInTheDocument();
    const masteryLink = screen.getByRole('link', { name: /^Skill Mastery$/i });
    expect(masteryLink).toBeInTheDocument();
    expect(masteryLink.className).toContain('bg-teal-600');
    expect(
      screen.getByRole('link', { name: /Continue to Next Day/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Explanation')).toBeInTheDocument();
    expect(
      await screen.findByText(/Accurate LEFT JOIN syntax and ON clause/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/LEFT JOIN retains all rows from the left table/i),
    ).toBeInTheDocument();
    // Never renders pass/fail or "Job Ready"
    expect(document.body.textContent?.toLowerCase()).not.toContain('job ready');
  });

  it('supports EP-PR03 Retry AI Review (handling 410 RAW_RESPONSE_EXPIRED) and EP-Q07 single quiz retry', async () => {
    vi.mocked(retryPracticeReview).mockRejectedValueOnce(
      new ApiError(410, 'expired', 'RAW_RESPONSE_EXPIRED'),
    );
    vi.mocked(retryQuizAttempt).mockResolvedValueOnce({
      ...makeQuizAttempt('generated'),
      attempt_id: 'att-2',
      attempt_no: 2,
    });
    vi.mocked(getQuizAttempt).mockResolvedValueOnce({
      ...makeQuizAttempt('generated'),
      attempt_id: 'att-2',
      attempt_no: 2,
    });

    render(
      <QuizSessionView
        accessToken="tok-1"
        attemptId="att-1"
        initialAttempt={makeQuizAttempt('submitted')}
        initialResult={makeQuizResult('failed')}
      />,
    );

    const retryReviewBtn = await screen.findByRole('button', {
      name: /Retry AI Review/i,
    });
    fireEvent.click(retryReviewBtn);

    await waitFor(() => {
      expect(retryPracticeReview).toHaveBeenCalledWith('tok-1', 'rev-1');
      expect(
        screen.getByText(/90-day privacy retention policy/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Retry AI Review/i }),
      ).toBeDisabled();
    });

    // Click Retry Quiz (EP-Q07)
    fireEvent.click(
      screen.getByRole('button', { name: /Retry Quiz \(1 Retry Available\)/i }),
    );

    await waitFor(() => {
      expect(retryQuizAttempt).toHaveBeenCalledWith(
        'tok-1',
        'att-1',
        expect.stringMatching(/^[0-9a-f-]{36}$/i),
      );
      expect(mockPush).toHaveBeenCalledWith('/quiz/att-2');
      expect(screen.getByText(/Attempt #2 · MID/i)).toBeInTheDocument();
    });
  });

  it('polls EP-PR01 and EP-Q06 while free-response review_status is pending until reviewed', async () => {
    vi.useFakeTimers();
    vi.mocked(listPracticeReviews).mockResolvedValueOnce([
      {
        id: 'rev-1',
        question_id: 'q-fr-1',
        review_status: 'reviewed',
        performance_level: 'good',
      },
    ]);
    vi.mocked(getQuizResult).mockResolvedValueOnce(makeQuizResult('reviewed'));
    vi.mocked(getPracticeReviewFeedback).mockResolvedValue({
      id: 'rev-1',
      question_id: 'q-fr-1',
      review_status: 'reviewed',
      performance_level: 'good',
      dimensions: {
        correctness: 'good',
        understanding: 'good',
        reasoning: 'good',
      },
      strengths: ['Completed via background review worker.'],
      mistakes: [],
      weaknesses: [],
      improvement_recommendations: [],
      evidence_eligible: true,
      reportable: true,
    });

    render(
      <QuizSessionView
        accessToken="tok-1"
        attemptId="att-1"
        initialAttempt={makeQuizAttempt('submitted')}
        initialResult={makeQuizResult('pending')}
      />,
    );

    expect(
      screen.getByText(/Evaluating your free-response answer/i),
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.useRealTimers();

    expect(
      await screen.findByText(/Completed via background review worker/i),
    ).toBeInTheDocument();
  });

  it('clears load error and recovers cleanly when Retry Loading Results is clicked after a failed getQuizResult call', async () => {
    vi.mocked(getQuizResult)
      .mockRejectedValueOnce(
        new ApiError(404, 'Not found', 'RESOURCE_NOT_FOUND'),
      )
      .mockResolvedValueOnce(makeQuizResult('reviewed'));
    vi.mocked(getPracticeReviewFeedback).mockResolvedValue({
      id: 'rev-1',
      question_id: 'q-fr-1',
      review_status: 'reviewed',
      performance_level: 'good',
      dimensions: {
        correctness: 'good',
        understanding: 'good',
        reasoning: 'good',
      },
      strengths: ['Recovered result after retry click.'],
      mistakes: [],
      weaknesses: [],
      improvement_recommendations: [],
      evidence_eligible: true,
      reportable: true,
    });

    render(
      <QuizSessionView
        accessToken="tok-1"
        attemptId="att-1"
        initialAttempt={makeQuizAttempt('submitted')}
      />,
    );

    const retryBtn = await screen.findByRole('button', {
      name: /Retry Loading Results/i,
    });
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);

    expect(
      await screen.findByRole('heading', { name: 'Practice Quiz Summary' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Recovered result after retry click/i),
    ).toBeInTheDocument();
    expect(getQuizResult).toHaveBeenCalledTimes(2);
  });

  it('renders Correct/Incorrect/Skipped MCQ status pills with rose wrong-selection styling and displays FR submitted answer, mistakes, and reference explanation', async () => {
    const resultWithMixedMcq: QuizResultDTO = {
      ...makeQuizResult('reviewed'),
      mcq_score: { correct: 0, total: 2 },
      questions: [
        {
          question_id: 'q-mcq-1',
          type: 'mcq',
          your_answer: 'b',
          correct_answer: 'a',
          is_correct: false,
          explanation: 'LEFT JOIN retains all rows from the left table.',
          reportable: true,
        },
        {
          question_id: 'q-mcq-2',
          type: 'mcq',
          your_answer: null,
          correct_answer: 'a',
          is_correct: false,
          explanation: 'Skipped question explanation.',
          reportable: true,
        },
        {
          question_id: 'q-fr-1',
          type: 'free_response',
          user_answer: 'SELECT * FROM users JOIN orders;',
          explanation:
            'Use LEFT JOIN with an explicit ON clause (u.id = o.user_id).',
          practice_review_id: 'rev-1',
          review_status: 'reviewed',
          reportable: true,
        },
      ],
    };

    const attemptWithTwoMcqs: QuizAttemptDTO = {
      ...makeQuizAttempt('submitted'),
      questions: [
        ...makeQuizAttempt('submitted').questions,
        {
          question_id: 'q-mcq-2',
          type: 'mcq',
          difficulty: 'basic',
          prompt: 'Second MCQ question that was skipped',
          options: [
            { option_id: 'a', text: 'Option A' },
            { option_id: 'b', text: 'Option B' },
          ],
          response_hint: null,
          max_length: null,
          allow_i_dont_know: true,
        },
      ],
    };

    vi.mocked(getPracticeReviewFeedback).mockResolvedValue({
      id: 'rev-1',
      question_id: 'q-fr-1',
      review_status: 'reviewed',
      performance_level: 'needs_work',
      dimensions: {
        correctness: 'weak',
        understanding: 'partial',
        reasoning: 'partial',
      },
      strengths: ['Identified the two target tables.'],
      mistakes: [
        'Used INNER JOIN without an ON predicate instead of LEFT JOIN.',
      ],
      weaknesses: [],
      improvement_recommendations: [
        'Add ON u.id = o.user_id to the LEFT JOIN.',
      ],
      evidence_eligible: true,
      reportable: true,
    });

    render(
      <QuizSessionView
        accessToken="tok-1"
        attemptId="att-1"
        initialAttempt={attemptWithTwoMcqs}
        initialResult={resultWithMixedMcq}
      />,
    );

    // 1. MCQ badges: Incorrect (rose) and Skipped (slate), never "Concept to Review"
    expect(screen.queryByText('Concept to Review')).not.toBeInTheDocument();
    expect(screen.getByText('Incorrect')).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
    expect(screen.getByText('Your selection (Incorrect)')).toBeInTheDocument();

    // 2. FR card shows Your Submitted Answer, Mistakes & Corrections, and Reference Answer & Explanation
    expect(screen.getByText('Your Submitted Answer')).toBeInTheDocument();
    expect(
      screen.getByText('SELECT * FROM users JOIN orders;'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        /Used INNER JOIN without an ON predicate instead of LEFT JOIN/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Reference Answer & Explanation'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Use LEFT JOIN with an explicit ON clause \(u\.id = o\.user_id\)/i,
      ),
    ).toBeInTheDocument();
  });

  it('fetches EP-Q02 exactly once after Try Again (no infinite reload loop) and keeps EP-Q06 poll updates even if EP-PR01 fails', async () => {
    vi.mocked(getQuizAttempt)
      .mockRejectedValueOnce(
        new ApiError(503, 'Temporary error', 'SERVICE_UNAVAILABLE'),
      )
      .mockResolvedValueOnce(makeQuizAttempt('generated'));

    render(<QuizSessionView accessToken="tok-1" attemptId="att-1" />);

    const tryAgainBtn = await screen.findByRole('button', {
      name: /Try Again/i,
    });
    fireEvent.click(tryAgainBtn);

    expect(
      await screen.findByRole('button', { name: /Start Practice Quiz/i }),
    ).toBeInTheDocument();
    expect(getQuizAttempt).toHaveBeenCalledTimes(2);
  });

  it('serializes autosave PATCH requests per attempt so edit B waits until delayed PATCH A settles and sends the latest value', async () => {
    vi.useFakeTimers();
    let resolvePatchA!: (val: { saved: number; saved_at: string }) => void;
    vi.mocked(patchQuizAnswers)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePatchA = resolve;
          }),
      )
      .mockResolvedValueOnce({
        saved: 1,
        saved_at: '2026-11-22T10:02:00.000Z',
      });

    render(
      <QuizSessionView
        accessToken="tok-1"
        attemptId="att-1"
        initialAttempt={makeQuizAttempt('started')}
      />,
    );

    // Edit A: select option A -> trigger delayed PATCH A
    fireEvent.click(screen.getByRole('radio', { name: /LEFT JOIN/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(950);
    });
    expect(patchQuizAnswers).toHaveBeenCalledTimes(1);
    expect(patchQuizAnswers).toHaveBeenNthCalledWith(1, 'tok-1', 'att-1', {
      answers: [{ question_id: 'q-mcq-1', selected_option_id: 'a' }],
    });

    // Edit B while PATCH A is still in flight -> must NOT fire concurrently
    fireEvent.click(screen.getByRole('radio', { name: /INNER JOIN/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(950);
    });
    expect(patchQuizAnswers).toHaveBeenCalledTimes(1);

    // Resolve PATCH A -> PATCH B flushes immediately with latest value ('b')
    await act(async () => {
      resolvePatchA({ saved: 1, saved_at: '2026-11-22T10:01:00.000Z' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(patchQuizAnswers).toHaveBeenCalledTimes(2);
    expect(patchQuizAnswers).toHaveBeenNthCalledWith(2, 'tok-1', 'att-1', {
      answers: [{ question_id: 'q-mcq-1', selected_option_id: 'b' }],
    });
  });

  it('schedules a delayed retry after a failed PATCH when newer edits arrived in flight, and allows Retry feedback on transient EP-PR02 failure', async () => {
    vi.useFakeTimers();
    let rejectPatchA!: (err: Error) => void;
    vi.mocked(patchQuizAnswers)
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectPatchA = reject;
          }),
      )
      .mockResolvedValueOnce({
        saved: 1,
        saved_at: '2026-11-22T10:03:00.000Z',
      });

    const { unmount } = render(
      <QuizSessionView
        accessToken="tok-1"
        attemptId="att-1"
        initialAttempt={makeQuizAttempt('started')}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /LEFT JOIN/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(950);
    });
    expect(patchQuizAnswers).toHaveBeenCalledTimes(1);

    // Queue newer edit B while PATCH A is in flight, then fail PATCH A
    fireEvent.click(screen.getByRole('radio', { name: /INNER JOIN/i }));
    await act(async () => {
      rejectPatchA(new Error('Network hiccup'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(patchQuizAnswers).toHaveBeenCalledTimes(1);

    // After delayed 2000ms retry, PATCH retries with newer edit B
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_050);
    });
    expect(patchQuizAnswers).toHaveBeenCalledTimes(2);
    expect(patchQuizAnswers).toHaveBeenNthCalledWith(2, 'tok-1', 'att-1', {
      answers: [{ question_id: 'q-mcq-1', selected_option_id: 'b' }],
    });

    unmount();
    vi.useRealTimers();

    // EP-PR02 transient detail failure -> Retry feedback recovers card
    vi.mocked(getPracticeReviewFeedback)
      .mockRejectedValueOnce(new Error('Temporary feedback error'))
      .mockResolvedValueOnce({
        id: 'rev-1',
        question_id: 'q-fr-1',
        review_status: 'reviewed',
        performance_level: 'good',
        dimensions: {
          correctness: 'good',
          understanding: 'good',
          reasoning: 'good',
        },
        strengths: ['Recovered rubric feedback strength'],
        mistakes: [],
        weaknesses: [],
        improvement_recommendations: [],
        evidence_eligible: true,
        reportable: true,
      });

    render(
      <QuizSessionView
        accessToken="tok-1"
        attemptId="att-1"
        initialAttempt={makeQuizAttempt('submitted')}
        initialResult={makeQuizResult('reviewed')}
      />,
    );

    const retryFeedbackBtn = await screen.findByRole('button', {
      name: /Retry feedback/i,
    });
    fireEvent.click(retryFeedbackBtn);
    expect(
      await screen.findByText(/Recovered rubric feedback strength/i),
    ).toBeInTheDocument();
  });

  it('shows Retry feedback when EP-PR01 marks review ready while EP-Q06 stays pending and EP-PR02 fails transiently', async () => {
    vi.useFakeTimers();
    vi.mocked(listPracticeReviews).mockResolvedValueOnce([
      {
        id: 'rev-1',
        question_id: 'q-fr-1',
        review_status: 'reviewed',
        performance_level: 'good',
        reviewed_at: '2026-11-22T10:06:00.000Z',
      },
    ]);
    vi.mocked(getQuizResult).mockRejectedValueOnce(
      new Error('EP-Q06 transient failure'),
    );
    vi.mocked(getPracticeReviewFeedback)
      .mockRejectedValueOnce(new Error('EP-PR02 transient failure'))
      .mockResolvedValueOnce({
        id: 'rev-1',
        question_id: 'q-fr-1',
        review_status: 'reviewed',
        performance_level: 'good',
        dimensions: {
          correctness: 'good',
          understanding: 'good',
          reasoning: 'good',
        },
        strengths: ['Recovered pending-status feedback strength'],
        mistakes: [],
        weaknesses: [],
        improvement_recommendations: [],
        evidence_eligible: true,
        reportable: true,
      });

    render(
      <QuizSessionView
        accessToken="tok-1"
        attemptId="att-1"
        initialAttempt={makeQuizAttempt('submitted')}
        initialResult={makeQuizResult('pending')}
      />,
    );

    // Advance one poll tick: EP-PR01 reports 'reviewed', EP-Q06 fails (card stays pending), EP-PR02 fails
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
      await Promise.resolve();
      await Promise.resolve();
    });

    const retryFeedbackBtn = screen.getByRole('button', {
      name: /Retry feedback/i,
    });
    expect(retryFeedbackBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(retryFeedbackBtn);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      screen.getByText(/Recovered pending-status feedback strength/i),
    ).toBeInTheDocument();
  });
});
