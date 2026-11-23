import { Transform } from 'class-transformer';
import { Allow, IsUUID } from 'class-validator';
import type { JobAcceptedDto } from '../../jobs/dto/job-status.dto.js';
import type {
  AttemptStatus,
  LearningState,
} from '../../learning/dto/learning.dto.js';
import type { CareerLevel } from '../../profile/profile.dto.js';
import type {
  PerformanceLevel,
  ProgressChangeSummaryDTO,
  QuestionDifficulty,
} from '../../progress/dto/progress.dto.js';

export type QuestionType = 'mcq' | 'free_response';
export type ReviewStatus = 'pending' | 'reviewed' | 'failed' | 'not_evidence';
export type ResponseHint =
  | 'sql'
  | 'code'
  | 'config'
  | 'test_case'
  | 'debug'
  | 'command'
  | 'design'
  | 'text';

export const QUESTION_TYPE_VALUES: readonly QuestionType[] = [
  'mcq',
  'free_response',
];

export const REVIEW_STATUS_VALUES: readonly ReviewStatus[] = [
  'pending',
  'reviewed',
  'failed',
  'not_evidence',
];

export const RESPONSE_HINT_VALUES: readonly ResponseHint[] = [
  'sql',
  'code',
  'config',
  'test_case',
  'debug',
  'command',
  'design',
  'text',
];

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * `C05` §15.7 `QuizGenerateDTO` (`EP-Q01`).
 */
export class QuizGenerateDTO {
  @Transform(trimLower)
  @IsUUID()
  daily_plan_item_id!: string;
}

/**
 * `C05` §15.7 `QuizAnswerDTO` item inside `QuizAnswersPatchDTO` (`EP-Q04`) and `QuizSubmissionDTO` (`EP-Q05`).
 */
export interface QuizAnswerInputDTO {
  question_id: string;
  selected_option_id?: string | null;
  text?: string | null;
  i_dont_know?: boolean;
  clear?: boolean;
}

/**
 * `C05` §15.7 `QuizAnswersPatchDTO` (`EP-Q04`).
 * Uses `@Allow()` so strict validation (`1..40` items, question membership, mutual exclusivity)
 * runs deterministically in `QuizService.saveAnswers`.
 */
export class QuizAnswersPatchDTO {
  @Allow()
  answers?: unknown;
}

/**
 * `C05` §15.7 `QuizSubmissionDTO` (`EP-Q05`).
 * Uses `@Allow()` so boolean/array types are never silently coerced before `QuizService.submitQuizAttempt`.
 */
export class QuizSubmissionDTO {
  @Allow()
  answers?: unknown;

  @Allow()
  confirm_unanswered?: unknown;
}

export interface QuizQuestionOptionDTO {
  option_id: string;
  text: string;
}

/**
 * `C05` §15.7 `QuizQuestionDTO` (`EP-Q01`, `EP-Q02`, `EP-Q03`, `EP-Q07`).
 * Strictly omits `correct_option_id`, `explanation`, `rubric`, and `ai_generation_id`.
 */
export interface QuizQuestionDTO {
  question_id: string;
  type: QuestionType;
  difficulty: QuestionDifficulty;
  prompt: string;
  options: QuizQuestionOptionDTO[] | null;
  response_hint: string | null;
  max_length: number | null;
  allow_i_dont_know: boolean;
}

export interface SavedQuizAnswerDTO {
  question_id: string;
  selected_option_id: string | null;
  text: string | null;
  i_dont_know: boolean;
}

/**
 * `C05` §15.7 `QuizAttemptDTO` (`EP-Q01`, `EP-Q02`, `EP-Q03`, `EP-Q07`).
 */
export interface QuizAttemptDTO {
  attempt_id: string;
  status: AttemptStatus;
  attempt_no: number;
  topic_id: string;
  topic_title?: string;
  career_level: CareerLevel;
  questions: QuizQuestionDTO[];
  saved_answers: SavedQuizAnswerDTO[];
  submitted_at: string | null;
}

export interface QuizAnswersSavedResponseDTO {
  saved: number;
  saved_at: string;
}

export interface QuizMcqScoreDTO {
  correct: number;
  total: number;
}

/**
 * `C05` §15.7 `QuizSubmitResponseDTO` (`EP-Q05`).
 */
export interface QuizSubmitResponseDTO {
  attempt_id: string;
  status: AttemptStatus;
  mcq_score: QuizMcqScoreDTO;
  plan_day_unlocked: boolean;
  next_plan_day_no: number | null;
  review_job_id: string | null;
}

export interface QuizResultMcqQuestionDTO {
  question_id: string;
  type: 'mcq';
  your_answer: string | null;
  correct_answer: string;
  is_correct: boolean;
  explanation: string | null;
  reportable: boolean;
}

export interface QuizResultFreeResponseQuestionDTO {
  question_id: string;
  type: 'free_response';
  user_answer?: string | null;
  explanation?: string | null;
  practice_review_id: string | null;
  review_status: ReviewStatus;
  reportable: boolean;
}

export type QuizResultQuestionDTO =
  QuizResultMcqQuestionDTO | QuizResultFreeResponseQuestionDTO;

/**
 * `C05` §15.7 `QuizResultDTO` (`EP-Q06`).
 */
export interface QuizResultDTO {
  attempt_id: string;
  status: AttemptStatus;
  attempt_no: number;
  topic_title?: string;
  mcq_score: QuizMcqScoreDTO;
  performance_level: PerformanceLevel | null;
  questions: QuizResultQuestionDTO[];
  improvement_recommendations: string[];
  progress_change: ProgressChangeSummaryDTO | null;
  retry_available: boolean;
}

export type GenerateQuizOutcome =
  | { statusCode: 200 | 201; body: QuizAttemptDTO }
  | { statusCode: 202; body: JobAcceptedDto };

export type RetryQuizOutcome =
  | { statusCode: 201; body: QuizAttemptDTO }
  | { statusCode: 202; body: JobAcceptedDto };

export type { LearningState };
