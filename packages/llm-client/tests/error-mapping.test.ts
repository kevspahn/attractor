import { describe, it, expect } from "vitest";
import { mapHttpError } from "../src/utils/error-mapping.js";
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
} from "../src/types/errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Standard provider error body shape. */
function errorBody(message: string, code?: string) {
  return {
    error: {
      message,
      ...(code ? { code } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests: status code mapping
// ---------------------------------------------------------------------------

describe("mapHttpError — status code mapping", () => {
  it("400 → InvalidRequestError", () => {
    const err = mapHttpError(400, errorBody("bad request"), "openai");
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect(err.message).toBe("bad request");
    expect(err.retryable).toBe(false);
  });

  it("401 → AuthenticationError", () => {
    const err = mapHttpError(401, errorBody("invalid api key"), "openai");
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.retryable).toBe(false);
  });

  it("403 → AccessDeniedError", () => {
    const err = mapHttpError(403, errorBody("forbidden"), "anthropic");
    expect(err).toBeInstanceOf(AccessDeniedError);
    expect(err.retryable).toBe(false);
  });

  it("404 → NotFoundError", () => {
    const err = mapHttpError(404, errorBody("model not found"), "openai");
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toBe("model not found");
    expect(err.retryable).toBe(false);
  });

  it("408 → RequestTimeoutError", () => {
    const err = mapHttpError(408, errorBody("request timed out"), "openai");
    expect(err).toBeInstanceOf(RequestTimeoutError);
    expect(err.retryable).toBe(true);
  });

  it("413 → ContextLengthError", () => {
    const err = mapHttpError(413, errorBody("payload too large"), "openai");
    expect(err).toBeInstanceOf(ContextLengthError);
    expect(err.retryable).toBe(false);
  });

  it("422 → InvalidRequestError", () => {
    const err = mapHttpError(422, errorBody("unprocessable"), "openai");
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect(err.retryable).toBe(false);
  });

  it("429 → RateLimitError", () => {
    const err = mapHttpError(429, errorBody("rate limited"), "anthropic");
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryable).toBe(true);
  });

  it.each([500, 502, 503, 504])("%d → ServerError", (status) => {
    const err = mapHttpError(status, errorBody("server error"), "openai");
    expect(err).toBeInstanceOf(ServerError);
    expect(err.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: Retry-After extraction
// ---------------------------------------------------------------------------

describe("mapHttpError — Retry-After header", () => {
  it("extracts Retry-After as retry_after on RateLimitError", () => {
    const headers = new Headers({ "retry-after": "30" });
    const err = mapHttpError(429, errorBody("rate limited"), "openai", headers);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retry_after).toBe(30);
  });

  it("extracts Retry-After for ServerError too", () => {
    const headers = new Headers({ "retry-after": "5" });
    const err = mapHttpError(500, errorBody("overloaded"), "anthropic", headers);
    expect(err).toBeInstanceOf(ServerError);
    expect((err as ServerError).retry_after).toBe(5);
  });

  it("handles missing Retry-After gracefully", () => {
    const err = mapHttpError(429, errorBody("rate limited"), "openai");
    expect((err as RateLimitError).retry_after).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: error code extraction
// ---------------------------------------------------------------------------

describe("mapHttpError — error code extraction", () => {
  it("extracts error.code from body", () => {
    const body = { error: { message: "bad", code: "invalid_api_key" } };
    const err = mapHttpError(401, body, "openai");
    expect((err as ProviderError).error_code).toBe("invalid_api_key");
  });

  it("extracts error.type from body as fallback", () => {
    const body = { error: { message: "bad", type: "invalid_request_error" } };
    const err = mapHttpError(400, body, "openai");
    expect((err as ProviderError).error_code).toBe("invalid_request_error");
  });
});

// ---------------------------------------------------------------------------
// Tests: message extraction
// ---------------------------------------------------------------------------

describe("mapHttpError — message extraction", () => {
  it("extracts error.message from standard body", () => {
    const err = mapHttpError(400, errorBody("the real message"), "openai");
    expect(err.message).toBe("the real message");
  });

  it("extracts top-level message from body", () => {
    const err = mapHttpError(400, { message: "top level" }, "openai");
    expect(err.message).toBe("top level");
  });

  it("uses error string when error is a string", () => {
    const err = mapHttpError(400, { error: "string error" }, "openai");
    expect(err.message).toBe("string error");
  });

  it("stringifies body as fallback", () => {
    const err = mapHttpError(400, { foo: "bar" }, "openai");
    expect(err.message).toBe('{"foo":"bar"}');
  });

  it("handles string body", () => {
    const err = mapHttpError(400, "plain text error", "openai");
    expect(err.message).toBe("plain text error");
  });

  it("handles null body", () => {
    const err = mapHttpError(400, null, "openai");
    expect(err.message).toBe("null");
  });
});

// ---------------------------------------------------------------------------
// Tests: message-based classification
// ---------------------------------------------------------------------------

describe("mapHttpError — message-based classification", () => {
  it("classifies 'not found' in message as NotFoundError (on ambiguous status)", () => {
    const err = mapHttpError(
      400,
      errorBody("model not found in catalog"),
      "openai",
    );
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it("classifies 'does not exist' in message as NotFoundError", () => {
    const err = mapHttpError(
      400,
      errorBody("The model does not exist"),
      "openai",
    );
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it("classifies 'unauthorized' in message as AuthenticationError", () => {
    const err = mapHttpError(
      400,
      errorBody("unauthorized access"),
      "openai",
    );
    expect(err).toBeInstanceOf(AuthenticationError);
  });

  it("classifies 'invalid key' in message as AuthenticationError", () => {
    const err = mapHttpError(
      422,
      errorBody("invalid key provided"),
      "openai",
    );
    expect(err).toBeInstanceOf(AuthenticationError);
  });

  it("classifies 'context length' in message as ContextLengthError", () => {
    const err = mapHttpError(
      400,
      errorBody("maximum context length exceeded"),
      "openai",
    );
    expect(err).toBeInstanceOf(ContextLengthError);
  });

  it("classifies 'too many tokens' in message as ContextLengthError", () => {
    const err = mapHttpError(
      400,
      errorBody("too many tokens in request"),
      "openai",
    );
    expect(err).toBeInstanceOf(ContextLengthError);
  });

  it("classifies 'content filter' in message as ContentFilterError", () => {
    const err = mapHttpError(
      400,
      errorBody("blocked by content filter"),
      "openai",
    );
    expect(err).toBeInstanceOf(ContentFilterError);
  });

  it("classifies 'safety' in message as ContentFilterError", () => {
    const err = mapHttpError(
      400,
      errorBody("response blocked for safety reasons"),
      "openai",
    );
    expect(err).toBeInstanceOf(ContentFilterError);
  });
});

// ---------------------------------------------------------------------------
// Tests: unknown status codes
// ---------------------------------------------------------------------------

describe("mapHttpError — unknown status codes", () => {
  it("returns a generic ProviderError for unrecognized status", () => {
    const err = mapHttpError(418, errorBody("I'm a teapot"), "unknown");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe("I'm a teapot");
  });

  it("unknown errors default to retryable=true", () => {
    const err = mapHttpError(418, errorBody("teapot"), "unknown");
    expect(err.retryable).toBe(true);
  });

  it("uses message classification for unknown status codes", () => {
    const err = mapHttpError(
      418,
      errorBody("resource does not exist"),
      "unknown",
    );
    expect(err).toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Tests: provider field
// ---------------------------------------------------------------------------

describe("mapHttpError — provider field", () => {
  it("carries the provider name on the error", () => {
    const err = mapHttpError(500, errorBody("oops"), "anthropic");
    expect((err as ProviderError).provider).toBe("anthropic");
  });

  it("carries status_code on the error", () => {
    const err = mapHttpError(429, errorBody("slow down"), "openai");
    expect((err as ProviderError).status_code).toBe(429);
  });

  it("carries raw body on the error", () => {
    const body = errorBody("failure");
    const err = mapHttpError(500, body, "openai");
    expect((err as ProviderError).raw).toEqual(body);
  });
});
