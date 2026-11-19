/** All 9 canonical `public.ai_task` enum values (`001_enums.sql`, `C05` §15.12). */
export const AI_TASKS = [
  'goal_interpretation',
  'roadmap_generate',
  'roadmap_revision',
  'merge_proposal',
  'topic_content',
  'quiz_generate',
  'practice_review',
  'mentor_chat',
  'technology_update',
] as const;

export type AiTask = (typeof AI_TASKS)[number];

/** Canonical `public.feature_key` enum values (`001_enums.sql`). */
export type FeatureKey =
  | 'roadmap_generator'
  | 'daily_plan'
  | 'quiz_practice'
  | 'ai_practice_review'
  | 'progress_tracking'
  | 'ai_mentor'
  | 'technology_update';

/** Canonical `public.ui_language` enum values (`001_enums.sql`). */
export type UiLanguage = 'bn' | 'en' | 'mixed';

/** Gateway execution mode gating `real_user_data_approved` (`PRD` §47). */
export type AiExecutionMode = 'real_user' | 'synthetic';

export interface AiBudgetDto {
  max_input_units: number;
  max_output_units: number;
  timeout_ms: number;
}

export interface SourceRefDTO {
  publisher: string;
  url: string;
  retrieved_at?: string;
}

/**
 * Internal AI Gateway request contract (`C05` §15.12 — never exposed directly to clients).
 */
export interface AIRequestDTO {
  request_id?: string;
  task: AiTask | string;
  user_id: string;
  feature_key?: FeatureKey;
  context: Record<string, unknown>;
  untrusted_inputs?: string[];
  output_schema: string;
  language: UiLanguage;
  idempotency_key: string;
  budget: AiBudgetDto;
  mode?: AiExecutionMode;
}

export type AiResponseStatus =
  | 'ok'
  | 'timeout'
  | 'provider_error'
  | 'validation_failed'
  | 'budget_exhausted';

/**
 * Internal AI Gateway response contract (`C05` §15.12 — provider/model never exposed to clients).
 */
export interface AIResponseDTO<T = unknown> {
  request_id: string;
  generation_id: string | null;
  status: AiResponseStatus;
  output: T | null;
  provider_id: string;
  model_id: string;
  fallback_used: boolean;
  prompt_version_id: string;
  usage_units: {
    input: number;
    output: number;
  };
  cost: number;
  latency_ms: number;
  validation_status: 'passed' | 'failed';
  sources: SourceRefDTO[];
}

/** Row shape projected from `public.ai_models` (`010_ai_operations.sql`). */
export interface AiModelRecord {
  id: string;
  provider_key: string;
  model_identifier: string;
  display_name: string;
  input_price_per_m_units: number;
  output_price_per_m_units: number;
  approved_tasks: string[];
  real_user_data_approved: boolean;
  fallback_rank: number | null;
  is_active: boolean;
}

/** Row shape projected from `public.prompt_versions` (`010_ai_operations.sql`). */
export interface PromptVersionRecord {
  id: string;
  task: AiTask;
  name: string;
  version: number;
  template_ref: string;
  template_hash: string;
  output_schema_id: string;
  is_active: boolean;
}

/** C08 §6.2.1 `goal_interpretation` output contract. */
export interface GoalInterpretationOutput {
  isTechnologyGoal: boolean;
  clarificationNeeded: boolean;
  clarificationRound: 0 | 1 | 2;
  clarificationQuestion: string | null;
  proposedRole: {
    canonicalRoleId: string;
    name: string;
  } | null;
  alternativeRoles: Array<{
    canonicalRoleId: string;
    name: string;
    matchReason: string;
  }>;
  suggestedLevel: 'junior' | 'mid' | 'senior' | null;
}

/** C08 §6.2.2 `roadmap_generate` & `roadmap_revision` output contract. */
export interface RoadmapGenerationOutput {
  targetLevel: 'junior' | 'mid' | 'senior';
  summary: {
    current_situation: string;
    target_interpretation: string;
    expected_career_impact: string;
    next_steps: string[];
  };
  phases: Array<{
    phase_no: number;
    title: string;
    milestones: Array<{ id: string; title: string }>;
    items: Array<{
      lineage_id?: string;
      topic_id: string;
      skill_id: string;
      title: string;
      priority: 'core' | 'supporting' | 'optional';
      gap_type:
        'existing' | 'transferable' | 'refresh' | 'strengthen' | 'missing';
      required_depth: string;
      estimated_effort_hours: number;
      sequence_no: number;
      depends_on_lineage_ids: string[];
      reason: string;
      sources: Array<{ publisher: string; url: string }>;
    }>;
  }>;
  level_outline: Array<{
    career_level: 'junior' | 'mid' | 'senior';
    outline: string[];
  }>;
  warnings: string[];
  size_guardrail: {
    active_topic_count: number;
    materially_large: boolean;
    warning: string | null;
  };
}

/** C08 §6.2.3 `merge_proposal` output contract. */
export interface MergeProposalOutput {
  reason: string;
  target_level: 'junior' | 'mid' | 'senior' | null;
  operations: Array<{
    sort_order: number;
    op:
      | 'add_topic'
      | 'update_topic'
      | 'reprioritize'
      | 'reclassify'
      | 'retire_topic';
    lineage_id: string | null;
    topic_id: string | null;
    title: string | null;
    priority: 'core' | 'supporting' | 'optional' | null;
    reason: string;
    payload: Record<string, unknown>;
  }>;
  size_impact: {
    active_topics_before: number;
    active_topics_after: number;
    materially_large: boolean;
    warning: string | null;
  };
}

/** C08 §6.2.4 `topic_content` output contract. */
export interface TopicContentOutput {
  explanation_markdown: string;
  important_questions: Array<{
    question: string;
    answer_markdown: string;
  }>;
  language: UiLanguage;
  sources: Array<{
    title: string;
    publisher: string;
    url: string;
    resource_type:
      | 'official_docs'
      | 'release_notes'
      | 'article'
      | 'standard'
      | 'video'
      | 'other';
  }>;
}

/** C08 §6.2.5 `quiz_generate` output contract. */
export interface QuizGenerationOutput {
  is_reduced: boolean;
  mcq_questions: Array<{
    sort_order: number;
    difficulty: 'basic' | 'application' | 'analysis';
    prompt: string;
    options: Array<{ option_id: string; text: string }>;
    correct_option_id: string;
    explanation: string;
    allow_i_dont_know: boolean;
  }>;
  free_response_questions: Array<{
    sort_order: number;
    difficulty: 'basic' | 'application' | 'analysis';
    prompt: string;
    response_hint:
      | 'sql'
      | 'code'
      | 'config'
      | 'test_case'
      | 'debug'
      | 'command'
      | 'design'
      | 'text';
    rubric: {
      correctness_criteria: string[];
      understanding_criteria: string[];
      reasoning_criteria: string[];
    };
    max_length: number;
    allow_i_dont_know: boolean;
  }>;
}

/** C08 §6.2.6 `practice_review` output contract. */
export interface PracticeReviewOutput {
  review_status: 'reviewed' | 'not_evidence';
  performance_level: 'good' | 'needs_work' | null;
  dimensions: {
    correctness: 'good' | 'partial' | 'weak';
    understanding: 'good' | 'partial' | 'weak';
    reasoning: 'good' | 'partial' | 'weak';
  } | null;
  strengths: string[];
  mistakes: string[];
  weaknesses: string[];
  improvement_recommendations: string[];
  evidence_eligible: boolean;
}

/** C08 §6.2.7 `mentor_chat` output contract. */
export interface MentorChatOutput {
  content: string;
  language: UiLanguage;
  safety_mode: boolean;
  learning_claim_recorded: boolean;
}

/** C08 §6.2.8 `technology_update` output contract. */
export interface TechnologyUpdateOutput {
  has_meaningful_update: boolean;
  title: string | null;
  what_changed: string | null;
  why_it_matters: string | null;
  publisher: string | null;
  source_url: string | null;
  release_status: 'released' | 'announced' | 'planned' | 'experimental' | null;
  relevance: 'high' | 'medium' | 'low' | null;
  action_timing: 'act_now' | 'learn_later' | 'awareness_only' | null;
  roadmap_relation: string | null;
  propose_roadmap_merge: boolean;
}
