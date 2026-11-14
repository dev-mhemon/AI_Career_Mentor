import { describe, it, expect } from "vitest";
import {
  detectIdentifier,
  normalizeBdPhone,
  normalizeEmail,
  passwordStrength,
  sanitizeBdPhoneDisplay,
  validateBdPhone,
  validateBdPhoneLive,
  validateBdPhoneOnChange,
  validateEmail,
  validateEmailLive,
  validateGoal,
  validateIdentifier,
  validateIdentifierOnChange,
  validateLoginPassword,
  validateOtp,
  validateOtpLive,
  validatePassword,
  validatePasswordLive,
  validatePasswordMatch,
} from "@/lib/validation/auth-schemas";

describe("email", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  A@B.Com ")).toBe("a@b.com");
    expect(validateEmail("  User@Example.COM ")).toEqual({ ok: true, value: "user@example.com" });
    expect(validateEmail("o'connor@example.com")).toEqual({ ok: true, value: "o'connor@example.com" });
  });
  it.each(["", "a", "a@b", "a@@b.com", "a b@c.com", "a..b@c.com", "a@b..com"])("rejects %j", (v) => {
    expect(validateEmail(v).ok).toBe(false);
  });
});

describe("BD phone", () => {
  it.each([
    ["01712345678", "+8801712345678"],
    ["1712345678", "+8801712345678"],
    ["1712-345678", "+8801712345678"],
    ["(017) 1234-5678", "+8801712345678"],
    ["8801712345678", "+8801712345678"],
    ["+8801712345678", "+8801712345678"],
    ["+880 1712-345678", "+8801712345678"],
    ["01312345678", "+8801312345678"],
    ["1312345678", "+8801312345678"],
    ["01912345678", "+8801912345678"],
  ])("normalizes %s", (input, out) => {
    expect(normalizeBdPhone(input)).toBe(out);
    expect(validateBdPhone(input)).toEqual({ ok: true, value: out });
  });
  it.each([
    "",
    "01212345678",
    "1212345678",
    "0171234567",
    "171234567",
    "017123456789",
    "17123456789",
    "+8801012345678",
    "abc",
    "+8811712345678",
    "881712345678",
  ])(
    "rejects %j",
    (v) => {
      expect(normalizeBdPhone(v)).toBeNull();
      expect(validateBdPhone(v).ok).toBe(false);
    },
  );
});

describe("identifier", () => {
  it("detects kind", () => {
    expect(detectIdentifier("a@b.com")).toBe("email");
    expect(detectIdentifier("o'connor@example.com")).toBe("email");
    expect(detectIdentifier("01712345678")).toBe("phone");
    expect(detectIdentifier("1712345678")).toBe("phone");
    expect(detectIdentifier("+8801712345678")).toBe("phone");
    expect(detectIdentifier("(017) 1234-5678")).toBe("phone");
    expect(detectIdentifier("")).toBe("unknown");
    expect(detectIdentifier("someuser")).toBe("unknown");
  });
  it("validates and normalizes", () => {
    expect(validateIdentifier("A@B.com")).toEqual({ ok: true, value: { kind: "email", value: "a@b.com" } });
    expect(validateIdentifier("O'Connor@Example.com")).toEqual({
      ok: true,
      value: { kind: "email", value: "o'connor@example.com" },
    });
    expect(validateIdentifier("01712345678")).toEqual({ ok: true, value: { kind: "phone", value: "+8801712345678" } });
    expect(validateIdentifier("1712-345678")).toEqual({ ok: true, value: { kind: "phone", value: "+8801712345678" } });
    expect(validateIdentifier("(017) 1234-5678")).toEqual({ ok: true, value: { kind: "phone", value: "+8801712345678" } });
    expect(validateIdentifier("nope").ok).toBe(false);
    expect(validateIdentifier("0123").ok).toBe(false);
  });
});

describe("password", () => {
  it("enforces 8-128", () => {
    expect(validatePassword("1234567").ok).toBe(false);
    expect(validatePassword("12345678").ok).toBe(true);
    expect(validatePassword("a".repeat(128)).ok).toBe(true);
    expect(validatePassword("a".repeat(129)).ok).toBe(false);
  });
  it("scores strength", () => {
    expect(passwordStrength("short").score).toBe(0);
    expect(passwordStrength("abcdefgh").label).toBe("Weak");
    expect(passwordStrength("Abcdefgh12!x").score).toBe(4);
    expect(passwordStrength("Abcdefgh12!x").label).toBe("Strong");
  });
  it("matches confirm", () => {
    expect(validatePasswordMatch("a", "a").ok).toBe(true);
    expect(validatePasswordMatch("a", "b").ok).toBe(false);
  });
});

describe("otp and goal", () => {
  it("otp is exactly 6 digits", () => {
    expect(validateOtp("123456").ok).toBe(true);
    expect(validateOtp(" 123456 ").ok).toBe(true);
    for (const v of ["", "12345", "1234567", "12345a", "12 456"]) expect(validateOtp(v).ok).toBe(false);
  });
  it("goal is 3-300 chars trimmed", () => {
    expect(validateGoal("  ab ").ok).toBe(false);
    expect(validateGoal("abc")).toEqual({ ok: true, value: "abc" });
    expect(validateGoal("a".repeat(300)).ok).toBe(true);
    expect(validateGoal("a".repeat(301)).ok).toBe(false);
  });
});

describe("live display & onChange validation", () => {
  it("sanitizes BD phone display without ever prepending +880 and strips non-digits", () => {
    expect(sanitizeBdPhoneDisplay("01712345678")).toBe("01712345678");
    expect(sanitizeBdPhoneDisplay("+8801712345678")).toBe("01712345678");
    expect(sanitizeBdPhoneDisplay("8801712345678")).toBe("01712345678");
    expect(sanitizeBdPhoneDisplay("+880 1712-345678")).toBe("01712345678");
    expect(sanitizeBdPhoneDisplay("017742590012dddddddd12")).toBe("01774259001212");
    expect(sanitizeBdPhoneDisplay("+88001712345678")).toBe("01712345678");
  });

  it("flags invalid BD phone prefixes, non-digits, and >11 digits immediately onChange", () => {
    expect(validateBdPhoneLive("").ok).toBe(true);
    expect(validateBdPhoneLive("0").ok).toBe(true);
    expect(validateBdPhoneLive("01").ok).toBe(true);
    expect(validateBdPhoneLive("017").ok).toBe(true);
    expect(validateBdPhoneLive("9").ok).toBe(false);
    expect(validateBdPhoneLive("02").ok).toBe(false);
    expect(validateBdPhoneLive("012").ok).toBe(false);
    expect(validateBdPhoneLive("017abc").ok).toBe(false);
    expect(validateBdPhoneLive("017123456789").ok).toBe(false);
    expect(validateBdPhoneLive("01712345678")).toEqual({
      ok: true,
      value: "+8801712345678",
    });
  });

  it("tracks blur-incomplete phone state until 11 valid digits complete", () => {
    expect(validateBdPhoneOnChange("01712", false).ok).toBe(true);
    expect(validateBdPhoneOnChange("01712", true).ok).toBe(false);
    expect(validateBdPhoneOnChange("01712345678", true).ok).toBe(true);
    expect(validateBdPhoneOnChange("", true)).toEqual({ ok: true, resetBlurred: true });
  });

  it("validates email, unified identifier, password, and OTP live", () => {
    expect(validateEmailLive("")).toEqual({ ok: true, value: "" });
    expect(validateEmailLive("bad").ok).toBe(false);
    expect(validateEmailLive("bad@").ok).toBe(false);
    expect(validateEmailLive("user@example.com").ok).toBe(true);
    expect(validateEmailLive("o'connor@example.com")).toEqual({
      ok: true,
      value: "o'connor@example.com",
    });

    expect(validateIdentifierOnChange("", false).ok).toBe(true);
    expect(validateIdentifierOnChange("user@", false).ok).toBe(false);
    expect(validateIdentifierOnChange("012", false).ok).toBe(false);
    expect(validateIdentifierOnChange("01712345678", false).ok).toBe(true);
    expect(validateIdentifierOnChange("user@example.com", false).ok).toBe(true);
    expect(validateIdentifierOnChange("o'connor@example.com", false)).toEqual({
      ok: true,
      resetBlurred: false,
    });

    expect(validatePasswordLive("").ok).toBe(true);
    expect(validatePasswordLive("1234567").ok).toBe(false);
    expect(validatePasswordLive("12345678").ok).toBe(true);
    expect(validatePasswordLive("a".repeat(129)).ok).toBe(false);

    expect(validateLoginPassword("")).toEqual({
      ok: false,
      error: "Enter your password.",
    });
    expect(validateLoginPassword("1")).toEqual({ ok: true, value: "1" });
    expect(validateLoginPassword("1234567")).toEqual({
      ok: true,
      value: "1234567",
    });
    expect(validateLoginPassword("a".repeat(129)).ok).toBe(false);

    expect(validateOtpLive("").ok).toBe(true);
    expect(validateOtpLive("12345").ok).toBe(false);
    expect(validateOtpLive("123456").ok).toBe(true);
  });
});
