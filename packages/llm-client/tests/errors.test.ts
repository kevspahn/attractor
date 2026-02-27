import { describe, it, expect } from "vitest";
import {
  SDKError,
  ProviderError,
  AuthenticationError,
  AccessDeniedError,
  NotFoundError,
  InvalidRequestError,
  RateLimitError,
  ServerError,
  ContentFilterError,
  ContextLengthError,
  QuotaExceededError,
  RequestTimeoutError,
  AbortError,
  NetworkError,
  StreamError,
  InvalidToolCallError,
  NoObjectGeneratedError,
  ConfigurationError,
} from "../src/types/errors.js";

describe("SDKError", () => {
  it("is an instance of Error", () => {
    const err = new SDKError("something went wrong");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SDKError);
    expect(err.message).toBe("something went wrong");
    expect(err.name).toBe("SDKError");
  });

  it("defaults retryable to false", () => {
    const err = new SDKError("oops");
    expect(err.retryable).toBe(false);
  });

  it("accepts a cause", () => {
    const cause = new Error("root cause");
    const err = new SDKError("wrapper", { cause });
    expect(err.cause).toBe(cause);
  });
});

describe("ProviderError", () => {
  it("carries all provider-specific fields", () => {
    const err = new ProviderError("Bad request", {
      provider: "openai",
      status_code: 400,
      error_code: "invalid_request",
      retryable: false,
      retry_after: undefined,
      raw: { error: { message: "Bad request" } },
    });
    expect(err).toBeInstanceOf(SDKError);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.provider).toBe("openai");
    expect(err.status_code).toBe(400);
    expect(err.error_code).toBe("invalid_request");
    expect(err.retryable).toBe(false);
    expect(err.raw).toEqual({ error: { message: "Bad request" } });
  });
});

describe("Non-retryable ProviderError subclasses", () => {
  const nonRetryableClasses = [
    { Cls: AuthenticationError, name: "AuthenticationError" },
    { Cls: AccessDeniedError, name: "AccessDeniedError" },
    { Cls: NotFoundError, name: "NotFoundError" },
    { Cls: InvalidRequestError, name: "InvalidRequestError" },
    { Cls: ContentFilterError, name: "ContentFilterError" },
    { Cls: ContextLengthError, name: "ContextLengthError" },
    { Cls: QuotaExceededError, name: "QuotaExceededError" },
  ] as const;

  for (const { Cls, name } of nonRetryableClasses) {
    it(`${name} has retryable=false and correct name`, () => {
      const err = new Cls("test", { provider: "test" });
      expect(err.retryable).toBe(false);
      expect(err.name).toBe(name);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err).toBeInstanceOf(SDKError);
      expect(err).toBeInstanceOf(Error);
    });
  }
});

describe("Retryable ProviderError subclasses", () => {
  const retryableClasses = [
    { Cls: RateLimitError, name: "RateLimitError" },
    { Cls: ServerError, name: "ServerError" },
  ] as const;

  for (const { Cls, name } of retryableClasses) {
    it(`${name} has retryable=true and correct name`, () => {
      const err = new Cls("test", { provider: "test" });
      expect(err.retryable).toBe(true);
      expect(err.name).toBe(name);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err).toBeInstanceOf(SDKError);
    });
  }
});

describe("RateLimitError", () => {
  it("carries retry_after from provider", () => {
    const err = new RateLimitError("Rate limited", {
      provider: "anthropic",
      status_code: 429,
      retry_after: 30,
    });
    expect(err.retryable).toBe(true);
    expect(err.retry_after).toBe(30);
    expect(err.status_code).toBe(429);
  });
});

describe("Non-provider errors", () => {
  it("RequestTimeoutError is retryable", () => {
    const err = new RequestTimeoutError("timed out");
    expect(err.retryable).toBe(true);
    expect(err.name).toBe("RequestTimeoutError");
    expect(err).toBeInstanceOf(SDKError);
  });

  it("AbortError is not retryable", () => {
    const err = new AbortError("cancelled");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("AbortError");
    expect(err).toBeInstanceOf(SDKError);
  });

  it("NetworkError is retryable", () => {
    const err = new NetworkError("connection refused");
    expect(err.retryable).toBe(true);
    expect(err.name).toBe("NetworkError");
    expect(err).toBeInstanceOf(SDKError);
  });

  it("StreamError is retryable", () => {
    const err = new StreamError("stream broken");
    expect(err.retryable).toBe(true);
    expect(err.name).toBe("StreamError");
    expect(err).toBeInstanceOf(SDKError);
  });

  it("InvalidToolCallError is not retryable", () => {
    const err = new InvalidToolCallError("bad args");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("InvalidToolCallError");
    expect(err).toBeInstanceOf(SDKError);
  });

  it("NoObjectGeneratedError is not retryable", () => {
    const err = new NoObjectGeneratedError("parse failed");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("NoObjectGeneratedError");
    expect(err).toBeInstanceOf(SDKError);
  });

  it("ConfigurationError is not retryable", () => {
    const err = new ConfigurationError("missing provider");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("ConfigurationError");
    expect(err).toBeInstanceOf(SDKError);
  });
});
