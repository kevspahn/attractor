import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { httpPost, httpStream, mergeHeaders } from "../src/utils/http.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock Response. */
function mockResponse(init: {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  stream?: ReadableStream<Uint8Array>;
}): Response {
  const { status = 200, body = "", headers = {}, stream } = init;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
    body: stream ?? null,
  } as unknown as Response;
}

describe("mergeHeaders", () => {
  it("sets Content-Type: application/json by default", () => {
    const result = mergeHeaders();
    expect(result["Content-Type"]).toBe("application/json");
  });

  it("merges multiple header objects, later overriding earlier", () => {
    const result = mergeHeaders(
      { Authorization: "Bearer abc", "X-Custom": "first" },
      { "X-Custom": "second", "X-New": "value" },
    );
    expect(result).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer abc",
      "X-Custom": "second",
      "X-New": "value",
    });
  });

  it("allows overriding Content-Type", () => {
    const result = mergeHeaders({ "Content-Type": "text/plain" });
    expect(result["Content-Type"]).toBe("text/plain");
  });

  it("ignores undefined header sets", () => {
    const result = mergeHeaders(undefined, { "X-Key": "val" }, undefined);
    expect(result).toEqual({
      "Content-Type": "application/json",
      "X-Key": "val",
    });
  });
});

describe("httpPost", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends a JSON POST and parses a JSON response", async () => {
    const mockFn = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        mockResponse({
          status: 200,
          body: '{"result":"ok"}',
          headers: { "x-request-id": "123" },
        }),
      );
    vi.stubGlobal("fetch", mockFn);

    const result = await httpPost(
      "https://api.example.com/v1/chat",
      { model: "gpt-4", messages: [] },
      { Authorization: "Bearer sk-test" },
    );

    // Verify the fetch call.
    expect(mockFn).toHaveBeenCalledOnce();
    const [url, init] = mockFn.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/chat");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({ model: "gpt-4", messages: [] }),
    );
    // Default Content-Type should be merged in.
    const sentHeaders = init?.headers as Record<string, string>;
    expect(sentHeaders["Content-Type"]).toBe("application/json");
    expect(sentHeaders["Authorization"]).toBe("Bearer sk-test");

    // Verify the result.
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ result: "ok" });
    expect(result.text).toBe('{"result":"ok"}');
    expect(result.headers.get("x-request-id")).toBe("123");
  });

  it("returns undefined body for non-JSON response text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse({ status: 200, body: "not json" }),
      ),
    );

    const result = await httpPost("https://example.com", {}, {});
    expect(result.body).toBeUndefined();
    expect(result.text).toBe("not json");
  });

  it("resolves on non-2xx status (does not throw)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse({
          status: 429,
          body: '{"error":{"message":"rate limited"}}',
          headers: { "retry-after": "5" },
        }),
      ),
    );

    const result = await httpPost("https://example.com", {}, {});
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: { message: "rate limited" } });
    expect(result.headers.get("retry-after")).toBe("5");
  });

  it("passes timeout option via AbortSignal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse({ status: 200, body: '{"ok":true}' }),
      ),
    );

    // Just verify it doesn't throw; full timeout behavior relies on the
    // runtime's AbortSignal.timeout implementation.
    const result = await httpPost(
      "https://example.com",
      {},
      {},
      { timeout: 5000 },
    );
    expect(result.status).toBe(200);
  });

  it("propagates network errors from fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    await expect(httpPost("https://example.com", {}, {})).rejects.toThrow(
      "Failed to fetch",
    );
  });
});

describe("httpStream", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns a streaming response", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk1"));
        controller.close();
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse({ status: 200, stream }),
      ),
    );

    const result = await httpStream("https://example.com", {}, {});
    expect(result.status).toBe(200);
    expect(result.body).toBeInstanceOf(ReadableStream);

    // Read the stream to verify data.
    const reader = result.body.getReader();
    const { value, done } = await reader.read();
    expect(done).toBe(false);
    expect(new TextDecoder().decode(value)).toBe("chunk1");
    const final = await reader.read();
    expect(final.done).toBe(true);
  });

  it("throws if response body is null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse({ status: 200 }), // no stream
      ),
    );

    await expect(httpStream("https://example.com", {}, {})).rejects.toThrow(
      "Response body is null",
    );
  });
});
