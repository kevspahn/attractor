/**
 * Error mapping utility for provider HTTP responses.
 *
 * Maps HTTP status codes and response bodies to the typed error hierarchy
 * defined in the spec (Sections 6.4-6.5).
 */

import {
  ProviderError,
  AuthenticationError,
  AccessDeniedError,
  NotFoundError,
  InvalidRequestError,
  RateLimitError,
  ServerError,
  ContentFilterError,
  ContextLengthError,
  RequestTimeoutError,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Try to extract a human-readable error message from a provider response body. */
function extractMessage(body: unknown): string {
  if (body != null && typeof body === "object") {
    const obj = body as Record<string, unknown>;

    // Most providers nest under `error.message`.
    if (
      obj["error"] != null &&
      typeof obj["error"] === "object" &&
      typeof (obj["error"] as Record<string, unknown>)["message"] === "string"
    ) {
      return (obj["error"] as Record<string, unknown>)["message"] as string;
    }

    // Some providers put `message` at the top level.
    if (typeof obj["message"] === "string") {
      return obj["message"] as string;
    }

    // Fallback: `error` as string.
    if (typeof obj["error"] === "string") {
      return obj["error"] as string;
    }
  }

  // Last resort: stringify the whole body.
  try {
    return typeof body === "string" ? body : JSON.stringify(body);
  } catch {
    return String(body);
  }
}

/** Try to extract an error code from a provider response body. */
function extractErrorCode(body: unknown): string | undefined {
  if (body != null && typeof body === "object") {
    const obj = body as Record<string, unknown>;

    if (obj["error"] != null && typeof obj["error"] === "object") {
      const errObj = obj["error"] as Record<string, unknown>;
      if (typeof errObj["code"] === "string") return errObj["code"];
      if (typeof errObj["type"] === "string") return errObj["type"];
    }

    if (typeof obj["code"] === "string") return obj["code"];
    if (typeof obj["type"] === "string") return obj["type"];
  }

  return undefined;
}

/**
 * Parse the `Retry-After` header value.
 *
 * The header can be an integer (seconds) or an HTTP-date.  We only handle
 * the integer form here; dates are uncommon for LLM APIs.
 *
 * Returns seconds (as a number) or `undefined`.
 */
function parseRetryAfter(headers?: Headers): number | undefined {
  if (!headers) return undefined;

  const raw = headers.get("retry-after");
  if (raw == null) return undefined;

  const seconds = parseFloat(raw);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Message-based classification
// ---------------------------------------------------------------------------

/** Patterns checked against the error message for ambiguous status codes. */
const MESSAGE_PATTERNS: Array<{
  patterns: RegExp[];
  classify: (
    message: string,
    opts: ErrorConstructorOptions,
  ) => ProviderError;
}> = [
  {
    patterns: [/not found/i, /does not exist/i],
    classify: (msg, opts) => new NotFoundError(msg, opts),
  },
  {
    patterns: [/unauthorized/i, /invalid key/i],
    classify: (msg, opts) => new AuthenticationError(msg, opts),
  },
  {
    patterns: [/context length/i, /too many tokens/i],
    classify: (msg, opts) => new ContextLengthError(msg, opts),
  },
  {
    patterns: [/content filter/i, /safety/i],
    classify: (msg, opts) => new ContentFilterError(msg, opts),
  },
];

interface ErrorConstructorOptions {
  provider: string;
  status_code?: number;
  error_code?: string;
  retry_after?: number;
  raw?: Record<string, unknown>;
}

/**
 * Try to classify an error by scanning the message body for known patterns.
 * Returns `undefined` if no pattern matches.
 */
function classifyByMessage(
  message: string,
  opts: ErrorConstructorOptions,
): ProviderError | undefined {
  for (const { patterns, classify } of MESSAGE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        return classify(message, opts);
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map an HTTP error response to a typed `ProviderError`.
 *
 * @param status  - HTTP status code from the provider response.
 * @param body    - Parsed JSON body (or raw text) from the response.
 * @param provider - Provider name (e.g. "openai", "anthropic").
 * @param headers - Response headers (used to extract Retry-After).
 */
export function mapHttpError(
  status: number,
  body: unknown,
  provider: string,
  headers?: Headers,
): ProviderError | RequestTimeoutError {
  const message = extractMessage(body);
  const errorCode = extractErrorCode(body);
  const retryAfter = parseRetryAfter(headers);
  const raw =
    body != null && typeof body === "object"
      ? (body as Record<string, unknown>)
      : undefined;

  const opts: ErrorConstructorOptions = {
    provider,
    status_code: status,
    error_code: errorCode,
    retry_after: retryAfter,
    raw,
  };

  // Direct status code mapping (spec Section 6.4).
  switch (status) {
    case 400:
      return classifyByMessage(message, opts) ?? new InvalidRequestError(message, opts);
    case 401:
      return new AuthenticationError(message, opts);
    case 403:
      return new AccessDeniedError(message, opts);
    case 404:
      return new NotFoundError(message, opts);
    case 408:
      return new RequestTimeoutError(message);
    case 413:
      return classifyByMessage(message, opts) ?? new ContextLengthError(message, opts);
    case 422:
      return classifyByMessage(message, opts) ?? new InvalidRequestError(message, opts);
    case 429:
      return new RateLimitError(message, opts);
    case 500:
    case 502:
    case 503:
    case 504:
      return new ServerError(message, opts);
  }

  // For any other status, try message-based classification first,
  // then fall back to a generic ProviderError (retryable by default for
  // unknown errors per spec Section 6.3).
  const classified = classifyByMessage(message, opts);
  if (classified) return classified;

  return new ProviderError(message, {
    ...opts,
    retryable: true, // unknown errors default to retryable
  });
}
