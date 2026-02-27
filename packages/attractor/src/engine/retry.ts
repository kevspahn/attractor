/**
 * Retry logic — exponential backoff with jitter and preset policies.
 *
 * See spec Section 3.5 and 3.6.
 */

export interface BackoffConfig {
  /** First retry delay in milliseconds. Default: 200 */
  initialDelayMs: number;
  /** Multiplier for subsequent delays. Default: 2.0 */
  backoffFactor: number;
  /** Cap on delay in milliseconds. Default: 60000 */
  maxDelayMs: number;
  /** Add random jitter to prevent thundering herd. Default: true */
  jitter: boolean;
}

export interface RetryPolicy {
  /** Minimum 1. 1 means no retries. */
  maxAttempts: number;
  /** Backoff configuration. */
  backoff: BackoffConfig;
  /** Predicate for retryable errors. */
  shouldRetry: (error: Error) => boolean;
}

/**
 * Calculate the delay for a given retry attempt.
 *
 * @param attempt - 1-indexed (first retry is attempt=1)
 * @param config - Backoff configuration
 * @param rng - Random number generator for testing (defaults to Math.random)
 */
export function delayForAttempt(
  attempt: number,
  config: BackoffConfig,
  rng: () => number = Math.random,
): number {
  let delay =
    config.initialDelayMs * Math.pow(config.backoffFactor, attempt - 1);
  delay = Math.min(delay, config.maxDelayMs);
  if (config.jitter) {
    // jitter range: 0.5 to 1.5
    delay = delay * (0.5 + rng());
  }
  return Math.min(Math.floor(delay), config.maxDelayMs);
}

/**
 * Default shouldRetry predicate.
 *
 * Returns true for network errors, rate limit errors (429),
 * server errors (5xx), and transient failures.
 * Returns false for auth errors (401, 403), bad request (400),
 * validation errors, and config errors.
 */
export function defaultShouldRetry(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Non-retryable patterns
  if (
    message.includes("authentication") ||
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("401") ||
    message.includes("403") ||
    message.includes("400") ||
    message.includes("bad request") ||
    message.includes("validation") ||
    message.includes("configuration") ||
    message.includes("config error")
  ) {
    return false;
  }

  // Retryable patterns
  if (
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("server error") ||
    message.includes("transient") ||
    message.includes("econnreset") ||
    message.includes("econnrefused")
  ) {
    return true;
  }

  // Default: don't retry unknown errors
  return false;
}

// ---------- Preset Policies ----------

const defaultBackoff: BackoffConfig = {
  initialDelayMs: 200,
  backoffFactor: 2.0,
  maxDelayMs: 60_000,
  jitter: true,
};

export const PRESET_POLICIES: Record<string, RetryPolicy> = {
  none: {
    maxAttempts: 1,
    backoff: { ...defaultBackoff },
    shouldRetry: () => false,
  },
  standard: {
    maxAttempts: 5,
    backoff: { ...defaultBackoff, initialDelayMs: 200, backoffFactor: 2.0 },
    shouldRetry: defaultShouldRetry,
  },
  aggressive: {
    maxAttempts: 5,
    backoff: { ...defaultBackoff, initialDelayMs: 500, backoffFactor: 2.0 },
    shouldRetry: defaultShouldRetry,
  },
  linear: {
    maxAttempts: 3,
    backoff: { ...defaultBackoff, initialDelayMs: 500, backoffFactor: 1.0 },
    shouldRetry: defaultShouldRetry,
  },
  patient: {
    maxAttempts: 3,
    backoff: { ...defaultBackoff, initialDelayMs: 2000, backoffFactor: 3.0 },
    shouldRetry: defaultShouldRetry,
  },
};

/**
 * Build a retry policy for a node.
 *
 * Priority:
 * 1. Node max_retries attribute
 * 2. Graph default_max_retry
 * 3. Built-in default: 0 (no retries)
 */
export function buildRetryPolicy(
  nodeMaxRetries: number,
  graphDefaultMaxRetry: number,
): RetryPolicy {
  const maxRetries =
    nodeMaxRetries > 0 ? nodeMaxRetries : graphDefaultMaxRetry > 0 ? graphDefaultMaxRetry : 0;

  return {
    maxAttempts: maxRetries + 1,
    backoff: { ...defaultBackoff },
    shouldRetry: defaultShouldRetry,
  };
}

/**
 * Sleep for the given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
