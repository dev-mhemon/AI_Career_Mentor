import { Injectable } from '@nestjs/common';
import { fail } from '../../common/http.js';
import type { AiTask } from '../ai.types.js';

const HTTP_URL_PATTERN = /^https?:\/\/.+/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAREER_LEVELS = new Set(['junior', 'mid', 'senior']);
const ITEM_PRIORITIES = new Set(['core', 'supporting', 'optional']);
const GAP_TYPES = new Set([
  'existing',
  'transferable',
  'refresh',
  'strengthen',
  'missing',
]);
const MERGE_OPS = new Set([
  'add_topic',
  'update_topic',
  'reprioritize',
  'reclassify',
  'retire_topic',
]);
const RESOURCE_TYPES = new Set([
  'official_docs',
  'release_notes',
  'article',
  'standard',
  'video',
  'other',
]);
const QUESTION_DIFFICULTIES = new Set(['basic', 'application', 'analysis']);
const RESPONSE_HINTS = new Set([
  'sql',
  'code',
  'config',
  'test_case',
  'debug',
  'command',
  'design',
  'text',
]);
const REVIEW_RATINGS = new Set(['good', 'partial', 'weak']);
const UI_LANGUAGES = new Set(['bn', 'en', 'mixed']);
const RELEASE_STATUSES = new Set([
  'released',
  'announced',
  'planned',
  'experimental',
]);
const RELEVANCE_LEVELS = new Set(['high', 'medium', 'low']);
const ACTION_TIMINGS = new Set(['act_now', 'learn_later', 'awareness_only']);
const JOB_GUARANTEE_PATTERN =
  /\b(job[\s-]?ready|guarantee[ds]?\s+(a\s+)?job|100%\s+placement)\b/i;

function validationFail(): never {
  fail(
    502,
    'AI_VALIDATION_FAILED',
    'AI output failed validation and was discarded. Please try again.',
    undefined,
    true,
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    validationFail();
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown, maxLen = 20_000): string {
  if (typeof value !== 'string') {
    validationFail();
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) {
    validationFail();
  }
  return trimmed;
}

function asCanonicalUuid(value: unknown): string {
  const raw = asNonEmptyString(value, 128);
  if (!UUID_PATTERN.test(raw)) {
    validationFail();
  }
  return raw.toLowerCase();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    validationFail();
  }
  return value.map((item) => asNonEmptyString(item, 4_000));
}

function isEnumValue(set: ReadonlySet<string>, value: unknown): boolean {
  return typeof value === 'string' && set.has(value);
}

function assertDagAcyclic(edges: Map<string, string[]>): void {
  // 0 = unvisited, 1 = visiting, 2 = visited
  const state = new Map<string, number>();

  const visit = (node: string): void => {
    const cur = state.get(node) ?? 0;
    if (cur === 1) {
      validationFail();
    }
    if (cur === 2) {
      return;
    }
    state.set(node, 1);
    for (const dep of edges.get(node) ?? []) {
      visit(dep);
    }
    state.set(node, 2);
  };

  for (const node of edges.keys()) {
    if ((state.get(node) ?? 0) === 0) {
      visit(node);
    }
  }
}

function validateGoalInterpretation(raw: Record<string, unknown>): void {
  if (
    typeof raw.isTechnologyGoal !== 'boolean' ||
    typeof raw.clarificationNeeded !== 'boolean' ||
    ![0, 1, 2].includes(raw.clarificationRound as number)
  ) {
    validationFail();
  }
  if (
    raw.clarificationQuestion !== null &&
    typeof raw.clarificationQuestion !== 'string'
  ) {
    validationFail();
  }
  if (raw.proposedRole !== null) {
    const role = asRecord(raw.proposedRole);
    asNonEmptyString(role.canonicalRoleId, 128);
    asNonEmptyString(role.name, 200);
  }
  if (!Array.isArray(raw.alternativeRoles)) {
    validationFail();
  }
  for (const alt of raw.alternativeRoles) {
    const rec = asRecord(alt);
    asNonEmptyString(rec.canonicalRoleId, 128);
    asNonEmptyString(rec.name, 200);
    asNonEmptyString(rec.matchReason, 500);
  }
  if (
    raw.suggestedLevel !== null &&
    !isEnumValue(CAREER_LEVELS, raw.suggestedLevel)
  ) {
    validationFail();
  }
}

function validateRoadmap(raw: Record<string, unknown>): void {
  if (!isEnumValue(CAREER_LEVELS, raw.targetLevel)) {
    validationFail();
  }
  const summary = asRecord(raw.summary);
  asNonEmptyString(summary.current_situation, 2_000);
  asNonEmptyString(summary.target_interpretation, 2_000);
  asNonEmptyString(summary.expected_career_impact, 2_000);
  asStringArray(summary.next_steps);

  if (!Array.isArray(raw.phases) || raw.phases.length === 0) {
    validationFail();
  }
  const dagEdges = new Map<string, string[]>();
  for (const rawPhase of raw.phases) {
    const phase = asRecord(rawPhase);
    if (typeof phase.phase_no !== 'number' || phase.phase_no < 1) {
      validationFail();
    }
    asNonEmptyString(phase.title, 300);
    if (!Array.isArray(phase.milestones) || !Array.isArray(phase.items)) {
      validationFail();
    }
    for (const rawMilestone of phase.milestones) {
      const milestone = asRecord(rawMilestone);
      asNonEmptyString(milestone.id, 128);
      asNonEmptyString(milestone.title, 300);
    }
    for (const rawItem of phase.items) {
      const item = asRecord(rawItem);
      asNonEmptyString(item.topic_id, 128);
      asNonEmptyString(item.skill_id, 128);
      asNonEmptyString(item.title, 300);
      if (!isEnumValue(ITEM_PRIORITIES, item.priority)) {
        validationFail();
      }
      if (!isEnumValue(GAP_TYPES, item.gap_type)) {
        validationFail();
      }
      asNonEmptyString(item.required_depth, 100);
      if (
        typeof item.estimated_effort_hours !== 'number' ||
        item.estimated_effort_hours < 0
      ) {
        validationFail();
      }
      if (typeof item.sequence_no !== 'number' || item.sequence_no < 1) {
        validationFail();
      }
      if (!Array.isArray(item.depends_on_lineage_ids)) {
        validationFail();
      }
      asNonEmptyString(item.reason, 1_000);
      if (!Array.isArray(item.sources)) {
        validationFail();
      }
      for (const rawSrc of item.sources) {
        const src = asRecord(rawSrc);
        asNonEmptyString(src.publisher, 200);
        const url = asNonEmptyString(src.url, 2_000);
        if (!HTTP_URL_PATTERN.test(url)) {
          validationFail();
        }
      }

      const nodeId =
        item.lineage_id !== undefined && item.lineage_id !== null
          ? asCanonicalUuid(item.lineage_id)
          : `${phase.phase_no}:${item.sequence_no}:${item.topic_id}`;
      if (dagEdges.has(nodeId)) {
        validationFail();
      }
      const deps = item.depends_on_lineage_ids.map((d) => asCanonicalUuid(d));
      dagEdges.set(nodeId, deps);
    }
  }
  assertDagAcyclic(dagEdges);

  if (!Array.isArray(raw.level_outline) || !Array.isArray(raw.warnings)) {
    validationFail();
  }
  for (const rawOutline of raw.level_outline) {
    const outline = asRecord(rawOutline);
    if (!isEnumValue(CAREER_LEVELS, outline.career_level)) {
      validationFail();
    }
    asStringArray(outline.outline);
  }
  asStringArray(raw.warnings);
  const guardrail = asRecord(raw.size_guardrail);
  if (
    typeof guardrail.active_topic_count !== 'number' ||
    typeof guardrail.materially_large !== 'boolean'
  ) {
    validationFail();
  }
}

function validateMergeProposal(raw: Record<string, unknown>): void {
  asNonEmptyString(raw.reason, 1_000);
  if (
    raw.target_level !== null &&
    !isEnumValue(CAREER_LEVELS, raw.target_level)
  ) {
    validationFail();
  }
  if (!Array.isArray(raw.operations)) {
    validationFail();
  }
  for (const rawOp of raw.operations) {
    const op = asRecord(rawOp);
    if (typeof op.sort_order !== 'number' || op.sort_order < 1) {
      validationFail();
    }
    if (!isEnumValue(MERGE_OPS, op.op)) {
      validationFail();
    }
    if (op.op === 'add_topic') {
      asNonEmptyString(op.topic_id, 128);
    } else {
      asNonEmptyString(op.lineage_id, 128);
    }
    if (op.priority !== null && !isEnumValue(ITEM_PRIORITIES, op.priority)) {
      validationFail();
    }
    asNonEmptyString(op.reason, 1_000);
    asRecord(op.payload);
  }
  const impact = asRecord(raw.size_impact);
  if (
    typeof impact.active_topics_before !== 'number' ||
    typeof impact.active_topics_after !== 'number' ||
    typeof impact.materially_large !== 'boolean'
  ) {
    validationFail();
  }
}

function validateTopicContent(raw: Record<string, unknown>): void {
  asNonEmptyString(raw.explanation_markdown, 50_000);
  if (!isEnumValue(UI_LANGUAGES, raw.language)) {
    validationFail();
  }
  if (!Array.isArray(raw.important_questions) || !Array.isArray(raw.sources)) {
    validationFail();
  }
  for (const rawQa of raw.important_questions) {
    const qa = asRecord(rawQa);
    asNonEmptyString(qa.question, 1_000);
    asNonEmptyString(qa.answer_markdown, 10_000);
  }
  for (const rawSrc of raw.sources) {
    const src = asRecord(rawSrc);
    asNonEmptyString(src.title, 300);
    asNonEmptyString(src.publisher, 200);
    const url = asNonEmptyString(src.url, 2_000);
    if (!HTTP_URL_PATTERN.test(url)) {
      validationFail();
    }
    if (!isEnumValue(RESOURCE_TYPES, src.resource_type)) {
      validationFail();
    }
  }
}

function validateQuizGenerate(raw: Record<string, unknown>): void {
  if (typeof raw.is_reduced !== 'boolean') {
    validationFail();
  }
  if (
    !Array.isArray(raw.mcq_questions) ||
    !Array.isArray(raw.free_response_questions)
  ) {
    validationFail();
  }
  if (!raw.is_reduced) {
    if (
      raw.mcq_questions.length !== 20 ||
      raw.free_response_questions.length < 5 ||
      raw.free_response_questions.length > 10
    ) {
      validationFail();
    }
  }
  for (const rawMcq of raw.mcq_questions) {
    const mcq = asRecord(rawMcq);
    if (
      typeof mcq.sort_order !== 'number' ||
      !isEnumValue(QUESTION_DIFFICULTIES, mcq.difficulty) ||
      typeof mcq.allow_i_dont_know !== 'boolean'
    ) {
      validationFail();
    }
    asNonEmptyString(mcq.prompt, 4_000);
    asNonEmptyString(mcq.explanation, 4_000);
    if (
      !Array.isArray(mcq.options) ||
      mcq.options.length < 2 ||
      mcq.options.length > 6
    ) {
      validationFail();
    }
    const optionIds = new Set<string>();
    for (const rawOpt of mcq.options) {
      const opt = asRecord(rawOpt);
      const optionId = asNonEmptyString(opt.option_id, 64);
      asNonEmptyString(opt.text, 1_000);
      optionIds.add(optionId);
    }
    const correctId = asNonEmptyString(mcq.correct_option_id, 64);
    if (!optionIds.has(correctId)) {
      validationFail();
    }
  }
  for (const rawFr of raw.free_response_questions) {
    const fr = asRecord(rawFr);
    if (
      typeof fr.sort_order !== 'number' ||
      !isEnumValue(QUESTION_DIFFICULTIES, fr.difficulty) ||
      !isEnumValue(RESPONSE_HINTS, fr.response_hint) ||
      typeof fr.allow_i_dont_know !== 'boolean' ||
      typeof fr.max_length !== 'number' ||
      fr.max_length < 1 ||
      fr.max_length > 8_000
    ) {
      validationFail();
    }
    asNonEmptyString(fr.prompt, 4_000);
    const rubric = asRecord(fr.rubric);
    asStringArray(rubric.correctness_criteria);
    asStringArray(rubric.understanding_criteria);
    asStringArray(rubric.reasoning_criteria);
  }
}

function validatePracticeReview(raw: Record<string, unknown>): void {
  if (
    raw.review_status !== 'reviewed' &&
    raw.review_status !== 'not_evidence'
  ) {
    validationFail();
  }
  if (typeof raw.evidence_eligible !== 'boolean') {
    validationFail();
  }
  if (raw.review_status === 'not_evidence') {
    if (raw.evidence_eligible !== false || raw.performance_level !== null) {
      validationFail();
    }
  } else {
    if (
      raw.performance_level !== 'good' &&
      raw.performance_level !== 'needs_work'
    ) {
      validationFail();
    }
    const dims = asRecord(raw.dimensions);
    if (
      !isEnumValue(REVIEW_RATINGS, dims.correctness) ||
      !isEnumValue(REVIEW_RATINGS, dims.understanding) ||
      !isEnumValue(REVIEW_RATINGS, dims.reasoning)
    ) {
      validationFail();
    }
  }
  if (
    !Array.isArray(raw.strengths) ||
    !Array.isArray(raw.mistakes) ||
    !Array.isArray(raw.weaknesses) ||
    !Array.isArray(raw.improvement_recommendations)
  ) {
    validationFail();
  }
}

function validateMentorChat(raw: Record<string, unknown>): void {
  const content = asNonEmptyString(raw.content, 16_000);
  if (JOB_GUARANTEE_PATTERN.test(content)) {
    validationFail();
  }
  if (
    !isEnumValue(UI_LANGUAGES, raw.language) ||
    typeof raw.safety_mode !== 'boolean' ||
    typeof raw.learning_claim_recorded !== 'boolean'
  ) {
    validationFail();
  }
}

function validateTechnologyUpdate(raw: Record<string, unknown>): void {
  if (
    typeof raw.has_meaningful_update !== 'boolean' ||
    typeof raw.propose_roadmap_merge !== 'boolean'
  ) {
    validationFail();
  }
  if (raw.has_meaningful_update) {
    asNonEmptyString(raw.title, 300);
    asNonEmptyString(raw.what_changed, 4_000);
    asNonEmptyString(raw.why_it_matters, 4_000);
    asNonEmptyString(raw.publisher, 200);
    const sourceUrl = asNonEmptyString(raw.source_url, 2_000);
    if (!HTTP_URL_PATTERN.test(sourceUrl)) {
      validationFail();
    }
    if (
      !isEnumValue(RELEASE_STATUSES, raw.release_status) ||
      !isEnumValue(RELEVANCE_LEVELS, raw.relevance) ||
      !isEnumValue(ACTION_TIMINGS, raw.action_timing)
    ) {
      validationFail();
    }
  }
}

/**
 * Strictly validates structured AI outputs against C08 §6.2 schemas and business invariants.
 * Discards invalid outputs and throws `502 AI_VALIDATION_FAILED`.
 */
@Injectable()
export class OutputValidatorService {
  validate<T>(task: AiTask, _outputSchemaId: string, rawOutput: unknown): T {
    const raw = asRecord(rawOutput);
    switch (task) {
      case 'goal_interpretation':
        validateGoalInterpretation(raw);
        break;
      case 'roadmap_generate':
      case 'roadmap_revision':
        validateRoadmap(raw);
        break;
      case 'merge_proposal':
        validateMergeProposal(raw);
        break;
      case 'topic_content':
        validateTopicContent(raw);
        break;
      case 'quiz_generate':
        validateQuizGenerate(raw);
        break;
      case 'practice_review':
        validatePracticeReview(raw);
        break;
      case 'mentor_chat':
        validateMentorChat(raw);
        break;
      case 'technology_update':
        validateTechnologyUpdate(raw);
        break;
    }
    return raw as T;
  }
}
