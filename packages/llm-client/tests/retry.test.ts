import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { retry, calculateDelay, type RetryPolicy } from "../src/utils/retry.js";
import { RateLimitError, ServerError, InvalidRequestError } from "../src/types/errors.js";

// ---------------------------------------------------------------------------
// Helper: create a retryable error with optional retry_after
// ---------------------------------------------------------------------------

function retryableError(
  message = "server error",
  retryAfter?: number,
): ServerError {
  return new ServerError(message, {
    provider: "test",
    status_code: 500,
    retry_after: retryAfter,
  });
}

function rateLimitError(retryAfter?: number): RateLimitError {
  return new RateLimitError("rate limited", {
    provider: "test",
    status_code: 429,
    retry_after: retryAfter,
  });
}

function nonRetryableError(message = "bad request"): InvalidRequestError {
  return new InvalidRequestError(message, {
    provider: "test",
    status_code: 400,
  });
}

// ---------------------------------------------------------------------------
// Tests: calculateDelay
// ---------------------------------------------------------------------------

describe("calculateDelay", () => {
  it("computes exponential backoff without jitter", () => {
    const policy: RetryPolicy = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 60000,
      backoffMultiplier: 2,
      jitter: false,
    };

    expect(calculateDelay(0, policy)).toBe(1000);
    expect(calculateDelay(1, policy)).toBe(2000);
    expect(calculateDelay(2, policy)).toBe(4000);
    expect(calculateDelay(3, policy)).toBe(8000);
  });

  it("caps delay at maxDelay", () => {
    const policy: RetryPolicy = {
      maxRetries: 10,
      baseDelay: 1000,
      maxDelay: 5000,
      backoffMultiplier: 2,
      jitter: false,
    };

    // 1000 * 2^5 = 32000 > 5000
    expect(calculateDelay(5, policy)).toBe(5000);
  });

  it("applies jitter within 0.5x to 1.5x range", () => {
    const policy: RetryPolicy = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 60000,
      backoffMultiplier: 2,
      jitter: true,
    };

    // Run multiple times to verify range.
    for (let i = 0; i < 100; i++) {
      const delay = calculateDelay(0, policy);
      // Base delay is 1000, jitter range is [500, 1500)
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThan(1500);
    }
  });

  it("jitter respects max delay capping", () => {
    const policy: RetryPolicy = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 3000,
      backoffMultiplier: 2,
      jitter: true,
    };

    // Attempt 5: base would be 32000 but capped at 3000, then jitter [1500, 4500).
    for (let i = 0; i < 50; i++) {
      const delay = calculateDelay(5, policy);
      expect(delay).toBeGreaterThanOrEqual(1500);
      expect(delay).toBeLessThan(4500);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: retry
// ---------------------------------------------------------------------------

describe("retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries retryable errors up to maxRetries", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(retryableError())
      .mockRejectedValueOnce(retryableError())
      .mockResolvedValue("recovered");

    const promise = retry(fn, { maxRetries: 2, jitter: false, baseDelay: 100 });

    // Advance past first delay.
    await vi.advanceTimersByTimeAsync(100);
    // Advance past second delay.
    await vi.advanceTimersByTimeAsync(200);

    const result = await promise;
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting all retries", async () => {
    vi.useRealTimers();
    const err = retryableError("persistent");
    const fn = vi.fn().mockImplementation(() => Promise.reject(err));

    await expect(
      retry(fn, { maxRetries: 2, jitter: false, baseDelay: 1 }),
    ).rejects.toThrow("persistent");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    vi.useFakeTimers();
  });

  it("immediately re-throws non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(nonRetryableError());

    await expect(retry(fn, { maxRetries: 5 })).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("immediately re-throws errors without retryable property", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("plain error"));

    await expect(retry(fn, { maxRetries: 5 })).rejects.toThrow("plain error");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("uses retry_after from error when <= maxDelay", async () => {
    const err = rateLimitError(2); // 2 seconds
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue("ok");

    const promise = retry(fn, {
      maxRetries: 1,
      jitter: false,
      baseDelay: 1000,
      maxDelay: 60000,
    });

    // Should use retry_after (2000ms), not baseDelay (1000ms).
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    expect(result).toBe("ok");
  });

  it("re-throws immediately if retry_after > maxDelay", async () => {
    const err = rateLimitError(120); // 120 seconds > default 60s maxDelay
    const fn = vi.fn().mockRejectedValue(err);

    await expect(
      retry(fn, { maxRetries: 3, maxDelay: 60000 }),
    ).rejects.toThrow("rate limited");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("calls onRetry callback before each retry", async () => {
    const onRetry = vi.fn();
    const err = retryableError();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue("ok");

    const promise = retry(fn, {
      maxRetries: 2,
      jitter: false,
      baseDelay: 100,
      onRetry,
    });

    await vi.advanceTimersByTimeAsync(100);

    await promise;

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledWith(err, 0, 100);
  });

  it("respects maxRetries: 0 (no retries)", async () => {
    const fn = vi.fn().mockRejectedValue(retryableError());

    await expect(retry(fn, { maxRetries: 0 })).rejects.toThrow("server error");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("handles non-Error throws by wrapping them", async () => {
    const fn = vi.fn().mockRejectedValue("string error");

    await expect(retry(fn, { maxRetries: 0 })).rejects.toThrow("string error");
  });
});
