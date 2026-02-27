import { describe, it, expect } from "vitest";
import {
  evaluateCondition,
  evaluateClause,
  resolveKey,
  validateConditionSyntax,
} from "../src/conditions.js";
import { Context } from "../src/state/context.js";
import { StageStatus } from "../src/state/outcome.js";
import type { Outcome } from "../src/state/outcome.js";

function makeOutcome(overrides: Partial<Outcome> = {}): Outcome {
  return {
    status: StageStatus.SUCCESS,
    ...overrides,
  };
}

function makeContext(values: Record<string, unknown> = {}): Context {
  const ctx = new Context();
  for (const [key, value] of Object.entries(values)) {
    ctx.set(key, value);
  }
  return ctx;
}

describe("resolveKey", () => {
  it("resolves 'outcome' to the outcome status", () => {
    const outcome = makeOutcome({ status: StageStatus.SUCCESS });
    expect(resolveKey("outcome", outcome, makeContext())).toBe("success");
  });

  it("resolves 'preferred_label' to the outcome preferred label", () => {
    const outcome = makeOutcome({ preferredLabel: "Approve" });
    expect(resolveKey("preferred_label", outcome, makeContext())).toBe("Approve");
  });

  it("resolves 'preferred_label' to empty string when not set", () => {
    expect(resolveKey("preferred_label", makeOutcome(), makeContext())).toBe("");
  });

  it("resolves 'context.*' keys from context", () => {
    const ctx = makeContext({ "context.tests_passed": "true" });
    expect(resolveKey("context.tests_passed", makeOutcome(), ctx)).toBe("true");
  });

  it("resolves 'context.*' keys with short form fallback", () => {
    const ctx = makeContext({ tests_passed: "true" });
    expect(resolveKey("context.tests_passed", makeOutcome(), ctx)).toBe("true");
  });

  it("resolves unqualified keys from context", () => {
    const ctx = makeContext({ my_key: "my_value" });
    expect(resolveKey("my_key", makeOutcome(), ctx)).toBe("my_value");
  });

  it("returns empty string for missing context keys", () => {
    expect(resolveKey("context.missing", makeOutcome(), makeContext())).toBe("");
    expect(resolveKey("missing", makeOutcome(), makeContext())).toBe("");
  });
});

describe("evaluateClause", () => {
  it("evaluates key=value with equality", () => {
    const outcome = makeOutcome({ status: StageStatus.SUCCESS });
    expect(evaluateClause("outcome=success", outcome, makeContext())).toBe(true);
    expect(evaluateClause("outcome=fail", outcome, makeContext())).toBe(false);
  });

  it("evaluates key!=value with inequality", () => {
    const outcome = makeOutcome({ status: StageStatus.SUCCESS });
    expect(evaluateClause("outcome!=success", outcome, makeContext())).toBe(false);
    expect(evaluateClause("outcome!=fail", outcome, makeContext())).toBe(true);
  });

  it("evaluates bare key as truthy check", () => {
    const ctx = makeContext({ flag: "yes" });
    expect(evaluateClause("flag", makeOutcome(), ctx)).toBe(true);

    const ctx2 = makeContext();
    expect(evaluateClause("flag", makeOutcome(), ctx2)).toBe(false);
  });

  it("treats empty clause as true", () => {
    expect(evaluateClause("", makeOutcome(), makeContext())).toBe(true);
  });
});

describe("evaluateCondition", () => {
  it("empty condition evaluates to true", () => {
    expect(evaluateCondition("", makeOutcome(), makeContext())).toBe(true);
    expect(evaluateCondition("  ", makeOutcome(), makeContext())).toBe(true);
  });

  it("evaluates outcome=success", () => {
    const outcome = makeOutcome({ status: StageStatus.SUCCESS });
    expect(evaluateCondition("outcome=success", outcome, makeContext())).toBe(true);
  });

  it("evaluates outcome=fail", () => {
    const outcome = makeOutcome({ status: StageStatus.FAIL });
    expect(evaluateCondition("outcome=fail", outcome, makeContext())).toBe(true);
    expect(evaluateCondition("outcome=success", outcome, makeContext())).toBe(false);
  });

  it("evaluates outcome!=success", () => {
    const outcome = makeOutcome({ status: StageStatus.FAIL });
    expect(evaluateCondition("outcome!=success", outcome, makeContext())).toBe(true);
  });

  it("evaluates AND conjunction", () => {
    const outcome = makeOutcome({ status: StageStatus.SUCCESS });
    const ctx = makeContext({ tests_passed: "true" });
    expect(
      evaluateCondition("outcome=success && context.tests_passed=true", outcome, ctx),
    ).toBe(true);
    expect(
      evaluateCondition("outcome=success && context.tests_passed=false", outcome, ctx),
    ).toBe(false);
  });

  it("evaluates context variable lookup", () => {
    const ctx = makeContext({ loop_state: "exhausted" });
    expect(
      evaluateCondition("context.loop_state!=exhausted", makeOutcome(), ctx),
    ).toBe(false);
    expect(
      evaluateCondition("context.loop_state=exhausted", makeOutcome(), ctx),
    ).toBe(true);
  });

  it("evaluates preferred_label matching", () => {
    const outcome = makeOutcome({ preferredLabel: "Fix" });
    expect(evaluateCondition("preferred_label=Fix", outcome, makeContext())).toBe(true);
    expect(evaluateCondition("preferred_label=Approve", outcome, makeContext())).toBe(false);
  });

  it("missing context key compares as empty string", () => {
    const ctx = makeContext();
    expect(evaluateCondition("context.missing=", makeOutcome(), ctx)).toBe(true);
    expect(evaluateCondition("context.missing=something", makeOutcome(), ctx)).toBe(false);
  });

  it("handles whitespace in conditions", () => {
    const outcome = makeOutcome({ status: StageStatus.SUCCESS });
    expect(evaluateCondition(" outcome = success ", outcome, makeContext())).toBe(true);
  });

  it("handles multiple && clauses", () => {
    const outcome = makeOutcome({ status: StageStatus.SUCCESS });
    const ctx = makeContext({ a: "1", b: "2" });
    expect(
      evaluateCondition("outcome=success && context.a=1 && context.b=2", outcome, ctx),
    ).toBe(true);
    expect(
      evaluateCondition("outcome=success && context.a=1 && context.b=3", outcome, ctx),
    ).toBe(false);
  });
});

describe("validateConditionSyntax", () => {
  it("returns null for valid conditions", () => {
    expect(validateConditionSyntax("outcome=success")).toBeNull();
    expect(validateConditionSyntax("outcome!=fail")).toBeNull();
    expect(validateConditionSyntax("outcome=success && context.x=y")).toBeNull();
    expect(validateConditionSyntax("")).toBeNull();
    expect(validateConditionSyntax("bare_key")).toBeNull();
  });

  it("returns error for empty key", () => {
    expect(validateConditionSyntax("=value")).toBeTruthy();
  });
});
