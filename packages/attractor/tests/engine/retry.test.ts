import { describe, it, expect } from "vitest";
import {
  delayForAttempt,
  defaultShouldRetry,
  buildRetryPolicy,
  PRESET_POLICIES,
} from "../../src/engine/retry.js";

describe("delayForAttempt", () => {
  const noJitterConfig = {
    initialDelayMs: 200,
    backoffFactor: 2.0,
    maxDelayMs: 60_000,
    jitter: false,
  };

  it("computes exponential backoff", () => {
    expect(delayForAttempt(1, noJitterConfig)).toBe(200);
    expect(delayForAttempt(2, noJitterConfig)).toBe(400);
    expect(delayForAttempt(3, noJitterConfig)).toBe(800);
    expect(delayForAttempt(4, noJitterConfig)).toBe(1600);
  });

  it("caps at maxDelayMs", () => {
    const config = { ...noJitterConfig, maxDelayMs: 500 };
    expect(delayForAttempt(1, config)).toBe(200);
    expect(delayForAttempt(2, config)).toBe(400);
    expect(delayForAttempt(3, config)).toBe(500); // capped
    expect(delayForAttempt(4, config)).toBe(500); // capped
  });

  it("applies jitter with random factor 0.5-1.5", () => {
    const jitterConfig = { ...noJitterConfig, jitter: true };

    // Fixed rng returning 0.5 -> multiplier 1.0
    const delay1 = delayForAttempt(1, jitterConfig, () => 0.5);
    expect(delay1).toBe(200); // 200 * 1.0

    // Fixed rng returning 0 -> multiplier 0.5
    const delay2 = delayForAttempt(1, jitterConfig, () => 0);
    expect(delay2).toBe(100); // 200 * 0.5

    // Fixed rng returning 1 -> multiplier 1.5
    const delay3 = delayForAttempt(1, jitterConfig, () => 1);
    expect(delay3).toBe(300); // 200 * 1.5
  });

  it("linear backoff with factor 1.0", () => {
    const linearConfig = { ...noJitterConfig, initialDelayMs: 500, backoffFactor: 1.0 };
    expect(delayForAttempt(1, linearConfig)).toBe(500);
    expect(delayForAttempt(2, linearConfig)).toBe(500);
    expect(delayForAttempt(3, linearConfig)).toBe(500);
  });
});

describe("defaultShouldRetry", () => {
  it("retries network errors", () => {
    expect(defaultShouldRetry(new Error("network timeout"))).toBe(true);
    expect(defaultShouldRetry(new Error("ECONNRESET"))).toBe(true);
    expect(defaultShouldRetry(new Error("ECONNREFUSED"))).toBe(true);
  });

  it("retries rate limit errors", () => {
    expect(defaultShouldRetry(new Error("429 Too Many Requests"))).toBe(true);
    expect(defaultShouldRetry(new Error("rate limit exceeded"))).toBe(true);
  });

  it("retries server errors", () => {
    expect(defaultShouldRetry(new Error("500 Internal Server Error"))).toBe(true);
    expect(defaultShouldRetry(new Error("502 Bad Gateway"))).toBe(true);
    expect(defaultShouldRetry(new Error("503 Service Unavailable"))).toBe(true);
  });

  it("does not retry auth errors", () => {
    expect(defaultShouldRetry(new Error("401 Unauthorized"))).toBe(false);
    expect(defaultShouldRetry(new Error("403 Forbidden"))).toBe(false);
    expect(defaultShouldRetry(new Error("authentication failed"))).toBe(false);
  });

  it("does not retry bad request", () => {
    expect(defaultShouldRetry(new Error("400 Bad Request"))).toBe(false);
  });

  it("does not retry validation errors", () => {
    expect(defaultShouldRetry(new Error("validation failed"))).toBe(false);
  });

  it("does not retry unknown errors", () => {
    expect(defaultShouldRetry(new Error("something weird happened"))).toBe(false);
  });
});

describe("buildRetryPolicy", () => {
  it("uses node max_retries when set", () => {
    const policy = buildRetryPolicy(3, 50);
    expect(policy.maxAttempts).toBe(4); // 3 + 1
  });

  it("uses graph default_max_retry when node is 0", () => {
    const policy = buildRetryPolicy(0, 5);
    expect(policy.maxAttempts).toBe(6); // 5 + 1
  });

  it("uses built-in default of 0 when both are 0", () => {
    const policy = buildRetryPolicy(0, 0);
    expect(policy.maxAttempts).toBe(1); // 0 + 1, no retries
  });
});

describe("PRESET_POLICIES", () => {
  it("none has maxAttempts 1", () => {
    expect(PRESET_POLICIES["none"]!.maxAttempts).toBe(1);
    expect(PRESET_POLICIES["none"]!.shouldRetry(new Error("anything"))).toBe(false);
  });

  it("standard has maxAttempts 5", () => {
    expect(PRESET_POLICIES["standard"]!.maxAttempts).toBe(5);
    expect(PRESET_POLICIES["standard"]!.backoff.initialDelayMs).toBe(200);
  });

  it("aggressive has maxAttempts 5 and higher initial delay", () => {
    expect(PRESET_POLICIES["aggressive"]!.maxAttempts).toBe(5);
    expect(PRESET_POLICIES["aggressive"]!.backoff.initialDelayMs).toBe(500);
  });

  it("linear has factor 1.0", () => {
    expect(PRESET_POLICIES["linear"]!.maxAttempts).toBe(3);
    expect(PRESET_POLICIES["linear"]!.backoff.backoffFactor).toBe(1.0);
  });

  it("patient has factor 3.0 and high initial delay", () => {
    expect(PRESET_POLICIES["patient"]!.maxAttempts).toBe(3);
    expect(PRESET_POLICIES["patient"]!.backoff.initialDelayMs).toBe(2000);
    expect(PRESET_POLICIES["patient"]!.backoff.backoffFactor).toBe(3.0);
  });
});
