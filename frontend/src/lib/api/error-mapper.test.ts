import { describe, it, expect } from "vitest";
import { ApiError, NetworkError, UnauthorizedError } from "@/lib/api/client";
import { mapActionResult, mapApiError, preserveInput } from "@/lib/api/error-mapper";

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
    expect(mapApiError(new UnauthorizedError()).requiresSignIn).toBe(true);
  });

  it("maps 403 and 409", () => {
    expect(mapApiError(new ApiError(403, "x")).message).toMatch(/permission/i);
    const c = mapApiError(new ApiError(409, "Account exists"));
    expect(c.message).toBe("Account exists");
    expect(c.tone).toBe("warning");
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
