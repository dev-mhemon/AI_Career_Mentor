import { Transform } from 'class-transformer';
import { Allow } from 'class-validator';
import type { JobAcceptedDto } from '../../jobs/dto/job-status.dto.js';
import type { PerformanceLevel } from '../../progress/dto/progress.dto.js';
import type { ReviewStatus } from '../../quiz/dto/quiz.dto.js';

export type ReviewDimensionScore = 'good' | 'partial' | 'weak';

export const REVIEW_DIMENSION_SCORE_VALUES: readonly ReviewDimensionScore[] = [
  'good',
  'partial',
  'weak',
];

const trimLower = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * `C05` §14.8 `EP-PR01` query parameters (`quiz_attempt_id`).
 */
export class ListPracticeReviewsQueryDTO {
  @Transform(trimLower)
  @Allow()
  quiz_attempt_id!: string;
}

export interface PracticeReviewDimensionsDTO {
  correctness: ReviewDimensionScore;
  understanding: ReviewDimensionScore;
  reasoning: ReviewDimensionScore;
}

/**
 * `C05` §14.8 `EP-PR01` summary item.
 */
export interface PracticeReviewSummaryDTO {
  id: string;
  question_id: string;
  review_status: ReviewStatus;
  performance_level: PerformanceLevel | null;
}

/**
 * `C05` §15.8 `PracticeFeedbackDTO` (`EP-PR02`, `EP-PR03`).
 */
export interface PracticeFeedbackDTO {
  id: string;
  question_id: string;
  review_status: ReviewStatus;
  performance_level: PerformanceLevel | null;
  dimensions: PracticeReviewDimensionsDTO | null;
  strengths: string[];
  mistakes: string[];
  weaknesses: string[];
  improvement_recommendations: string[];
  evidence_eligible: boolean;
  reportable: boolean;
}

export type TriggerPracticeReviewOutcome =
  | { statusCode: 200; body: PracticeFeedbackDTO }
  | { statusCode: 202; body: JobAcceptedDto };
