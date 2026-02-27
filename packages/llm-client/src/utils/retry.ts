/**
 * Retry utility with exponential backoff and jitter.
 *
 * Implements the retry policy from the unified-llm-spec Section 6.6:
 *   - Exponential backoff: `min(baseDelay * multiplier^attempt, maxDelay)`
 *   - Jitter: `delay * random(0.5, 1.5)`
 *   - Respect `retry_after` from errors
 *   - Only retry errors marked `retryable === true`
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for retry behavior. */
export interface RetryPolicy {
  /** Total retry attempts (not counting the initial call). Default: 2. */
  maxRetries: number;
  /** Initial delay in milliseconds. Default: 1000. */
  baseDelay: number;
  /** Maximum delay between retries in milliseconds. Default: 60000. */
  maxDelay: number;
  /** Exponential backoff factor. Default: 2. */
  backoffMultiplier: number;
  /** Whether to add random jitter (+/- 50%). Default: true. */
  jitter: boolean;
  /** Called before each retry with the error, attempt number, and delay. */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/** Error shape we check for retryable/retry_after fields. */
interface RetryableError extends Error {
  retryable?: boolean;
  retry_after?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelay: 1000,
  maxDelay: 60000,
  backoffMultiplier: 2,
  jitter: true,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Calculate the delay for a given attempt.
 *
 * `attempt` is 0-indexed (first retry = attempt 0).
 */
export function calculateDelay(
  attempt: number,
  policy: RetryPolicy,
): number {
  let delay = Math.min(
    policy.baseDelay * Math.pow(policy.backoffMultiplier, attempt),
    policy.maxDelay,
  );

  if (policy.jitter) {
    // +/- 50% jitter: multiply by a random value in [0.5, 1.5)
    const jitterFactor = 0.5 + Math.random();
    delay = delay * jitterFactor;
  }

  return delay;
}

/** Simple promise-based sleep. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Type guard: does the error have a `retryable` property? */
function isRetryableError(err: unknown): err is RetryableError {
  return err instanceof Error && "retryable" in err;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute `fn` with automatic retries according to the given policy.
 *
 * Only errors where `error.retryable === true` are retried.  If the error
 * carries a `retry_after` value (in seconds):
 *   - If `retry_after <= maxDelay / 1000`, use it as the delay.
 *   - If `retry_after > maxDelay / 1000`, re-throw immediately (the provider
 *     is signalling a long wait that we should not silently absorb).
 *
 * Non-retryable errors are always re-thrown immediately.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  policy?: Partial<RetryPolicy>,
): Promise<T> {
  const p: RetryPolicy = { ...DEFAULT_POLICY, ...policy };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= p.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      // If we've exhausted all retries, throw.
      if (attempt >= p.maxRetries) {
        throw error;
      }

      // Only retry errors marked retryable.
      if (!isRetryableError(error) || !error.retryable) {
        throw error;
      }

      // Determine delay.
      let delay: number;

      if (error.retry_after != null && error.retry_after > 0) {
        const retryAfterMs = error.retry_after * 1000;
        if (retryAfterMs > p.maxDelay) {
          // retry_after exceeds our budget -- re-throw.
          throw error;
        }
        delay = retryAfterMs;
      } else {
        delay = calculateDelay(attempt, p);
      }

      // Notify caller.
      if (p.onRetry) {
        p.onRetry(error, attempt, delay);
      }

      await sleep(delay);
    }
  }

  // Unreachable, but TypeScript needs the guarantee.
  throw lastError ?? new Error("retry: unexpected state");
}
