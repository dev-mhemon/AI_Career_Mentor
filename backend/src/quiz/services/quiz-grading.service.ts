import { Injectable } from '@nestjs/common';
import type {
  PerformanceLevel,
  QuestionDifficulty,
} from '../../progress/dto/progress.dto.js';

export interface McqQuestionForGrading {
  id: string;
  difficulty: QuestionDifficulty;
  correct_option_id: string | null;
}

export interface AnswerForGrading {
  question_id: string;
  selected_option_id: string | null;
  answer_text: string | null;
  i_dont_know: boolean;
}

export interface McqGradingSummary {
  correct: number;
  total: number;
  isCorrectByQuestionId: Map<string, boolean>;
  dominantDifficulty: QuestionDifficulty;
  performanceLevel: PerformanceLevel;
  defaultRecommendations: string[];
}

const OBVIOUS_NON_ATTEMPT_PATTERN =
  /^(?:n\/?a|none|null|undefined|idk|i\s*don'?t\s*know|dont\s*know|no\s*idea|nothing|pass|skip|skipped|test|testing|asdf+|qwerty+|\.+|-+|_+|\?+|!+)$/i;

const REPEATED_SINGLE_CHAR_PATTERN = /^([^\s])\1{4,}$/u;
const HAS_LETTER_OR_DIGIT_PATTERN = /[\p{L}\p{N}]/u;

/**
 * Deterministic MCQ grading and obvious junk/non-attempt free-response classification (`PRD` §31, §33, §35).
 */
@Injectable()
export class QuizGradingService {
  /**
   * Grades a single MCQ response against the stored `correct_option_id`.
   */
  gradeMcqAnswer(
    selectedOptionId: string | null | undefined,
    iDontKnow: boolean,
    correctOptionId: string | null | undefined,
  ): boolean {
    if (iDontKnow || !selectedOptionId || !correctOptionId) {
      return false;
    }
    return selectedOptionId.trim() === correctOptionId.trim();
  }

  /**
   * Grades all MCQ questions in an attempt deterministically.
   * Note (`PRD` §35): `performanceLevel` is a formative indicator (`'good' | 'needs_work'`),
   * never a visible percentage pass/fail threshold.
   */
  gradeMcqQuestions(
    mcqQuestions: readonly McqQuestionForGrading[],
    answersByQuestionId: ReadonlyMap<string, AnswerForGrading>,
    topicTitle?: string,
  ): McqGradingSummary {
    const isCorrectByQuestionId = new Map<string, boolean>();
    let correct = 0;
    const total = mcqQuestions.length;
    const difficultyCounts: Record<QuestionDifficulty, number> = {
      basic: 0,
      application: 0,
      analysis: 0,
    };
    const missedDifficulties = new Set<QuestionDifficulty>();

    for (const q of mcqQuestions) {
      difficultyCounts[q.difficulty] =
        (difficultyCounts[q.difficulty] ?? 0) + 1;
      const ans = answersByQuestionId.get(q.id);
      const isCorrect = this.gradeMcqAnswer(
        ans?.selected_option_id,
        Boolean(ans?.i_dont_know),
        q.correct_option_id,
      );
      isCorrectByQuestionId.set(q.id, isCorrect);
      if (isCorrect) {
        correct += 1;
      } else {
        missedDifficulties.add(q.difficulty);
      }
    }

    let dominantDifficulty: QuestionDifficulty = 'application';
    if (
      difficultyCounts.analysis >= difficultyCounts.application &&
      difficultyCounts.analysis >= difficultyCounts.basic &&
      difficultyCounts.analysis > 0
    ) {
      dominantDifficulty = 'analysis';
    } else if (
      difficultyCounts.basic > difficultyCounts.application &&
      difficultyCounts.basic > difficultyCounts.analysis
    ) {
      dominantDifficulty = 'basic';
    }

    const ratio = total > 0 ? correct / total : 0;
    const performanceLevel: PerformanceLevel =
      total > 0 && ratio >= 0.75 ? 'good' : 'needs_work';

    const subjectLabel = topicTitle?.trim() || 'this topic';
    const defaultRecommendations: string[] = [];
    if (missedDifficulties.has('basic')) {
      defaultRecommendations.push(
        `Revisit foundational concepts and definitions for ${subjectLabel}.`,
      );
    }
    if (missedDifficulties.has('application')) {
      defaultRecommendations.push(
        `Practice hands-on application scenarios for ${subjectLabel}.`,
      );
    }
    if (missedDifficulties.has('analysis')) {
      defaultRecommendations.push(
        `Review edge cases and deeper trade-off analysis for ${subjectLabel}.`,
      );
    }
    if (defaultRecommendations.length === 0) {
      defaultRecommendations.push(
        `Continue applying ${subjectLabel} concepts across upcoming topics.`,
      );
    }

    return {
      correct,
      total,
      isCorrectByQuestionId,
      dominantDifficulty,
      performanceLevel,
      defaultRecommendations,
    };
  }

  /**
   * Detects obvious junk, empty, `i_dont_know`, or non-attempt free-response answers (`PRD` §31).
   * When `true`, the answer is immediately marked `review_status = 'not_evidence'` (`evidence_eligible = false`)
   * without wasting an AI Practice Review job.
   */
  isJunkOrNonAttemptFreeResponse(
    answerText: string | null | undefined,
    iDontKnow: boolean,
  ): boolean {
    if (iDontKnow) {
      return true;
    }
    if (typeof answerText !== 'string') {
      return true;
    }
    const trimmed = answerText.trim();
    if (trimmed.length === 0) {
      return true;
    }
    if (!HAS_LETTER_OR_DIGIT_PATTERN.test(trimmed)) {
      return true;
    }
    if (OBVIOUS_NON_ATTEMPT_PATTERN.test(trimmed)) {
      return true;
    }
    const collapsed = trimmed.replace(/\s+/g, '');
    if (REPEATED_SINGLE_CHAR_PATTERN.test(collapsed)) {
      return true;
    }
    return false;
  }
}
