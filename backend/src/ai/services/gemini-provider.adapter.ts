import { Logger } from '@nestjs/common';
import {
  ApiError,
  GoogleGenAI,
  ThinkingLevel,
  type ThinkingConfig,
} from '@google/genai';
import type { AiTask, UiLanguage } from '../ai.types.js';
import {
  ProviderInvocationError,
  type ProviderAdapter,
  type ProviderInvocationRequest,
  type ProviderInvocationResult,
} from './provider.adapter.js';

export interface GeminiProviderAdapterOptions {
  apiKey: string;
  defaultTimeoutMs?: number;
}

const DEFAULT_GEMINI_TIMEOUT_MS = 30_000;
const FAST_JSON_TASKS: ReadonlySet<AiTask> = new Set([
  'goal_interpretation',
  'mentor_chat',
  'practice_review',
  'technology_update',
  'merge_proposal',
]);

function buildFastTaskThinkingConfig(modelIdentifier: string): ThinkingConfig {
  // Flash-Lite models support MINIMAL thinking; full Flash models (e.g. gemini-3.8-flash) use LOW.
  if (/flash-lite/i.test(modelIdentifier)) {
    return { thinkingLevel: ThinkingLevel.MINIMAL };
  }
  return { thinkingLevel: ThinkingLevel.LOW };
}

const TASK_JSON_CONTRACTS: Readonly<Record<AiTask, string>> = {
  goal_interpretation: [
    'Return ONLY a valid JSON object matching this exact schema:',
    '{',
    '  "isTechnologyGoal": boolean,',
    '  "clarificationNeeded": boolean,',
    '  "clarificationRound": 0 | 1 | 2,',
    '  "clarificationQuestion": string | null,',
    '  "proposedRole": { "canonicalRoleId": string, "name": string } | null,',
    '  "alternativeRoles": [{ "canonicalRoleId": string, "name": string, "matchReason": string }],',
    '  "suggestedLevel": "junior" | "mid" | "senior" | null',
    '}',
    'Set "isTechnologyGoal": true for ALL software, web, mobile, data (including Data Analyst, Data Analytics, Business Intelligence / BI, Data Scientist, and Data Engineer), AI, ML, LLM, cloud, DevOps, SRE, QA, software testing, and cybersecurity career goals.',
    'Set "isTechnologyGoal": false ONLY for clearly non-technology professions (e.g., chef, doctor, lawyer, fashion designer, accountant).',
    'When a valid, clear technology role target (such as "Data analyst", "Data analytics", or "Data scientist") does not have a verbatim title in approved_roles, NEVER set "isTechnologyGoal": false. Instead, keep "isTechnologyGoal": true, set "clarificationNeeded": false, and map "proposedRole" to the closest approved canonical role in approved_roles (for "Data analyst" / "Data analytics" / "Data scientist", propose "Data Engineering" when present in approved_roles, and include ONLY those named alternatives such as "AI / Machine Learning Engineering" and "Backend Development" that are also present in approved_roles — include both when both are approved, and never require or invent an unapproved role).',
    'When the user names only a broad technology field without a specific role (for example, "I want to work in software" or "tech career"), keep "isTechnologyGoal": true, set "clarificationNeeded": true, set "proposedRole": null, and ask a concise "clarificationQuestion" to narrow down their target specialization.',
    'Use ONLY canonicalRoleId and name values from approved_roles in the user context envelope. Never invent role IDs.',
  ].join('\n'),
  roadmap_generate: [
    'Return ONLY a valid JSON object matching this exact schema:',
    '{',
    '  "targetLevel": "junior" | "mid" | "senior",',
    '  "summary": { "current_situation": string, "target_interpretation": string, "expected_career_impact": string, "next_steps": string[] },',
    '  "phases": [{',
    '    "phase_no": number,',
    '    "title": string,',
    '    "milestones": [{ "id": string, "title": string }],',
    '    "items": [{',
    '      "lineage_id": "UUID",',
    '      "topic_id": string,',
    '      "skill_id": string,',
    '      "title": string,',
    '      "priority": "core" | "supporting" | "optional",',
    '      "gap_type": "existing" | "transferable" | "refresh" | "strengthen" | "missing",',
    '      "required_depth": string,',
    '      "estimated_effort_hours": number,',
    '      "sequence_no": number,',
    '      "depends_on_lineage_ids": ["UUID"],',
    '      "reason": string,',
    '      "sources": [{ "publisher": string, "url": "https://..." }]',
    '    }]',
    '  }],',
    '  "level_outline": [{ "career_level": "junior" | "mid" | "senior", "outline": string[] }],',
    '  "warnings": string[],',
    '  "size_guardrail": { "active_topic_count": number, "materially_large": boolean, "warning": string | null }',
    '}',
    'Dependencies must form an acyclic DAG using valid UUID lineage_id strings.',
    'Use ONLY valid UUID id values from approved_skills in the user context envelope for skill_id. Never invent skill IDs.',
  ].join('\n'),
  roadmap_revision: [
    'Return ONLY a valid JSON object matching the roadmap schema:',
    '{',
    '  "targetLevel": "junior" | "mid" | "senior",',
    '  "summary": { "current_situation": string, "target_interpretation": string, "expected_career_impact": string, "next_steps": string[] },',
    '  "phases": [{ "phase_no": number, "title": string, "milestones": [{ "id": string, "title": string }], "items": [{ "lineage_id": "UUID", "topic_id": string, "skill_id": string, "title": string, "priority": "core" | "supporting" | "optional", "gap_type": "existing" | "transferable" | "refresh" | "strengthen" | "missing", "required_depth": string, "estimated_effort_hours": number, "sequence_no": number, "depends_on_lineage_ids": ["UUID"], "reason": string, "sources": [{ "publisher": string, "url": "https://..." }] }] }],',
    '  "level_outline": [{ "career_level": "junior" | "mid" | "senior", "outline": string[] }],',
    '  "warnings": string[],',
    '  "size_guardrail": { "active_topic_count": number, "materially_large": boolean, "warning": string | null }',
    '}',
    'Dependencies must form an acyclic DAG using valid UUID lineage_id strings.',
    'Use ONLY valid UUID id values from approved_skills in the user context envelope for skill_id. Never invent skill IDs.',
  ].join('\n'),
  merge_proposal: [
    'Return ONLY a valid JSON object matching this exact schema:',
    '{',
    '  "reason": string,',
    '  "target_level": "junior" | "mid" | "senior" | null,',
    '  "operations": [{',
    '    "sort_order": number,',
    '    "op": "add_topic" | "update_topic" | "reprioritize" | "reclassify" | "retire_topic",',
    '    "topic_id": string | null,',
    '    "lineage_id": string | null,',
    '    "title": string | null,',
    '    "priority": "core" | "supporting" | "optional" | null,',
    '    "reason": string,',
    '    "payload": object',
    '  }],',
    '  "size_impact": { "active_topics_before": number, "active_topics_after": number, "materially_large": boolean, "warning": string | null }',
    '}',
    'Include at least one operation in "operations" with 1-based integer "sort_order" values.',
    'Set "target_level" to roadmap.requested_target_level when roadmap.origin is "level_change", or null when roadmap.origin is "user_request".',
    'For "op": "add_topic": set "lineage_id": null, set "topic_id" to a non-empty lowercase kebab-case slug (e.g. "distributed-data-pipelines"), provide a concise non-empty "title", "priority" ("core" | "supporting" | "optional"), "reason", and "payload" object with { "skill_id": "<UUID from approved_skills>", "phase_no": <positive integer>, "gap_type": "existing"|"transferable"|"refresh"|"strengthen"|"missing", "estimated_effort_hours": <number>, "depends_on_lineage_ids": ["<existing UUID from roadmap.active_items>"], "required_depth": string }.',
    'For "update_topic", "reprioritize", "reclassify", or "retire_topic": "lineage_id" MUST be an exact existing UUID from roadmap.active_items[].lineage_id, "topic_id" MUST be null, and "payload" MUST be a JSON object ({} if no extra fields). Never invent lineage_id UUIDs.',
    'For "reprioritize", provide a non-null "priority". For "reclassify", include "gap_type" in "payload" (and/or "priority").',
    'Never retire every active item in roadmap.active_items, and ensure depends_on_lineage_ids remain an acyclic DAG.',
    'Use ONLY valid UUID id values from approved_skills in the user context envelope for payload.skill_id. Never invent skill IDs.',
  ].join('\n'),
  topic_content: [
    'Return ONLY a valid JSON object matching this exact schema:',
    '{',
    '  "explanation_markdown": string,',
    '  "language": "bn" | "en" | "mixed",',
    '  "important_questions": [{ "question": string, "answer_markdown": string }],',
    '  "sources": [{ "title": string, "publisher": string, "url": "https://...", "resource_type": "official_docs" | "release_notes" | "article" | "standard" | "video" | "other" }]',
    '}',
  ].join('\n'),
  quiz_generate: [
    'Return ONLY a valid JSON object matching this exact schema:',
    '{',
    '  "is_reduced": boolean,',
    '  "mcq_questions": [{ "sort_order": number, "difficulty": "basic" | "application" | "analysis", "prompt": string, "options": [{ "option_id": string, "text": string }], "correct_option_id": string, "explanation": string, "allow_i_dont_know": boolean }],',
    '  "free_response_questions": [{ "sort_order": number, "difficulty": "basic" | "application" | "analysis", "prompt": string, "response_hint": "sql" | "code" | "config" | "test_case" | "debug" | "command" | "design" | "text", "allow_i_dont_know": boolean, "max_length": number, "rubric": { "correctness_criteria": string[], "understanding_criteria": string[], "reasoning_criteria": string[] } }]',
    '}',
    'When is_reduced is false, include exactly 20 mcq_questions and 5 to 10 free_response_questions.',
  ].join('\n'),
  practice_review: [
    'Return ONLY a valid JSON object matching this exact schema:',
    '{',
    '  "review_status": "reviewed" | "not_evidence",',
    '  "evidence_eligible": boolean,',
    '  "performance_level": "good" | "needs_work" | null,',
    '  "dimensions": { "correctness": "good" | "partial" | "weak", "understanding": "good" | "partial" | "weak", "reasoning": "good" | "partial" | "weak" } | null,',
    '  "strengths": string[],',
    '  "mistakes": string[],',
    '  "weaknesses": string[],',
    '  "improvement_recommendations": string[]',
    '}',
  ].join('\n'),
  mentor_chat: [
    'Return ONLY a valid JSON object matching this exact schema:',
    '{',
    '  "content": string,',
    '  "language": "bn" | "en" | "mixed",',
    '  "safety_mode": boolean,',
    '  "learning_claim_recorded": boolean',
    '}',
    'Never promise job placement or use phrases like "job-ready" or "100% placement".',
  ].join('\n'),
  technology_update: [
    'Return ONLY a valid JSON object matching this exact schema:',
    '{',
    '  "has_meaningful_update": boolean,',
    '  "propose_roadmap_merge": boolean,',
    '  "title": string | null,',
    '  "what_changed": string | null,',
    '  "why_it_matters": string | null,',
    '  "publisher": string | null,',
    '  "source_url": "https://..." | null,',
    '  "release_status": "released" | "announced" | "planned" | "experimental" | null,',
    '  "relevance": "high" | "medium" | "low" | null,',
    '  "action_timing": "act_now" | "learn_later" | "awareness_only" | null,',
    '  "roadmap_relation": string | null',
    '}',
  ].join('\n'),
};

function languageDirective(language: UiLanguage): string {
  switch (language) {
    case 'bn':
      return 'Write user-facing prose fields in natural Bengali (bn). Keep JSON keys and enum values in exact English.';
    case 'mixed':
      return 'Write user-facing prose fields in natural Bangla-English mixed style (mixed). Keep JSON keys and enum values in exact English.';
    case 'en':
    default:
      return 'Write user-facing prose fields in clear English (en). Keep JSON keys and enum values in exact English.';
  }
}

function buildSystemInstruction(request: ProviderInvocationRequest): string {
  return [
    request.systemPrompt.trim(),
    `Output schema ID: ${request.outputSchemaId}.`,
    languageDirective(request.language),
    TASK_JSON_CONTRACTS[request.task],
    'Output strictly raw JSON with no markdown code fences or surrounding commentary.',
  ].join('\n\n');
}

/**
 * Strips leading/trailing markdown code fences defensively if a model wraps JSON output.
 */
export function stripMarkdownJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i.exec(trimmed);
  return (fenced ? fenced[1] : trimmed).trim();
}

function extractHttpStatus(error: unknown): number | undefined {
  if (error instanceof ApiError && Number.isInteger(error.status)) {
    return error.status;
  }
  if (error && typeof error === 'object') {
    const rec = error as Record<string, unknown>;
    if (typeof rec.status === 'number' && Number.isInteger(rec.status)) {
      return rec.status;
    }
    if (
      typeof rec.statusCode === 'number' &&
      Number.isInteger(rec.statusCode)
    ) {
      return rec.statusCode;
    }
    if (
      rec.error &&
      typeof rec.error === 'object' &&
      typeof (rec.error as Record<string, unknown>).code === 'number'
    ) {
      return (rec.error as Record<string, unknown>).code as number;
    }
  }
  return undefined;
}

function extractErrorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`;
  }
  if (error && typeof error === 'object') {
    const rec = error as Record<string, unknown>;
    const parts = [rec.name, rec.code, rec.status, rec.message].filter(
      (v) => typeof v === 'string' || typeof v === 'number',
    );
    return parts.join(' ');
  }
  return '';
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return true;
    }
    if (/\b(aborted|timed?\s*out|deadline_exceeded)\b/i.test(error.message)) {
      return true;
    }
  }
  return false;
}

function mapGeminiError(
  error: unknown,
  timedOut: boolean,
): ProviderInvocationError {
  if (error instanceof ProviderInvocationError) {
    return error;
  }
  if (timedOut || isAbortError(error)) {
    return new ProviderInvocationError(
      'timeout',
      'Gemini provider request timed out',
      504,
    );
  }

  const status = extractHttpStatus(error);
  const text = extractErrorText(error);

  if (status === 429 || /RESOURCE_EXHAUSTED|RATE_LIMIT/i.test(text)) {
    return new ProviderInvocationError(
      'rate_limit',
      'Gemini provider rate limit reached',
      429,
    );
  }

  if (status === 503 || /\bUNAVAILABLE\b|OVERLOADED/i.test(text)) {
    return new ProviderInvocationError(
      'rate_limit',
      'Gemini provider temporarily unavailable',
      503,
    );
  }

  if (
    status === 401 ||
    status === 403 ||
    /UNAUTHENTICATED|PERMISSION_DENIED/i.test(text)
  ) {
    return new ProviderInvocationError(
      'provider_error',
      'Gemini provider authentication failed',
      status ?? 401,
    );
  }

  if (status === 408 || status === 504 || /DEADLINE_EXCEEDED/i.test(text)) {
    return new ProviderInvocationError(
      'timeout',
      'Gemini provider request timed out',
      504,
    );
  }

  return new ProviderInvocationError(
    'provider_error',
    'Gemini provider invocation failed',
    status ?? 502,
  );
}

/**
 * Real-user Google Gemini provider adapter powered by the official `@google/genai` SDK.
 *
 * Enforces structured JSON output, bounded timeouts, token usage accounting, and
 * sanitized free-tier error mapping so `AiGatewayService` can fail over across ranked
 * free-tier models (`gemini-3.8-flash` -> `gemini-3.5-flash-lite` -> `gemini-3.1-flash-lite`).
 */
export class GeminiProviderAdapter implements ProviderAdapter {
  private readonly logger = new Logger(GeminiProviderAdapter.name);
  private readonly client: GoogleGenAI;
  private readonly defaultTimeoutMs: number;

  constructor(options: GeminiProviderAdapterOptions) {
    const trimmedKey = options.apiKey.trim();
    if (!trimmedKey) {
      throw new Error('GeminiProviderAdapter requires a non-empty API key');
    }
    this.defaultTimeoutMs =
      typeof options.defaultTimeoutMs === 'number' &&
      Number.isInteger(options.defaultTimeoutMs) &&
      options.defaultTimeoutMs > 0
        ? options.defaultTimeoutMs
        : DEFAULT_GEMINI_TIMEOUT_MS;
    this.client = new GoogleGenAI({ apiKey: trimmedKey });
  }

  async invoke(
    request: ProviderInvocationRequest,
  ): Promise<ProviderInvocationResult> {
    if (request.mode === 'synthetic') {
      throw new ProviderInvocationError(
        'policy_rejected',
        'Gemini provider adapter cannot serve synthetic requests',
        503,
      );
    }

    const startMs = Date.now();
    const effectiveTimeoutMs =
      Number.isFinite(request.timeoutMs) && request.timeoutMs > 0
        ? Math.min(request.timeoutMs, this.defaultTimeoutMs)
        : this.defaultTimeoutMs;

    const systemInstruction = buildSystemInstruction(request);
    const controller = new AbortController();
    let timedOut = false;

    const onExternalAbort = (): void => {
      controller.abort();
    };
    if (request.signal) {
      if (request.signal.aborted) {
        throw new ProviderInvocationError(
          'timeout',
          'Gemini provider request aborted',
          504,
        );
      }
      request.signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(
          new ProviderInvocationError(
            'timeout',
            'Gemini provider request timed out',
            504,
          ),
        );
      }, effectiveTimeoutMs);
    });

    try {
      const response = await Promise.race([
        this.client.models.generateContent({
          model: request.model.model_identifier,
          contents: request.userEnvelope,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            maxOutputTokens: request.maxOutputUnits,
            automaticContinuation: false,
            ...(FAST_JSON_TASKS.has(request.task)
              ? {
                  thinkingConfig: buildFastTaskThinkingConfig(
                    request.model.model_identifier,
                  ),
                }
              : {}),
            abortSignal: controller.signal,
          },
        }),
        timeoutPromise,
      ]);

      const rawText = typeof response.text === 'string' ? response.text : '';
      const cleaned = stripMarkdownJsonFences(rawText);
      if (!cleaned) {
        throw new ProviderInvocationError(
          'provider_error',
          'Gemini provider returned empty response',
          502,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned) as unknown;
      } catch {
        throw new ProviderInvocationError(
          'provider_error',
          'Gemini provider returned malformed JSON',
          502,
        );
      }

      const promptTokens = response.usageMetadata?.promptTokenCount;
      const candidateTokens = response.usageMetadata?.candidatesTokenCount;
      const thoughtTokens = response.usageMetadata?.thoughtsTokenCount;

      const inputUnits =
        typeof promptTokens === 'number' &&
        Number.isFinite(promptTokens) &&
        promptTokens >= 0
          ? Math.trunc(promptTokens)
          : Math.max(
              1,
              Math.ceil(
                (systemInstruction.length + request.userEnvelope.length) / 4,
              ),
            );

      const validThoughtTokens =
        typeof thoughtTokens === 'number' &&
        Number.isFinite(thoughtTokens) &&
        thoughtTokens >= 0
          ? Math.trunc(thoughtTokens)
          : 0;

      const outputUnits =
        typeof candidateTokens === 'number' &&
        Number.isFinite(candidateTokens) &&
        candidateTokens >= 0
          ? Math.trunc(candidateTokens) + validThoughtTokens
          : Math.max(1, Math.ceil(cleaned.length / 4)) + validThoughtTokens;

      return {
        output: parsed,
        inputUnits,
        outputUnits,
        latencyMs: Math.max(1, Date.now() - startMs),
      };
    } catch (error) {
      const mapped = mapGeminiError(error, timedOut);
      const latencyMs = Math.max(1, Date.now() - startMs);
      this.logger.warn(
        `Gemini candidate failed model=${request.model.model_identifier} task=${request.task} latencyMs=${latencyMs} kind=${mapped.kind} status=${mapped.statusCode ?? 'unknown'}`,
      );
      throw mapped;
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      if (request.signal) {
        request.signal.removeEventListener('abort', onExternalAbort);
      }
    }
  }
}
