/**
 * Canonical job status values (`public.job_status` enum in `001_enums.sql`).
 */
export type JobStatus = 'queued' | 'preparing' | 'succeeded' | 'failed';

/**
 * Canonical job kind values (`public.job_kind` enum in `001_enums.sql`, C05 §14.13).
 */
export type JobKind =
  | 'career_goal'
  | 'roadmap_generate'
  | 'roadmap_revision'
  | 'merge_proposal'
  | 'topic_content'
  | 'quiz_generate'
  | 'practice_review';

/**
 * Result reference returned when an async job transitions to `succeeded` (`C05` §13.6 / §14.13 / §15.1).
 */
export interface JobResultRefDto {
  type: string;
  id: string;
}

/**
 * Sanitized error summary returned on `JobStatusDto` when `status === 'failed'` (`C05` §14.13 / §15.1).
 */
export interface JobErrorDto {
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * `JobAcceptedDTO` (`C05` §13.6 / §15.1) returned on `202 Accepted` asynchronous job creation.
 */
export interface JobAcceptedDto {
  job_id: string;
  status: JobStatus;
  poll_url: string;
  retry_after_seconds: number;
}

/**
 * `JobStatusDTO` (`C05` §14.13 `EP-J01` / §15.1) returned by `GET /api/v1/jobs/:id`.
 *
 * Security invariant (`R12` / `C05` §15.12):
 * NEVER includes `input_payload`, `locked_by`, `attempt_count`, raw prompts, or provider/model internals.
 */
export interface JobStatusDto {
  job_id: string;
  kind: JobKind | string;
  status: JobStatus;
  result_ref: JobResultRefDto | null;
  error: JobErrorDto | null;
  retryable: boolean;
  created_at: string;
  finished_at: string | null;
}
