import { describe, it, expect } from "vitest";
import { ApiError, NetworkError, UnauthorizedError } from "@/lib/api/client";
import { mapActionResult, mapApiError, preserveInput, toActionFailure } from "@/lib/api/error-mapper";

describe("M05 curated error codes", () => {
  const cases: Array<[string, number, RegExp, string]> = [
    ["OUT_OF_SCOPE_GOAL", 422, /technology careers only/i, "warning"],
    ["CLARIFICATION_LIMIT_REACHED", 409, /clarification limit/i, "info"],
    ["GOAL_ALREADY_CONFIRMED", 409, /already confirmed/i, "warning"],
    ["ROLE_MISMATCH", 422, /not one of the proposed/i, "error"],
    ["ROADMAP_LIMIT_REACHED", 409, /3 active goals/i, "warning"],
    ["SKILL_NOT_FOUND", 404, /could not find that skill/i, "warning"],
    ["FEATURE_DISABLED", 403, /currently unavailable/i, "warning"],
    ["INVALID_STATE_TRANSITION", 409, /different step/i, "warning"],
    ["RESOURCE_NOT_FOUND", 404, /could not find that item/i, "warning"],
  ];

  it.each(cases)("maps %s (%i) to curated safe copy", (code, status, pattern, tone) => {
    const m = mapApiError(new ApiError(status, "RAW gpt-4 stack trace at db.ts:12", code, "req-1"));
    expect(m.message).toMatch(pattern);
    expect(m.message).not.toMatch(/gpt|stack|db\.ts/i);
    expect(m.tone).toBe(tone);
    expect(m.code).toBe(code);
    expect(m.status).toBe(status);
    expect(m.retryable).toBe(false);
  });

  it("keeps field errors for coded failures", () => {
    const m = mapApiError(
      new ApiError(422, "x", "ROLE_MISMATCH", undefined, [
        { field: "canonical_role_id", code: "ROLE_MISMATCH", message: "bad role" },
      ]),
    );
    expect(m.fieldErrors).toEqual({ canonical_role_id: "bad role" });
  });

  it("does not let prototype keys hijack the table", () => {
    const m = mapApiError(new ApiError(409, "plain", "constructor"));
    expect(m.message).toBe("plain");
  });

  it("toActionFailure returns a serializable UI-safe failure", () => {
    const failure = toActionFailure(new ApiError(422, "raw", "OUT_OF_SCOPE_GOAL"));
    expect(failure.ok).toBe(false);
    expect(JSON.parse(JSON.stringify(failure)).error.code).toBe("OUT_OF_SCOPE_GOAL");
    expect(toActionFailure(new NetworkError()).error.tone).toBe("warning");
  });
});

describe("mapApiError", () => {
  it("maps NetworkError to retryable warning", () => {
    const m = mapApiError(new NetworkError());
    expect(m.tone).toBe("warning");
    expect(m.status).toBeNull();
    expect(m.retryable).toBe(true);
  });

  it("maps unknown values to generic error", () => {
    expect(mapApiError("x").message).toMatch(/something went wrong/i);
  });

  it("maps 400/422 details to field errors", () => {
    const m = mapApiError(
      new ApiError(422, "bad", "VALIDATION", "r1", [
        { field: "email", code: "x", message: "Bad email" },
        { field: "email", code: "y", message: "dup ignored" },
        { field: "password", code: "z", message: "Too short" },
      ]),
    );
    expect(m.fieldErrors).toEqual({ email: "Bad email", password: "Too short" });
    expect(m.retryable).toBe(false);
    expect(m.message).toMatch(/highlighted/i);
    expect(mapApiError(new ApiError(400, "Check this")).message).toBe("Check this");
  });

  it("maps 401 and UnauthorizedError to sign-in", () => {
    expect(mapApiError(new ApiError(401, "x")).requiresSignIn).toBe(true);
    expect(
      mapApiError(
        new ApiError(
          401,
          "Invalid credentials. Please try again.",
          "AUTH_INVALID_CREDENTIALS",
        ),
      ).message,
    ).toBe("Please verify your credentials. The password entered is incorrect.");
    expect(mapApiError(new UnauthorizedError()).requiresSignIn).toBe(true);
    const missing401 = mapApiError(
      new ApiError(
        401,
        "No account found with this phone number.",
        "AUTH_REQUIRED",
      ),
    );
    expect(missing401.message).toBe("No account found with this phone number.");
    expect(missing401.requiresSignIn).toBe(false);
    expect(missing401.retryable).toBe(false);
  });

  it("maps 404 account errors without rewriting message", () => {
    const emailErr = mapApiError(
      new ApiError(
        404,
        "No account found with this email address.",
        "AUTH_USER_NOT_FOUND",
      ),
    );
    expect(emailErr.status).toBe(404);
    expect(emailErr.message).toBe("No account found with this email address.");
    expect(emailErr.retryable).toBe(false);

    const phoneErr = mapApiError(
      new ApiError(
        404,
        "No account found with this phone number.",
        "AUTH_USER_NOT_FOUND",
      ),
    );
    expect(phoneErr.status).toBe(404);
    expect(phoneErr.message).toBe("No account found with this phone number.");
    expect(phoneErr.retryable).toBe(false);
  });

  it("maps 403 and 409", () => {
    expect(mapApiError(new ApiError(403, "x")).message).toMatch(/permission/i);
    const c = mapApiError(new ApiError(409, "Account exists"));
    expect(c.message).toBe("Account exists");
    expect(c.tone).toBe("warning");

    const emailDup = mapApiError(
      new ApiError(409, "Contact already registered", "CONTACT_ALREADY_REGISTERED"),
      { channel: "email" },
    );
    expect(emailDup.message).toBe("This email is already registered.");
    expect(emailDup.tone).toBe("warning");

    const phoneDup = mapApiError(
      new ApiError(409, "Contact already registered", "CONTACT_ALREADY_REGISTERED"),
      { channel: "phone" },
    );
    expect(phoneDup.message).toBe("This phone number is already registered.");
    expect(phoneDup.tone).toBe("warning");
  });

  it("preserves retryAfterSeconds on 423/429", () => {
    const a = mapApiError(new ApiError(429, "x", "RATE_LIMITED", undefined, [], true, 42));
    expect(a.retryAfterSeconds).toBe(42);
    expect(a.tone).toBe("warning");
    expect(a.retryable).toBe(true);
    const b = mapApiError(new ApiError(423, "x", "LOCKED", undefined, [], false, 90));
    expect(b.retryAfterSeconds).toBe(90);
  });

  it("includes requestId on 5xx", () => {
    const m = mapApiError(new ApiError(503, "x", undefined, "req-9"));
    expect(m.requestId).toBe("req-9");
    expect(m.message).toContain("req-9");
    expect(mapApiError(new ApiError(500, "x")).message).not.toContain("Reference");
  });

  it("maps all 8 AI and Job error codes to safe copy without leaking provider/model internals", () => {
    const rawInternalLeak = "google-gemini gemini-2.5-pro secret stack trace";
    const cases: Array<{
      status: number;
      code: string;
      tone: "error" | "warning" | "info";
      retryable: boolean;
      match: RegExp;
    }> = [
      {
        status: 504,
        code: "AI_TIMEOUT",
        tone: "warning",
        retryable: true,
        match: /timed out.*saved/i,
      },
      {
        status: 502,
        code: "AI_SERVICE_ERROR",
        tone: "error",
        retryable: true,
        match: /temporarily unavailable.*saved/i,
      },
      {
        status: 502,
        code: "AI_GENERATION_FAILED",
        tone: "error",
        retryable: true,
        match: /couldn't generate.*saved/i,
      },
      {
        status: 502,
        code: "AI_VALIDATION_FAILED",
        tone: "error",
        retryable: true,
        match: /discarded.*saved/i,
      },
      {
        status: 503,
        code: "AI_BUDGET_EXHAUSTED",
        tone: "warning",
        retryable: true,
        match: /capacity.*existing roadmaps/i,
      },
      {
        status: 404,
        code: "JOB_NOT_FOUND",
        tone: "warning",
        retryable: false,
        match: /could not be found/i,
      },
      {
        status: 409,
        code: "IDEMPOTENCY_KEY_REUSED",
        tone: "warning",
        retryable: false,
        match: /already used/i,
      },
      {
        status: 409,
        code: "STALE_JOB_INPUT",
        tone: "warning",
        retryable: false,
        match: /saved data changed/i,
      },
    ];

    for (const c of cases) {
      const mapped = mapApiError(
        new ApiError(c.status, rawInternalLeak, c.code, "req-ai-1"),
      );
      expect(mapped.code).toBe(c.code);
      expect(mapped.tone).toBe(c.tone);
      expect(mapped.retryable).toBe(c.retryable);
      expect(mapped.requestId).toBe("req-ai-1");
      expect(mapped.message).toMatch(c.match);
      expect(mapped.message).not.toContain("gemini");
      expect(mapped.message).not.toContain("stack trace");
    }
  });

  it("maps all M06 roadmap lifecycle error codes cleanly with zero internal leaks", () => {
    const rawInternalLeak = "google-gemini internal postgres detail stack trace";
    const cases: Array<{
      status: number;
      code: string;
      tone: "error" | "warning" | "info";
      retryable: boolean;
      retryAfterSeconds?: number | null;
      match: RegExp;
    }> = [
      {
        status: 409,
        code: "DRAFT_STALE",
        tone: "warning",
        retryable: false,
        match: /refresh.*draft.*locking/i,
      },
      {
        status: 409,
        code: "STALE_VERSION",
        tone: "warning",
        retryable: false,
        match: /newer version.*reload/i,
      },
      {
        status: 422,
        code: "LARGE_ROADMAP_CONFIRMATION_REQUIRED",
        tone: "warning",
        retryable: false,
        match: /45.*confirm/i,
      },
      {
        status: 409,
        code: "RESOURCE_CONFLICT",
        tone: "warning",
        retryable: false,
        match: /already exists.*career goal/i,
      },
      {
        status: 409,
        code: "ROADMAP_LIMIT_REACHED",
        tone: "warning",
        retryable: false,
        match: /maximum of 3/i,
      },
      {
        status: 409,
        code: "INVALID_STATE_TRANSITION",
        tone: "warning",
        retryable: false,
        match: /not allowed.*current state/i,
      },
      {
        status: 409,
        code: "STALE_JOB_INPUT",
        tone: "warning",
        retryable: false,
        match: /saved data changed/i,
      },
      {
        status: 404,
        code: "RESOURCE_NOT_FOUND",
        tone: "warning",
        retryable: false,
        match: /could not be found/i,
      },
      {
        status: 403,
        code: "FEATURE_DISABLED",
        tone: "warning",
        retryable: false,
        match: /currently unavailable.*existing.*roadmaps/i,
      },
      {
        status: 429,
        code: "RATE_LIMIT_EXCEEDED",
        tone: "warning",
        retryable: true,
        retryAfterSeconds: 180,
        match: /limit reached.*wait/i,
      },
    ];

    for (const c of cases) {
      const mapped = mapApiError(
        new ApiError(
          c.status,
          rawInternalLeak,
          c.code,
          "req-r-1",
          [],
          c.retryable,
          c.retryAfterSeconds ?? null,
        ),
      );
      expect(mapped.code).toBe(c.code);
      expect(mapped.status).toBe(c.status);
      expect(mapped.tone).toBe(c.tone);
      expect(mapped.retryable).toBe(c.retryable);
      expect(mapped.retryAfterSeconds).toBe(c.retryAfterSeconds ?? null);
      expect(mapped.message).toMatch(c.match);
      expect(mapped.message).not.toContain("gemini");
      expect(mapped.message).not.toContain("postgres");
      expect(mapped.message).not.toContain("stack trace");
    }
  });

  it("maps all M07 learning error codes cleanly with zero internal leaks", () => {
    const rawInternalLeak = "google-gemini internal postgres detail stack trace";
    const cases: Array<{
      status: number;
      code: string;
      tone: "error" | "warning" | "info";
      match: RegExp;
    }> = [
      {
        status: 404,
        code: "DAILY_PLAN_NOT_FOUND",
        tone: "info",
        match: /no daily plan exists/i,
      },
      {
        status: 404,
        code: "NO_FOCUS_ROADMAP",
        tone: "info",
        match: /no focus roadmap.*selected/i,
      },
      {
        status: 409,
        code: "DAILY_PLAN_EXISTS",
        tone: "warning",
        match: /already exists.*rebuild/i,
      },
      {
        status: 422,
        code: "LEARNING_HOURS_REQUIRED",
        tone: "warning",
        match: /0\.5.*12.*0\.5/i,
      },
      {
        status: 409,
        code: "ROADMAP_NOT_LOCKED",
        tone: "warning",
        match: /roadmap must be locked/i,
      },
      {
        status: 409,
        code: "ROADMAP_ARCHIVED",
        tone: "warning",
        match: /archived.*read-only/i,
      },
    ];

    for (const c of cases) {
      const mapped = mapApiError(
        new ApiError(c.status, rawInternalLeak, c.code, "req-l-1"),
      );
      expect(mapped.code).toBe(c.code);
      expect(mapped.status).toBe(c.status);
      expect(mapped.tone).toBe(c.tone);
      expect(mapped.retryable).toBe(false);
      expect(mapped.message).toMatch(c.match);
      expect(mapped.message).not.toContain("gemini");
      expect(mapped.message).not.toContain("postgres");
      expect(mapped.message).not.toContain("stack trace");
    }
  });

  it("maps all 10 M08 quiz and practice-review error codes cleanly with zero internal leaks", () => {
    const rawInternalLeak = "google-gemini internal postgres detail stack trace";
    const cases: Array<{
      status: number;
      code: string;
      tone: "error" | "warning" | "info";
      match: RegExp;
    }> = [
      {
        status: 409,
        code: "PLAN_ITEM_NOT_AVAILABLE",
        tone: "warning",
        match: /not ready for a practice quiz/i,
      },
      {
        status: 409,
        code: "QUIZ_NOT_STARTED",
        tone: "warning",
        match: /start the practice quiz before/i,
      },
      {
        status: 409,
        code: "QUIZ_NOT_SUBMITTED",
        tone: "info",
        match: /submit this practice quiz first/i,
      },
      {
        status: 409,
        code: "QUIZ_ALREADY_SUBMITTED",
        tone: "info",
        match: /already been submitted/i,
      },
      {
        status: 422,
        code: "NO_ANSWERS_SUBMITTED",
        tone: "warning",
        match: /answer at least one question/i,
      },
      {
        status: 422,
        code: "UNANSWERED_CONFIRMATION_REQUIRED",
        tone: "warning",
        match: /some questions are still unanswered/i,
      },
      {
        status: 422,
        code: "QUESTION_NOT_IN_QUIZ",
        tone: "warning",
        match: /did not match this quiz attempt/i,
      },
      {
        status: 409,
        code: "RETRY_LIMIT_REACHED",
        tone: "info",
        match: /single retry permitted/i,
      },
      {
        status: 409,
        code: "REVIEW_NOT_RETRYABLE",
        tone: "info",
        match: /non-attempt and cannot be retried/i,
      },
      {
        status: 410,
        code: "RAW_RESPONSE_EXPIRED",
        tone: "info",
        match: /90-day privacy retention policy/i,
      },
    ];

    for (const c of cases) {
      const mapped = mapApiError(
        new ApiError(c.status, rawInternalLeak, c.code, "req-q-1"),
      );
      expect(mapped.code).toBe(c.code);
      expect(mapped.status).toBe(c.status);
      expect(mapped.tone).toBe(c.tone);
      expect(mapped.retryable).toBe(false);
      expect(mapped.message).toMatch(c.match);
      expect(mapped.message).not.toContain("gemini");
      expect(mapped.message).not.toContain("postgres");
      expect(mapped.message).not.toContain("stack trace");
    }
  });

  it("maps M09 merge, level-change, and undo error codes cleanly with zero internal leaks", () => {
    const rawInternalLeak = "google-gemini internal postgres detail stack trace";
    const cases: Array<{
      status: number;
      code: string;
      tone: "error" | "warning" | "info";
      match: RegExp;
    }> = [
      {
        status: 409,
        code: "MERGE_ALREADY_PROPOSED",
        tone: "warning",
        match: /merge proposal is already open/i,
      },
      {
        status: 409,
        code: "MERGE_NOT_PENDING",
        tone: "warning",
        match: /no longer pending/i,
      },
      {
        status: 409,
        code: "MERGE_EXPANSION_ACK_REQUIRED",
        tone: "warning",
        match: /above the recommended topic limit.*acknowledgement/i,
      },
      {
        status: 422,
        code: "LEVEL_UNCHANGED",
        tone: "warning",
        match: /different.*target level/i,
      },
      {
        status: 409,
        code: "UNDO_NOT_AVAILABLE",
        tone: "info",
        match: /undo is no longer available/i,
      },
      {
        status: 409,
        code: "STALE_VERSION",
        tone: "warning",
        match: /newer version/i,
      },
      {
        status: 409,
        code: "ROADMAP_NOT_LOCKED",
        tone: "warning",
        match: /roadmap must be locked/i,
      },
      {
        status: 409,
        code: "ROADMAP_ARCHIVED",
        tone: "warning",
        match: /archived.*read-only/i,
      },
    ];

    for (const c of cases) {
      const mapped = mapApiError(
        new ApiError(c.status, rawInternalLeak, c.code, "req-m9-1"),
      );
      expect(mapped.code).toBe(c.code);
      expect(mapped.status).toBe(c.status);
      expect(mapped.tone).toBe(c.tone);
      expect(mapped.retryable).toBe(false);
      expect(mapped.message).toMatch(c.match);
      expect(mapped.message).not.toContain("gemini");
      expect(mapped.message).not.toContain("postgres");
      expect(mapped.message).not.toContain("stack trace");
    }
  });

  it("maps M10 mentor error codes cleanly with context-aware FEATURE_DISABLED copy", () => {
    const rawInternalLeak = "google-gemini internal postgres detail stack trace";

    const notFound = mapApiError(
      new ApiError(404, rawInternalLeak, "CONVERSATION_NOT_FOUND", "req-m10-1"),
      { feature: "mentor" },
    );
    expect(notFound.code).toBe("CONVERSATION_NOT_FOUND");
    expect(notFound.status).toBe(404);
    expect(notFound.tone).toBe("warning");
    expect(notFound.retryable).toBe(false);
    expect(notFound.message).toMatch(/conversation could not be found/i);
    expect(notFound.message).not.toMatch(/gemini|postgres|stack trace/i);

    const unsupportedLang = mapApiError(
      new ApiError(422, rawInternalLeak, "UNSUPPORTED_LANGUAGE", "req-m10-2"),
      { feature: "mentor" },
    );
    expect(unsupportedLang.code).toBe("UNSUPPORTED_LANGUAGE");
    expect(unsupportedLang.status).toBe(422);
    expect(unsupportedLang.tone).toBe("warning");
    expect(unsupportedLang.retryable).toBe(false);
    expect(unsupportedLang.message).toMatch(/Bangla.*English.*Mixed/i);

    const mentorDisabled = mapApiError(
      new ApiError(403, rawInternalLeak, "FEATURE_DISABLED", "req-m10-3"),
      { feature: "mentor" },
    );
    expect(mentorDisabled.code).toBe("FEATURE_DISABLED");
    expect(mentorDisabled.status).toBe(403);
    expect(mentorDisabled.tone).toBe("info");
    expect(mentorDisabled.retryable).toBe(false);
    expect(mentorDisabled.message).toMatch(/AI Mentor.*90-day/i);
    expect(mentorDisabled.message).not.toMatch(/roadmaps and progress/i);
  });

  it("maps M11 technology_update FEATURE_DISABLED and RESOURCE_NOT_FOUND cleanly without roadmap/mentor copy", () => {
    const rawInternalLeak = "google-gemini internal postgres detail stack trace";

    const techDisabled = mapApiError(
      new ApiError(403, rawInternalLeak, "FEATURE_DISABLED", "req-m11-1"),
      { feature: "technology_update" },
    );
    expect(techDisabled.code).toBe("FEATURE_DISABLED");
    expect(techDisabled.status).toBe(403);
    expect(techDisabled.tone).toBe("info");
    expect(techDisabled.retryable).toBe(false);
    expect(techDisabled.message).toMatch(
      /Daily Technology Updates are currently turned off/i,
    );
    expect(techDisabled.message).not.toMatch(/roadmap|mentor/i);

    const techNotFound = mapApiError(
      new ApiError(404, rawInternalLeak, "RESOURCE_NOT_FOUND", "req-m11-2"),
      { feature: "technology_update" },
    );
    expect(techNotFound.code).toBe("RESOURCE_NOT_FOUND");
    expect(techNotFound.status).toBe(404);
    expect(techNotFound.tone).toBe("warning");
    expect(techNotFound.retryable).toBe(false);
    expect(techNotFound.message).toMatch(/technology update could not be found/i);
  });
});

describe("mapActionResult", () => {
  it("returns null without error", () => {
    expect(mapActionResult({})).toBeNull();
    expect(mapActionResult(null)).toBeNull();
  });
  it("keeps server copy and carries metadata", () => {
    const m = mapActionResult({ error: "Wait", status: 429, retryAfterSeconds: 30, fieldErrors: { a: "b" } })!;
    expect(m.message).toBe("Wait");
    expect(m.retryAfterSeconds).toBe(30);
    expect(m.tone).toBe("warning");
    expect(m.fieldErrors).toEqual({ a: "b" });
  });
  it("defaults to error tone without status", () => {
    const m = mapActionResult({ error: "Nope" })!;
    expect(m.tone).toBe("error");
    expect(m.status).toBeNull();
  });
  it("flags 401", () => {
    expect(mapActionResult({ error: "x", status: 401 })!.requiresSignIn).toBe(true);
  });
});

describe("preserveInput", () => {
  it("returns values untouched", () => {
    const v = { email: "a@b.com", password: "secret" };
    expect(preserveInput(v, mapApiError(new ApiError(500, "x")))).toBe(v);
  });
});
