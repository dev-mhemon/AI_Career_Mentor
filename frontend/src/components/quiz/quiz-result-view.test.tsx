import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPracticeReviewFeedback,
  submitReport,
  type PracticeFeedbackDTO,
  type QuizQuestionDTO,
  type QuizResultDTO,
} from '@/lib/api/client';
import { QuizCard } from './quiz-card';
import { QuizResultView } from './quiz-result-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    getQuizResult: vi.fn(),
    listPracticeReviews: vi.fn(),
    getPracticeReviewFeedback: vi.fn(),
    retryPracticeReview: vi.fn(),
    retryQuizAttempt: vi.fn(),
    getJobStatus: vi.fn(),
    submitRating: vi.fn(),
    submitReport: vi.fn(),
  };
});

const SAMPLE_QUESTIONS: QuizQuestionDTO[] = [
  {
    question_id: 'q-mcq-1',
    type: 'mcq',
    difficulty: 'application',
    prompt: 'Which index supports equality and range queries in PostgreSQL?',
    options: [
      { option_id: 'a', text: 'B-Tree' },
      { option_id: 'b', text: 'Hash' },
    ],
    response_hint: null,
    max_length: null,
    allow_i_dont_know: true,
  },
  {
    question_id: 'q-mcq-2',
    type: 'mcq',
    difficulty: 'basic',
    prompt: 'Already reported MCQ question?',
    options: [
      { option_id: 'a', text: 'Yes' },
      { option_id: 'b', text: 'No' },
    ],
    response_hint: null,
    max_length: null,
    allow_i_dont_know: true,
  },
  {
    question_id: 'q-fr-1',
    type: 'free_response',
    difficulty: 'analysis',
    prompt: 'Explain READ COMMITTED advisory lock ordering.',
    options: null,
    response_hint: 'sql',
    max_length: 2000,
    allow_i_dont_know: true,
  },
];

const SAMPLE_RESULT: QuizResultDTO = {
  attempt_id: 'att-1',
  mcq_score: { correct: 1, total: 2 },
  performance_level: 'good',
  questions: [
    {
      question_id: 'q-mcq-1',
      type: 'mcq',
      your_answer: 'a',
      correct_answer: 'a',
      is_correct: true,
      explanation: 'B-Tree supports both equality and range predicates.',
      reportable: true,
    },
    {
      question_id: 'q-mcq-2',
      type: 'mcq',
      your_answer: 'b',
      correct_answer: 'a',
      is_correct: false,
      explanation: 'Explanation text.',
      reportable: false,
    },
    {
      question_id: 'q-fr-1',
      type: 'free_response',
      user_answer: 'Acquire advisory lock in preceding statement before INSERT.',
      explanation: 'Lock precedes INSERT snapshot.',
      practice_review_id: 'rev-1',
      review_status: 'reviewed',
      reportable: true,
    },
  ],
  improvement_recommendations: [],
  progress_change: null,
  retry_available: false,
};

const SAMPLE_FEEDBACK: PracticeFeedbackDTO = {
  id: 'rev-1',
  question_id: 'q-fr-1',
  review_status: 'reviewed',
  performance_level: 'good',
  dimensions: {
    correctness: 'good',
    understanding: 'good',
    reasoning: 'partial',
  },
  strengths: ['Accurate lock ordering'],
  mistakes: [],
  weaknesses: [],
  improvement_recommendations: [],
  evidence_eligible: true,
  reportable: true,
};

describe('QuizResultView & QuizCard R34 Feedback Integration (Screen 18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPracticeReviewFeedback).mockResolvedValue(SAMPLE_FEEDBACK);
  });

  afterEach(() => {
    cleanup();
  });

  it('exposes report-only capabilities for quiz_question and practice_review (defaulting to unfair_scoring), hydrates alreadyReported, and renders ZERO star ratings (R34)', async () => {
    vi.mocked(submitReport)
      .mockResolvedValueOnce({
        report_id: 'rep-rev-1',
        status: 'received',
      })
      .mockResolvedValueOnce({
        report_id: 'rep-mcq-1',
        status: 'received',
      });

    render(
      <QuizResultView
        accessToken="tok-quiz"
        attemptId="att-1"
        questions={SAMPLE_QUESTIONS}
        initialResult={SAMPLE_RESULT}
      />,
    );

    // Wait for EP-PR02 PracticeFeedbackDTO load
    expect(await screen.findByText('Accurate lock ordering')).toBeInTheDocument();

    // R34: Strictly ZERO rating controls anywhere on Screen 18
    expect(
      screen.queryByRole('radiogroup', { name: 'Rate this content' }),
    ).not.toBeInTheDocument();

    // MCQ #2 (reportable: false) renders disabled "Reported" badge
    expect(screen.getByText('Reported').closest('[aria-disabled]')).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    // PracticeReviewCard report button defaults reason to unfair_scoring and submits practice_review
    const reviewCard = document.querySelector(
      '[data-review-id="rev-1"]',
    ) as HTMLElement;
    expect(reviewCard).not.toBeNull();
    fireEvent.click(
      within(reviewCard).getByRole('button', { name: /report issue/i }),
    );

    const reviewDialog = await screen.findByRole('dialog', {
      name: /Report content issue/i,
    });
    expect(
      within(reviewDialog).getByRole('radio', { name: /Unfair AI scoring/i }),
    ).toBeChecked();
    fireEvent.click(
      within(reviewDialog).getByRole('button', { name: /Submit report/i }),
    );

    await waitFor(() => {
      expect(submitReport).toHaveBeenCalledWith('tok-quiz', {
        target_type: 'practice_review',
        target_id: 'rev-1',
        reason: 'unfair_scoring',
      });
    });

    // MCQ #1 report button submits quiz_question with q-mcq-1
    const mcqSection = screen.getByRole('region', {
      name: /Multiple-Choice Review/i,
    });
    fireEvent.click(
      within(mcqSection).getByRole('button', { name: /report issue/i }),
    );
    const mcqDialog = await screen.findByRole('dialog', {
      name: /Report content issue/i,
    });
    fireEvent.click(
      within(mcqDialog).getByRole('button', { name: /Submit report/i }),
    );

    await waitFor(() => {
      expect(submitReport).toHaveBeenCalledWith('tok-quiz', {
        target_type: 'quiz_question',
        target_id: 'q-mcq-1',
        reason: 'incorrect',
      });
    });
  });

  it('supports quiz_question report on standalone graded Free-Response QuizCard with zero rating controls', () => {
    render(
      <QuizCard
        question={SAMPLE_QUESTIONS[2]!}
        questionNumber={1}
        totalQuestions={1}
        submittedFreeResponseText="SELECT pg_advisory_xact_lock(...);"
        accessToken="tok-quiz"
        questionReportable={true}
      />,
    );

    expect(
      screen.queryByRole('radiogroup', { name: 'Rate this content' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /report issue/i }),
    ).toBeInTheDocument();
  });
});
