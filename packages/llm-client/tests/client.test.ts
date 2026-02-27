import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { Client } from "../src/client.js";
import type { Middleware, StreamMiddleware } from "../src/client.js";
import type { ProviderAdapter } from "../src/providers/adapter.js";
import type { Request } from "../src/types/request.js";
import type { Response } from "../src/types/response.js";
import type { StreamEvent } from "../src/types/stream.js";
import { ConfigurationError } from "../src/types/errors.js";
import { Role, ContentKind } from "../src/types/enums.js";
import { Usage } from "../src/types/response.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAdapter(name: string): ProviderAdapter & {
  complete: ReturnType<typeof vi.fn>;
  stream: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const mockResponse: Response = {
    id: `resp-${name}`,
    model: "test-model",
    provider: name,
    message: {
      role: Role.ASSISTANT,
      content: [{ kind: ContentKind.TEXT, text: `Hello from ${name}` }],
    },
    finish_reason: { reason: "stop" },
    usage: new Usage({ input_tokens: 10, output_tokens: 5 }),
  };

  return {
    name,
    complete: vi.fn().mockResolvedValue(mockResponse),
    stream: vi.fn().mockImplementation(async function* () {
      yield {
        type: "text_delta",
        delta: `chunk from ${name}`,
      } as StreamEvent;
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createRequest(overrides?: Partial<Request>): Request {
  return {
    model: "test-model",
    messages: [
      {
        role: Role.USER,
        content: [{ kind: ContentKind.TEXT, text: "Hello" }],
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Client", () => {
  describe("provider routing", () => {
    it("routes to the provider specified in request.provider", async () => {
      const alpha = createMockAdapter("alpha");
      const beta = createMockAdapter("beta");

      const client = new Client({
        providers: { alpha, beta },
        defaultProvider: "alpha",
      });

      const req = createRequest({ provider: "beta" });
      const res = await client.complete(req);

      expect(beta.complete).toHaveBeenCalledWith(req);
      expect(alpha.complete).not.toHaveBeenCalled();
      expect(res.provider).toBe("beta");
    });

    it("routes to the default provider when request.provider is omitted", async () => {
      const alpha = createMockAdapter("alpha");
      const beta = createMockAdapter("beta");

      const client = new Client({
        providers: { alpha, beta },
        defaultProvider: "alpha",
      });

      const req = createRequest();
      const res = await client.complete(req);

      expect(alpha.complete).toHaveBeenCalledWith(req);
      expect(beta.complete).not.toHaveBeenCalled();
      expect(res.provider).toBe("alpha");
    });
  });

  describe("ConfigurationError", () => {
    it("throws when no provider is specified and no default is configured", async () => {
      const client = new Client({ providers: {} });
      const req = createRequest();

      await expect(client.complete(req)).rejects.toThrow(ConfigurationError);
      await expect(client.complete(req)).rejects.toThrow(
        "No provider specified in request and no default provider configured",
      );
    });

    it("throws when the requested provider is not registered", async () => {
      const alpha = createMockAdapter("alpha");
      const client = new Client({
        providers: { alpha },
        defaultProvider: "alpha",
      });

      const req = createRequest({ provider: "unknown" });

      await expect(client.complete(req)).rejects.toThrow(ConfigurationError);
      await expect(client.complete(req)).rejects.toThrow(
        'Provider "unknown" is not registered',
      );
    });

    it("throws for stream() when provider is not found", () => {
      const client = new Client({ providers: {} });
      const req = createRequest();

      expect(() => client.stream(req)).toThrow(ConfigurationError);
    });
  });

  describe("complete()", () => {
    it("calls adapter.complete() and returns the Response", async () => {
      const adapter = createMockAdapter("test");
      const client = new Client({
        providers: { test: adapter },
        defaultProvider: "test",
      });

      const req = createRequest();
      const res = await client.complete(req);

      expect(adapter.complete).toHaveBeenCalledOnce();
      expect(adapter.complete).toHaveBeenCalledWith(req);
      expect(res.id).toBe("resp-test");
      expect(res.provider).toBe("test");
    });
  });

  describe("stream()", () => {
    it("calls adapter.stream() and returns events", async () => {
      const adapter = createMockAdapter("test");
      const client = new Client({
        providers: { test: adapter },
        defaultProvider: "test",
      });

      const req = createRequest();
      const iter = client.stream(req);
      const events: StreamEvent[] = [];
      for await (const event of iter) {
        events.push(event);
      }

      expect(adapter.stream).toHaveBeenCalledOnce();
      expect(events).toHaveLength(1);
      expect(events[0].delta).toBe("chunk from test");
    });
  });

  describe("middleware (onion pattern)", () => {
    it("follows onion pattern: first middleware is outermost", async () => {
      const order: string[] = [];

      const mw1: Middleware = async (req, next) => {
        order.push("mw1-before");
        const res = await next(req);
        order.push("mw1-after");
        return res;
      };

      const mw2: Middleware = async (req, next) => {
        order.push("mw2-before");
        const res = await next(req);
        order.push("mw2-after");
        return res;
      };

      const adapter = createMockAdapter("test");
      adapter.complete.mockImplementation(async () => {
        order.push("adapter");
        return {
          id: "resp",
          model: "m",
          provider: "test",
          message: {
            role: Role.ASSISTANT,
            content: [{ kind: ContentKind.TEXT, text: "ok" }],
          },
          finish_reason: { reason: "stop" },
          usage: new Usage({ input_tokens: 1, output_tokens: 1 }),
        };
      });

      const client = new Client({
        providers: { test: adapter },
        defaultProvider: "test",
        middleware: [mw1, mw2],
      });

      await client.complete(createRequest());

      expect(order).toEqual([
        "mw1-before",
        "mw2-before",
        "adapter",
        "mw2-after",
        "mw1-after",
      ]);
    });

    it("allows middleware to modify the request", async () => {
      const adapter = createMockAdapter("test");

      const addMetadata: Middleware = async (req, next) => {
        const modified: Request = {
          ...req,
          metadata: { ...req.metadata, injected: "true" },
        };
        return next(modified);
      };

      const client = new Client({
        providers: { test: adapter },
        defaultProvider: "test",
        middleware: [addMetadata],
      });

      await client.complete(createRequest());

      const passedRequest = adapter.complete.mock.calls[0][0] as Request;
      expect(passedRequest.metadata).toEqual({ injected: "true" });
    });

    it("applies stream middleware to stream()", async () => {
      const order: string[] = [];
      const adapter = createMockAdapter("test");

      const smw: StreamMiddleware = (req, next) => {
        order.push("smw-wrap");
        const inner = next(req);
        // Return a wrapping async iterator
        return (async function* () {
          order.push("smw-before-yield");
          for await (const event of inner) {
            yield event;
          }
          order.push("smw-after-yield");
        })();
      };

      const client = new Client({
        providers: { test: adapter },
        defaultProvider: "test",
        streamMiddleware: [smw],
      });

      const events: StreamEvent[] = [];
      for await (const event of client.stream(createRequest())) {
        events.push(event);
      }

      expect(order).toContain("smw-wrap");
      expect(order).toContain("smw-before-yield");
      expect(order).toContain("smw-after-yield");
      expect(events).toHaveLength(1);
    });
  });

  describe("fromEnv()", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // Reset env
      process.env = { ...originalEnv };
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
    });

    // Restore after all tests in this describe
    afterAll(() => {
      process.env = originalEnv;
    });

    it("creates a client with Anthropic when ANTHROPIC_API_KEY is set", () => {
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
      const client = Client.fromEnv();

      // Verify it doesn't throw for the default provider
      // We can't directly inspect private fields, but we can verify routing works
      // by checking that it doesn't throw ConfigurationError
      const req = createRequest({ model: "claude-opus-4-6" });
      // The adapter will fail on network, but it should NOT throw ConfigurationError
      expect(() => client.stream(req)).not.toThrow(ConfigurationError);
    });

    it("creates a client with OpenAI when OPENAI_API_KEY is set", () => {
      process.env.OPENAI_API_KEY = "test-openai-key";
      const client = Client.fromEnv();

      const req = createRequest({ model: "gpt-5.2" });
      expect(() => client.stream(req)).not.toThrow(ConfigurationError);
    });

    it("creates a client with Gemini when GEMINI_API_KEY is set", () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      const client = Client.fromEnv();

      const req = createRequest({ model: "gemini-3-pro-preview" });
      expect(() => client.stream(req)).not.toThrow(ConfigurationError);
    });

    it("creates a client with Gemini when GOOGLE_API_KEY is set (fallback)", () => {
      process.env.GOOGLE_API_KEY = "test-google-key";
      const client = Client.fromEnv();

      const req = createRequest({ model: "gemini-3-pro-preview" });
      expect(() => client.stream(req)).not.toThrow(ConfigurationError);
    });

    it("uses the first registered provider as default", () => {
      process.env.OPENAI_API_KEY = "test-openai-key";
      process.env.GEMINI_API_KEY = "test-gemini-key";
      // Anthropic not set, so first should be openai
      const client = Client.fromEnv();

      // Without specifying provider, should route to default (openai)
      const req = createRequest({ model: "gpt-5.2" });
      expect(() => client.stream(req)).not.toThrow(ConfigurationError);
    });

    it("creates a client with no providers when no env vars are set", () => {
      const client = Client.fromEnv();
      const req = createRequest();

      // Should throw because no providers are registered
      expect(() => client.stream(req)).toThrow(ConfigurationError);
    });

    it("registers multiple providers when multiple keys are set", () => {
      process.env.ANTHROPIC_API_KEY = "test-anthropic";
      process.env.OPENAI_API_KEY = "test-openai";

      const client = Client.fromEnv();

      // Can route to both explicitly
      const reqA = createRequest({
        model: "claude-opus-4-6",
        provider: "anthropic",
      });
      const reqO = createRequest({
        model: "gpt-5.2",
        provider: "openai",
      });

      expect(() => client.stream(reqA)).not.toThrow(ConfigurationError);
      expect(() => client.stream(reqO)).not.toThrow(ConfigurationError);
    });
  });

  describe("close()", () => {
    it("calls close() on all registered adapters", async () => {
      const alpha = createMockAdapter("alpha");
      const beta = createMockAdapter("beta");

      const client = new Client({
        providers: { alpha, beta },
        defaultProvider: "alpha",
      });

      await client.close();

      expect(alpha.close).toHaveBeenCalledOnce();
      expect(beta.close).toHaveBeenCalledOnce();
    });

    it("does not throw when adapters have no close method", async () => {
      const adapter: ProviderAdapter = {
        name: "minimal",
        complete: vi.fn().mockResolvedValue({}),
        stream: vi.fn(),
      };

      const client = new Client({
        providers: { minimal: adapter },
        defaultProvider: "minimal",
      });

      await expect(client.close()).resolves.toBeUndefined();
    });
  });
});
