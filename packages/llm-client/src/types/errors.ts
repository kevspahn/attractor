/**
 * Error hierarchy for the unified LLM client.
 *
 * All library errors inherit from SDKError. Error class names are chosen to
 * avoid shadowing common language built-in names.
 */

// ---------------------------------------------------------------------------
// SDKError — base for all library errors
// ---------------------------------------------------------------------------

/** Base error for all unified LLM client errors. */
export class SDKError extends Error {
  /** Whether this error is safe to retry. */
  readonly retryable: boolean;

  constructor(
    message: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, { cause: options?.cause });
    this.name = "SDKError";
    this.retryable = options?.retryable ?? false;
  }
}

// ---------------------------------------------------------------------------
// ProviderError — errors from the LLM provider
// ---------------------------------------------------------------------------

/** Error returned by an LLM provider. */
export class ProviderError extends SDKError {
  /** Which provider returned the error. */
  readonly provider: string;
  /** HTTP status code, if applicable. */
  readonly status_code?: number;
  /** Provider-specific error code. */
  readonly error_code?: string;
  /** Seconds to wait before retrying. */
  readonly retry_after?: number;
  /** Raw error response body from the provider. */
  readonly raw?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      provider: string;
      status_code?: number;
      error_code?: string;
      retryable?: boolean;
      retry_after?: number;
      raw?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, {
      cause: options.cause,
      retryable: options.retryable ?? false,
    });
    this.name = "ProviderError";
    this.provider = options.provider;
    this.status_code = options.status_code;
    this.error_code = options.error_code;
    this.retry_after = options.retry_after;
    this.raw = options.raw;
  }
}

// ---------------------------------------------------------------------------
// ProviderError subclasses — non-retryable
// ---------------------------------------------------------------------------

/** 401: Invalid API key, expired token. */
export class AuthenticationError extends ProviderError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof ProviderError>[1], "retryable">,
  ) {
    super(message, { ...options, retryable: false });
    this.name = "AuthenticationError";
  }
}

/** 403: Insufficient permissions. */
export class AccessDeniedError extends ProviderError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof ProviderError>[1], "retryable">,
  ) {
    super(message, { ...options, retryable: false });
    this.name = "AccessDeniedError";
  }
}

/** 404: Model not found, endpoint not found. */
export class NotFoundError extends ProviderError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof ProviderError>[1], "retryable">,
  ) {
    super(message, { ...options, retryable: false });
    this.name = "NotFoundError";
  }
}

/** 400/422: Malformed request, invalid parameters. */
export class InvalidRequestError extends ProviderError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof ProviderError>[1], "retryable">,
  ) {
    super(message, { ...options, retryable: false });
    this.name = "InvalidRequestError";
  }
}

/** Response blocked by safety/content filter. */
export class ContentFilterError extends ProviderError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof ProviderError>[1], "retryable">,
  ) {
    super(message, { ...options, retryable: false });
    this.name = "ContentFilterError";
  }
}

/** Input + output exceeds context window. */
export class ContextLengthError extends ProviderError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof ProviderError>[1], "retryable">,
  ) {
    super(message, { ...options, retryable: false });
    this.name = "ContextLengthError";
  }
}

/** Billing/usage quota exhausted. */
export class QuotaExceededError extends ProviderError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof ProviderError>[1], "retryable">,
  ) {
    super(message, { ...options, retryable: false });
    this.name = "QuotaExceededError";
  }
}

// ---------------------------------------------------------------------------
// ProviderError subclasses — retryable
// ---------------------------------------------------------------------------

/** 429: Rate limit exceeded. */
export class RateLimitError extends ProviderError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof ProviderError>[1], "retryable">,
  ) {
    super(message, { ...options, retryable: true });
    this.name = "RateLimitError";
  }
}

/** 500-599: Provider internal error. */
export class ServerError extends ProviderError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof ProviderError>[1], "retryable">,
  ) {
    super(message, { ...options, retryable: true });
    this.name = "ServerError";
  }
}

// ---------------------------------------------------------------------------
// Non-provider errors
// ---------------------------------------------------------------------------

/** Request or stream timed out. Retryable. */
export class RequestTimeoutError extends SDKError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause, retryable: true });
    this.name = "RequestTimeoutError";
  }
}

/** Request cancelled via abort signal. Not retryable. */
export class AbortError extends SDKError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause, retryable: false });
    this.name = "AbortError";
  }
}

/** Network-level failure. Retryable. */
export class NetworkError extends SDKError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause, retryable: true });
    this.name = "NetworkError";
  }
}

/** Error during stream consumption. Retryable. */
export class StreamError extends SDKError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause, retryable: true });
    this.name = "StreamError";
  }
}

/** Tool call arguments failed validation. Not retryable. */
export class InvalidToolCallError extends SDKError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause, retryable: false });
    this.name = "InvalidToolCallError";
  }
}

/** Structured output parsing/validation failed. Not retryable. */
export class NoObjectGeneratedError extends SDKError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause, retryable: false });
    this.name = "NoObjectGeneratedError";
  }
}

/** SDK misconfiguration (missing provider, etc.). Not retryable. */
export class ConfigurationError extends SDKError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause, retryable: false });
    this.name = "ConfigurationError";
  }
}
