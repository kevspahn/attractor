/**
 * Thin HTTP wrapper around the native `fetch` API.
 *
 * Provides JSON-oriented helpers for POST requests (used by all LLM provider
 * adapters) and a streaming variant that returns the raw ReadableStream.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Resolved response from a non-streaming HTTP request. */
export interface HttpResponse {
  status: number;
  headers: Headers;
  /** Parsed JSON body (or `undefined` if response was not valid JSON). */
  body: unknown;
  /** Raw response text. */
  text: string;
}

/** Resolved response from a streaming HTTP request. */
export interface HttpStreamResponse {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array>;
}

/** Options shared by both `httpPost` and `httpStream`. */
export interface HttpRequestOptions {
  /** Request timeout in milliseconds. Combined with any user-provided signal. */
  timeout?: number;
  /** Optional caller-provided abort signal. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Merge multiple header objects. Later entries override earlier ones.
 * A `Content-Type: application/json` default is always present unless
 * explicitly overridden.
 */
export function mergeHeaders(
  ...headerSets: Array<Record<string, string> | undefined>
): Record<string, string> {
  const merged: Record<string, string> = {
    "Content-Type": "application/json",
  };
  for (const set of headerSets) {
    if (set) {
      for (const [key, value] of Object.entries(set)) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

/**
 * Build a combined `AbortSignal` from an optional user signal and an
 * optional timeout value.  Returns `undefined` when neither is provided.
 */
function buildSignal(
  options?: HttpRequestOptions,
): AbortSignal | undefined {
  const signals: AbortSignal[] = [];

  if (options?.signal) {
    signals.push(options.signal);
  }

  if (options?.timeout != null && options.timeout > 0) {
    signals.push(AbortSignal.timeout(options.timeout));
  }

  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];

  // Combine multiple signals with AbortSignal.any (available in modern runtimes)
  return AbortSignal.any(signals);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a JSON POST request and return the parsed response.
 *
 * On non-2xx status codes the promise still resolves -- it is the caller's
 * responsibility to inspect `status` and throw an appropriate error.  This
 * keeps the HTTP layer thin and pushes error semantics to the error-mapping
 * utility.
 *
 * @throws {Error} On network-level failures (DNS, connection refused, etc.)
 *   or when the request is aborted/times out.
 */
export async function httpPost(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  options?: HttpRequestOptions,
): Promise<HttpResponse> {
  const merged = mergeHeaders(headers);
  const signal = buildSignal(options);

  const res = await fetch(url, {
    method: "POST",
    headers: merged,
    body: JSON.stringify(body),
    signal,
  });

  const text = await res.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  return {
    status: res.status,
    headers: res.headers,
    body: parsed,
    text,
  };
}

/**
 * Send a JSON POST request and return a streaming response.
 *
 * The caller is responsible for consuming and closing the stream.
 *
 * @throws {Error} On network-level failures or abort/timeout before any
 *   data arrives.
 */
export async function httpStream(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  options?: HttpRequestOptions,
): Promise<HttpStreamResponse> {
  const merged = mergeHeaders(headers);
  const signal = buildSignal(options);

  const res = await fetch(url, {
    method: "POST",
    headers: merged,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.body) {
    throw new Error("Response body is null -- streaming not supported");
  }

  return {
    status: res.status,
    headers: res.headers,
    body: res.body,
  };
}
