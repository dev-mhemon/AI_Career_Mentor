import { describe, expect, it } from 'vitest';
import { QuizGradingService } from './services/quiz-grading.service.js';

describe('QuizGradingService (deterministic MCQ grading & junk FR detection)', () => {
  const service = new QuizGradingService();

  it('grades MCQs deterministically and handles i_dont_know / unanswered as incorrect', () => {
    const questions = [
      { id: 'q1', difficulty: 'basic' as const, correct_option_id: 'a' },
      { id: 'q2', difficulty: 'application' as const, correct_option_id: 'b' },
      { id: 'q3', difficulty: 'analysis' as const, correct_option_id: 'c' },
      { id: 'q4', difficulty: 'application' as const, correct_option_id: 'd' },
    ];
    const answers = new Map([
      [
        'q1',
        {
          question_id: 'q1',
          selected_option_id: 'a',
          answer_text: null,
          i_dont_know: false,
        },
      ],
      [
        'q2',
        {
          question_id: 'q2',
          selected_option_id: 'b',
          answer_text: null,
          i_dont_know: false,
        },
      ],
      [
        'q3',
        {
          question_id: 'q3',
          selected_option_id: 'c',
          answer_text: null,
          i_dont_know: false,
        },
      ],
      [
        'q4',
        {
          question_id: 'q4',
          selected_option_id: null,
          answer_text: null,
          i_dont_know: true,
        },
      ],
    ]);

    const summary = service.gradeMcqQuestions(questions, answers, 'SQL Joins');
    expect(summary.correct).toBe(3);
    expect(summary.total).toBe(4);
    expect(summary.performanceLevel).toBe('good');
    expect(summary.isCorrectByQuestionId.get('q1')).toBe(true);
    expect(summary.isCorrectByQuestionId.get('q4')).toBe(false);
    expect(
      summary.defaultRecommendations.join(' ').toLowerCase(),
    ).not.toContain('job ready');
  });

  it('classifies obvious junk, empty, or i_dont_know free responses as non-attempts', () => {
    expect(service.isJunkOrNonAttemptFreeResponse(null, false)).toBe(true);
    expect(service.isJunkOrNonAttemptFreeResponse('   ', false)).toBe(true);
    expect(
      service.isJunkOrNonAttemptFreeResponse('SELECT * FROM users;', true),
    ).toBe(true);
    expect(service.isJunkOrNonAttemptFreeResponse('idk', false)).toBe(true);
    expect(service.isJunkOrNonAttemptFreeResponse('n/a', false)).toBe(true);
    expect(service.isJunkOrNonAttemptFreeResponse('aaaaaaa', false)).toBe(true);
    expect(service.isJunkOrNonAttemptFreeResponse('???', false)).toBe(true);
    expect(service.isJunkOrNonAttemptFreeResponse('0', false)).toBe(false);
    expect(service.isJunkOrNonAttemptFreeResponse('O(1)', false)).toBe(false);

    expect(
      service.isJunkOrNonAttemptFreeResponse(
        'Use a LEFT JOIN when unmatched rows from the left table must be preserved.',
        false,
      ),
    ).toBe(false);
  });
});
