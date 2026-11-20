import { Injectable } from '@nestjs/common';
import type {
  AiExecutionMode,
  AiModelRecord,
  AiTask,
  GoalInterpretationOutput,
  MentorChatOutput,
  MergeProposalOutput,
  PracticeReviewOutput,
  QuizGenerationOutput,
  RoadmapGenerationOutput,
  SourceRefDTO,
  TechnologyUpdateOutput,
  TopicContentOutput,
  UiLanguage,
} from '../ai.types.js';

/** Injection token for the pluggable AI provider adapter (`ADR-008`). */
export const AI_PROVIDER_ADAPTER = Symbol('AI_PROVIDER_ADAPTER');

export interface ProviderInvocationRequest {
  requestId: string;
  model: AiModelRecord;
  task: AiTask;
  language: UiLanguage;
  systemPrompt: string;
  userEnvelope: string;
  outputSchemaId: string;
  maxOutputUnits: number;
  timeoutMs: number;
  mode?: AiExecutionMode;
  signal?: AbortSignal;
}

export interface ProviderInvocationResult {
  output: unknown;
  inputUnits: number;
  outputUnits: number;
  latencyMs: number;
  sources?: SourceRefDTO[];
}

export type ProviderErrorKind =
  | 'timeout'
  | 'rate_limit'
  | 'provider_error'
  | 'policy_rejected'
  | 'budget_exceeded';

/**
 * Typed provider failure surfaced internally to `AiGatewayService` for circuit breaking and failover.
 * Never forwarded verbatim to clients.
 */
export class ProviderInvocationError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly statusCode?: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProviderInvocationError';
  }
}

/** Provider-agnostic adapter boundary (`ADR-008`, `PRD` §47). */
export interface ProviderAdapter {
  invoke(request: ProviderInvocationRequest): Promise<ProviderInvocationResult>;
}

export type SyntheticRuleOutcome =
  | 'ok'
  | 'timeout'
  | 'provider_error'
  | 'rate_limit'
  | 'invalid_schema'
  | ((
      request: ProviderInvocationRequest,
    ) => ProviderInvocationResult | Promise<ProviderInvocationResult>);

const SYNTHETIC_UUID_1 = '11111111-1111-4111-8111-111111111111';
const SYNTHETIC_UUID_2 = '22222222-2222-4222-8222-222222222222';
const SYNTHETIC_UUID_3 = '33333333-3333-4333-8333-333333333333';

function languageSampleLabel(language: UiLanguage): string {
  switch (language) {
    case 'bn':
      return 'বাংলা নির্দেশিকা';
    case 'mixed':
      return 'Bangla-English (মিক্সড) guidance';
    case 'en':
    default:
      return 'English guidance';
  }
}

interface SeededCareerRoleEntry {
  slug: string;
  name: string;
  alternatives: readonly [string, string];
  reasons: readonly [string, string];
}

const SEEDED_CAREER_ROLES: Readonly<Record<string, SeededCareerRoleEntry>> = {
  'frontend-development': {
    slug: 'frontend-development',
    name: 'Frontend Development',
    alternatives: ['full-stack-development', 'mobile-development'],
    reasons: [
      'Combines frontend UI expertise with backend API development.',
      'Transfers component-driven UI engineering skills to mobile apps.',
    ],
  },
  'backend-development': {
    slug: 'backend-development',
    name: 'Backend Development',
    alternatives: ['full-stack-development', 'cloud-engineering'],
    reasons: [
      'Overlapping API and web engineering skills.',
      'Extends backend services into scalable cloud infrastructure.',
    ],
  },
  'full-stack-development': {
    slug: 'full-stack-development',
    name: 'Full-Stack Development',
    alternatives: ['frontend-development', 'backend-development'],
    reasons: [
      'Deepens user-facing interface architecture and web performance.',
      'Focuses on server-side APIs, databases, and distributed systems.',
    ],
  },
  'data-engineering': {
    slug: 'data-engineering',
    name: 'Data Engineering',
    alternatives: ['ai-ml-engineering', 'backend-development'],
    reasons: [
      'Builds predictive modeling on top of analytical data pipelines.',
      'Shares SQL, distributed systems, and production service design.',
    ],
  },
  'ai-application-llm-engineering': {
    slug: 'ai-application-llm-engineering',
    name: 'AI Application / LLM Engineering',
    alternatives: ['ai-ml-engineering', 'backend-development'],
    reasons: [
      'Deepens foundational machine learning and model training skills.',
      'Applies API design and system integration to AI products.',
    ],
  },
  'ai-ml-engineering': {
    slug: 'ai-ml-engineering',
    name: 'AI / Machine Learning Engineering',
    alternatives: ['ai-application-llm-engineering', 'data-engineering'],
    reasons: [
      'Focuses on building production applications with language models.',
      'Strengthens data pipelines and feature infrastructure for ML.',
    ],
  },
  devops: {
    slug: 'devops',
    name: 'DevOps',
    alternatives: ['cloud-engineering', 'site-reliability-engineering'],
    reasons: [
      'Specializes in cloud architecture and infrastructure provisioning.',
      'Focuses on production observability, reliability, and incident response.',
    ],
  },
  'site-reliability-engineering': {
    slug: 'site-reliability-engineering',
    name: 'Site Reliability Engineering',
    alternatives: ['devops', 'cloud-engineering'],
    reasons: [
      'Shares CI/CD automation and infrastructure delivery workflows.',
      'Deepens cloud platform architecture and scalability.',
    ],
  },
  'cloud-engineering': {
    slug: 'cloud-engineering',
    name: 'Cloud Engineering',
    alternatives: ['devops', 'site-reliability-engineering'],
    reasons: [
      'Pairs cloud architecture with automated deployment pipelines.',
      'Adds production reliability engineering and SLO practices.',
    ],
  },
  'mobile-development': {
    slug: 'mobile-development',
    name: 'Mobile Development',
    alternatives: ['frontend-development', 'full-stack-development'],
    reasons: [
      'Shares component-based UI engineering and modern web frameworks.',
      'Pairs mobile clients with backend APIs and web interfaces.',
    ],
  },
  'qa-automation-sdet': {
    slug: 'qa-automation-sdet',
    name: 'QA Automation / SDET',
    alternatives: ['qa-software-testing', 'backend-development'],
    reasons: [
      'Covers comprehensive test strategy, exploratory, and release quality.',
      'Applies software engineering skills to backend services and tooling.',
    ],
  },
  'qa-software-testing': {
    slug: 'qa-software-testing',
    name: 'QA / Software Testing',
    alternatives: ['qa-automation-sdet', 'frontend-development'],
    reasons: [
      'Advances into automated test frameworks and CI quality engineering.',
      'Pairs product quality focus with user-facing web engineering.',
    ],
  },
  cybersecurity: {
    slug: 'cybersecurity',
    name: 'Cybersecurity',
    alternatives: ['cloud-engineering', 'site-reliability-engineering'],
    reasons: [
      'Secures cloud infrastructure, IAM, and network boundaries.',
      'Combines defensive engineering with resilient production operations.',
    ],
  },
};

const GOAL_ROLE_KEYWORD_RULES: ReadonlyArray<{
  pattern: RegExp;
  slug: string;
}> = [
  { pattern: /full[\s-]?stack/i, slug: 'full-stack-development' },
  {
    pattern:
      /front[\s-]?end|\breact\b(?![\s-]native)|vue|angular|next\.?js|ui\s+dev|web\s+ui|css|html|ফ্রন্টএন্ড/i,
    slug: 'frontend-development',
  },
  {
    pattern:
      /mobile|android|\bios\b|flutter|\breact[\s-]native\b|swift|kotlin/i,
    slug: 'mobile-development',
  },
  {
    pattern: /llm|gen[\s-]?ai|generative\s+ai|ai\s+app|prompt\s+eng|\brag\b/i,
    slug: 'ai-application-llm-engineering',
  },
  {
    pattern:
      /\bai\b|artificial\s+intelligence|machine\s+learning|\bml\b|deep\s+learning|pytorch|tensorflow/i,
    slug: 'ai-ml-engineering',
  },
  {
    pattern:
      /data\s+(analyst|analytics|engineer|science|scientist|pipeline|warehouse)|analytics|\betl\b|\bbi\b|\bdata\b/i,
    slug: 'data-engineering',
  },
  {
    pattern: /\bsre\b|site\s+reliability|reliability\s+eng/i,
    slug: 'site-reliability-engineering',
  },
  {
    pattern: /dev[\s-]?ops|ci[\s/]?cd|kubernetes|\bk8s\b|docker|terraform/i,
    slug: 'devops',
  },
  {
    pattern: /cloud|\baws\b|\bazure\b|\bgcp\b/i,
    slug: 'cloud-engineering',
  },
  {
    pattern: /cyber|security|infosec|appsec|pentest|soc\s+analyst/i,
    slug: 'cybersecurity',
  },
  {
    pattern:
      /sdet|qa\s+automation|test\s+automation|playwright|selenium|cypress/i,
    slug: 'qa-automation-sdet',
  },
  {
    pattern: /\bqa\b|quality\s+assurance|software\s+test|tester/i,
    slug: 'qa-software-testing',
  },
  {
    pattern:
      /back[\s-]?end|\bapi\b|node\.?js|django|fastapi|spring|golang|micro[\s-]?service|server|ব্যাকএন্ড/i,
    slug: 'backend-development',
  },
];

interface ContextApprovedRole {
  canonical_role_id?: unknown;
  slug?: unknown;
  name?: unknown;
}

function extractGoalTextFromEnvelope(userEnvelope: string): string {
  const inputMatches = Array.from(
    userEnvelope.matchAll(
      /<untrusted_data\s+index="\d+"\s+treat_as="data_only">\s*([\s\S]*?)\s*<\/untrusted_data>/g,
    ),
  );
  if (inputMatches.length > 0) {
    return inputMatches.map((m) => m[1]).join(' ');
  }
  const withoutContext = userEnvelope.replace(
    /<untrusted_data\s+index="context"\s+treat_as="data_only">[\s\S]*?<\/untrusted_data>/g,
    '',
  );
  return withoutContext;
}

function extractApprovedRolesFromEnvelope(
  userEnvelope: string,
): Map<string, { id: string; name: string }> {
  const bySlugOrName = new Map<string, { id: string; name: string }>();
  const match = userEnvelope.match(
    /<untrusted_data\s+index="context"\s+treat_as="data_only">\s*([\s\S]*?)\s*<\/untrusted_data>/,
  );
  if (!match) {
    return bySlugOrName;
  }
  try {
    const parsed = JSON.parse(match[1]) as { approved_roles?: unknown };
    if (!Array.isArray(parsed?.approved_roles)) {
      return bySlugOrName;
    }
    for (const raw of parsed.approved_roles as ContextApprovedRole[]) {
      if (
        typeof raw?.canonical_role_id === 'string' &&
        typeof raw?.name === 'string' &&
        raw.canonical_role_id.trim() &&
        raw.name.trim()
      ) {
        const entry = {
          id: raw.canonical_role_id.trim(),
          name: raw.name.trim(),
        };
        if (typeof raw.slug === 'string' && raw.slug.trim()) {
          bySlugOrName.set(raw.slug.trim().toLowerCase(), entry);
        }
        bySlugOrName.set(entry.name.toLowerCase(), entry);
      }
    }
  } catch {
    // Ignore malformed context JSON and fall back to deterministic synthetic UUIDs.
  }
  return bySlugOrName;
}

function matchGoalRoleSlug(goalText: string): string {
  for (const rule of GOAL_ROLE_KEYWORD_RULES) {
    if (rule.pattern.test(goalText)) {
      return rule.slug;
    }
  }
  return 'backend-development';
}

function buildSyntheticGoalInterpretation(
  language: UiLanguage,
  userEnvelope = '',
): GoalInterpretationOutput {
  const goalText = extractGoalTextFromEnvelope(userEnvelope);
  const contextRoles = extractApprovedRolesFromEnvelope(userEnvelope);
  const primarySlug = matchGoalRoleSlug(goalText);
  const primarySpec =
    SEEDED_CAREER_ROLES[primarySlug] ??
    SEEDED_CAREER_ROLES['backend-development'];
  const [alt1Slug, alt2Slug] = primarySpec.alternatives;
  const alt1Spec = SEEDED_CAREER_ROLES[alt1Slug];
  const alt2Spec = SEEDED_CAREER_ROLES[alt2Slug];

  const resolveRole = (spec: SeededCareerRoleEntry, fallbackId: string) => {
    const found =
      contextRoles.get(spec.slug) ?? contextRoles.get(spec.name.toLowerCase());
    if (found) {
      return {
        canonicalRoleId: found.id,
        name: found.name,
        matchedCatalog: true,
      };
    }
    return {
      canonicalRoleId: fallbackId,
      name: spec.name,
      matchedCatalog: false,
    };
  };

  const hasApprovedCatalog = contextRoles.size > 0;
  const primary = resolveRole(primarySpec, SYNTHETIC_UUID_1);
  const candidateAlternatives = [
    {
      role: resolveRole(alt1Spec, SYNTHETIC_UUID_2),
      matchReason:
        language === 'bn' && primarySpec.slug === 'backend-development'
          ? 'এপিআই ও ওয়েব স্কিলের মিল রয়েছে।'
          : primarySpec.reasons[0],
    },
    {
      role: resolveRole(alt2Spec, SYNTHETIC_UUID_3),
      matchReason: primarySpec.reasons[1],
    },
  ];
  const alternativeRoles = candidateAlternatives
    .filter(({ role }) => !hasApprovedCatalog || role.matchedCatalog)
    .map(({ role, matchReason }) => ({
      canonicalRoleId: role.canonicalRoleId,
      name: role.name,
      matchReason,
    }));

  return {
    isTechnologyGoal: true,
    clarificationNeeded: false,
    clarificationRound: 0,
    clarificationQuestion: null,
    proposedRole: {
      canonicalRoleId: primary.canonicalRoleId,
      name: primary.name,
    },
    alternativeRoles,
    suggestedLevel: 'junior',
  };
}

function buildSyntheticRoadmap(language: UiLanguage): RoadmapGenerationOutput {
  const label = languageSampleLabel(language);
  return {
    targetLevel: 'junior',
    summary: {
      current_situation: `${label}: foundational baseline captured.`,
      target_interpretation: 'Structured backend engineering career path.',
      expected_career_impact: 'Builds verified API and database competence.',
      next_steps: [
        'Complete core TypeScript HTTP module',
        'Practice PostgreSQL indexing',
      ],
    },
    phases: [
      {
        phase_no: 1,
        title:
          language === 'bn'
            ? 'ধাপ ১: কোর ফাউন্ডেশন'
            : 'Phase 1: Core Foundations',
        milestones: [{ id: 'ms-1', title: 'HTTP & Relational Basics' }],
        items: [
          {
            lineage_id: SYNTHETIC_UUID_1,
            topic_id: SYNTHETIC_UUID_2,
            skill_id: SYNTHETIC_UUID_3,
            title: 'TypeScript & REST API Design',
            priority: 'core',
            gap_type: 'missing',
            required_depth: 'application',
            estimated_effort_hours: 6,
            sequence_no: 1,
            depends_on_lineage_ids: [],
            reason: 'Essential foundation for backend service delivery.',
            sources: [
              {
                publisher: 'TypeScript Docs',
                url: 'https://www.typescriptlang.org/docs/',
              },
            ],
          },
          {
            lineage_id: SYNTHETIC_UUID_2,
            topic_id: SYNTHETIC_UUID_3,
            skill_id: SYNTHETIC_UUID_1,
            title: 'PostgreSQL Query & Locking',
            priority: 'core',
            gap_type: 'strengthen',
            required_depth: 'application',
            estimated_effort_hours: 8,
            sequence_no: 2,
            depends_on_lineage_ids: [SYNTHETIC_UUID_1],
            reason: 'Required for safe transactional persistence.',
            sources: [
              {
                publisher: 'PostgreSQL Docs',
                url: 'https://www.postgresql.org/docs/',
              },
            ],
          },
        ],
      },
    ],
    level_outline: [
      { career_level: 'junior', outline: ['REST APIs', 'SQL Basics'] },
      { career_level: 'mid', outline: ['Distributed Queues', 'Indexing'] },
      { career_level: 'senior', outline: ['Architecture', 'Reliability'] },
    ],
    warnings: [],
    size_guardrail: {
      active_topic_count: 2,
      materially_large: false,
      warning: null,
    },
  };
}

function buildSyntheticMergeProposal(): MergeProposalOutput {
  return {
    reason: 'Adds missing observability topic based on target level update.',
    target_level: 'mid',
    operations: [
      {
        sort_order: 1,
        op: 'add_topic',
        lineage_id: null,
        topic_id: SYNTHETIC_UUID_2,
        title: 'Structured Logging & OpenTelemetry',
        priority: 'supporting',
        reason: 'Improves production debugging readiness.',
        payload: { phase_no: 2 },
      },
    ],
    size_impact: {
      active_topics_before: 10,
      active_topics_after: 11,
      materially_large: false,
      warning: null,
    },
  };
}

function buildSyntheticTopicContent(language: UiLanguage): TopicContentOutput {
  return {
    explanation_markdown:
      language === 'bn'
        ? '# ট্রানজ্যাকশন আইসোলেশন\n\nডাটাবেস সামঞ্জস্য বজায় রাখতে সঠিক লকিং ব্যবহার করুন।'
        : '# Transaction Isolation\n\nUse explicit row locks (`FOR UPDATE`) when coordinating state transitions.',
    important_questions: [
      {
        question: 'When should SKIP LOCKED be used?',
        answer_markdown:
          'When concurrent queue consumers claim independent rows without blocking.',
      },
    ],
    language,
    sources: [
      {
        title: 'PostgreSQL Explicit Locking',
        publisher: 'PostgreSQL Global Development Group',
        url: 'https://www.postgresql.org/docs/current/explicit-locking.html',
        resource_type: 'official_docs',
      },
    ],
  };
}

function buildSyntheticQuiz(): QuizGenerationOutput {
  const mcqQuestions = Array.from({ length: 20 }, (_, index) => ({
    sort_order: index + 1,
    difficulty: (index < 8
      ? 'basic'
      : index < 15
        ? 'application'
        : 'analysis') as 'basic' | 'application' | 'analysis',
    prompt: `Synthetic question ${index + 1}: Which pattern prevents concurrent claim races?`,
    options: [
      { option_id: 'a', text: 'FOR UPDATE SKIP LOCKED' },
      { option_id: 'b', text: 'Unbounded SELECT *' },
      { option_id: 'c', text: 'Client-side sleep' },
      { option_id: 'd', text: 'Shared mutable global' },
    ],
    correct_option_id: 'a',
    explanation: 'FOR UPDATE SKIP LOCKED skips locked rows atomically.',
    allow_i_dont_know: true,
  }));

  const freeResponseQuestions = Array.from({ length: 5 }, (_, index) => ({
    sort_order: index + 1,
    difficulty: 'application' as const,
    prompt: `Free response ${index + 1}: Explain why lease expiry uses two-step state transitions.`,
    response_hint: 'design' as const,
    rubric: {
      correctness_criteria: ['Explains trigger invariant preparing -> failed'],
      understanding_criteria: ['Identifies attempt fence role'],
      reasoning_criteria: ['Connects retry backoff with bounded age'],
    },
    max_length: 2_000,
    allow_i_dont_know: true,
  }));

  return {
    is_reduced: false,
    mcq_questions: mcqQuestions,
    free_response_questions: freeResponseQuestions,
  };
}

function buildSyntheticPracticeReview(): PracticeReviewOutput {
  return {
    review_status: 'reviewed',
    performance_level: 'good',
    dimensions: {
      correctness: 'good',
      understanding: 'good',
      reasoning: 'partial',
    },
    strengths: ['Clearly identified atomic transaction boundary'],
    mistakes: [],
    weaknesses: ['Could mention fence loss abort behavior explicitly'],
    improvement_recommendations: [
      'Include heartbeat verification failure handling in your explanation.',
    ],
    evidence_eligible: true,
  };
}

function buildSyntheticMentorChat(language: UiLanguage): MentorChatOutput {
  const content =
    language === 'bn'
      ? 'আপনার বর্তমান রোডম্যাপ অনুযায়ী PostgreSQL লকিং ও কুইজ অনুশীলন চালিয়ে যান।'
      : language === 'mixed'
        ? 'আপনার roadmap-এর next step হিসেবে SKIP LOCKED queue pattern অনুশীলন করুন।'
        : 'Continue practicing the PostgreSQL queue pattern from your active roadmap phase.';
  return {
    content,
    language,
    safety_mode: false,
    learning_claim_recorded: false,
  };
}

function buildSyntheticTechnologyUpdate(): TechnologyUpdateOutput {
  return {
    has_meaningful_update: true,
    title: 'PostgreSQL 17 Performance Improvements',
    what_changed: 'Improved vacuum memory management and query planning.',
    why_it_matters: 'Reduces index bloat on high-churn queue tables.',
    publisher: 'PostgreSQL Release Team',
    source_url: 'https://www.postgresql.org/docs/release/',
    release_status: 'released',
    relevance: 'medium',
    action_timing: 'awareness_only',
    roadmap_relation: 'Relates to Backend Database Operations topic.',
    propose_roadmap_merge: false,
  };
}

export function buildSyntheticTaskOutput(
  task: AiTask,
  language: UiLanguage,
  userEnvelope = '',
): unknown {
  switch (task) {
    case 'goal_interpretation':
      return buildSyntheticGoalInterpretation(language, userEnvelope);
    case 'roadmap_generate':
    case 'roadmap_revision':
      return buildSyntheticRoadmap(language);
    case 'merge_proposal':
      return buildSyntheticMergeProposal();
    case 'topic_content':
      return buildSyntheticTopicContent(language);
    case 'quiz_generate':
      return buildSyntheticQuiz();
    case 'practice_review':
      return buildSyntheticPracticeReview();
    case 'mentor_chat':
      return buildSyntheticMentorChat(language);
    case 'technology_update':
      return buildSyntheticTechnologyUpdate();
  }
}

/**
 * Deterministic offline `ProviderAdapter` (`ADR-008`) supporting all 9 `public.ai_task` schemas
 * and programmable fault/timeout/invalid-schema simulations without live API keys.
 */
@Injectable()
export class SyntheticProviderAdapter implements ProviderAdapter {
  private readonly modelRules = new Map<string, SyntheticRuleOutcome>();

  setModelRule(modelIdOrIdentifier: string, rule: SyntheticRuleOutcome): void {
    this.modelRules.set(modelIdOrIdentifier, rule);
  }

  clearModelRules(): void {
    this.modelRules.clear();
  }

  async invoke(
    request: ProviderInvocationRequest,
  ): Promise<ProviderInvocationResult> {
    if (request.signal?.aborted) {
      throw new ProviderInvocationError(
        'timeout',
        'Provider request aborted',
        504,
      );
    }

    const rule =
      this.modelRules.get(request.model.id) ??
      this.modelRules.get(request.model.model_identifier) ??
      'ok';

    if (typeof rule === 'function') {
      return rule(request);
    }
    if (rule === 'timeout') {
      throw new ProviderInvocationError('timeout', 'Provider timed out', 504);
    }
    if (rule === 'provider_error') {
      throw new ProviderInvocationError(
        'provider_error',
        'Upstream provider error',
        502,
      );
    }
    if (rule === 'rate_limit') {
      throw new ProviderInvocationError(
        'rate_limit',
        'Upstream provider rate limited',
        429,
        30,
      );
    }
    if (rule === 'invalid_schema') {
      return {
        output: { malformed_synthetic_output: true },
        inputUnits: Math.max(
          10,
          Math.ceil(Buffer.byteLength(request.userEnvelope, 'utf8') / 4),
        ),
        outputUnits: 12,
        latencyMs: 15,
        sources: [],
      };
    }

    const output = buildSyntheticTaskOutput(
      request.task,
      request.language,
      request.userEnvelope,
    );
    const inputUnits = Math.max(
      10,
      Math.ceil(Buffer.byteLength(request.userEnvelope, 'utf8') / 4),
    );
    const outputUnits = Math.max(
      20,
      Math.ceil(Buffer.byteLength(JSON.stringify(output), 'utf8') / 4),
    );
    if (outputUnits > request.maxOutputUnits) {
      throw new ProviderInvocationError(
        'budget_exceeded',
        'Generated output exceeds max_output_units budget',
        503,
      );
    }
    return {
      output,
      inputUnits,
      outputUnits,
      latencyMs: 25,
      sources: [
        {
          publisher: 'Official Documentation',
          url: 'https://www.postgresql.org/docs/',
        },
      ],
    };
  }
}

/**
 * Fail-closed provider adapter bound when `AI_EXECUTION_MODE=real_user` and no live provider
 * adapter is configured, ensuring simulated synthetic output is never returned as real model output.
 */
export class UnconfiguredRealUserProviderAdapter implements ProviderAdapter {
  invoke(): Promise<ProviderInvocationResult> {
    return Promise.reject(
      new ProviderInvocationError(
        'policy_rejected',
        'No real-user AI provider adapter is configured',
        503,
      ),
    );
  }
}
