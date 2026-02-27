import { describe, it, expect, vi } from "vitest";
import { generateObject } from "../src/generate-object.js";
import { Client } from "../src/client.js";
import type { ProviderAdapter } from "../src/providers/adapter.js";
import type { Response } from "../src/types/response.js";
import { Role, ContentKind } from "../src/types/enums.js";
import { Usage } from "../src/types/response.js";
import { NoObjectGeneratedError } from "../src/types/errors.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock Client with a single adapter registered under the given
 * provider name. When the tests specify `provider: "openai"` or similar,
 * the client needs to have the adapter registered under that name.
 */
function createMockClient(
  completeFn: ReturnType<typeof vi.fn>,
  providerName = "test",
): Client {
  const adapter: ProviderAdapter = {
    name: providerName,
    complete: completeFn,
    stream: vi.fn(),
  };
  return new Client({
    providers: { [providerName]: adapter },
    defaultProvider: providerName,
  });
}

function makeTextResponse(
  text: string,
  overrides?: Partial<Response>,
): Response {
  return {
    id: "resp-1",
    model: "test-model",
    provider: "test",
    message: {
      role: Role.ASSISTANT,
      content: [{ kind: ContentKind.TEXT, text }],
    },
    finish_reason: { reason: "stop" },
    usage: new Usage({ input_tokens: 10, output_tokens: 5 }),
    ...overrides,
  };
}

function makeToolCallResponse(
  toolCallArgs: Record<string, unknown>,
  overrides?: Partial<Response>,
): Response {
  return {
    id: "resp-tc",
    model: "test-model",
    provider: "test",
    message: {
      role: Role.ASSISTANT,
      content: [
        {
          kind: ContentKind.TOOL_CALL,
          tool_call: {
            id: "tc-extract",
            name: "extract",
            arguments: toolCallArgs,
          },
        },
      ],
    },
    finish_reason: { reason: "tool_calls" },
    usage: new Usage({ input_tokens: 10, output_tokens: 8 }),
    ...overrides,
  };
}

const testSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "number" },
  },
  required: ["name", "age"],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateObject()", () => {
  describe("successful structured output (OpenAI/default)", () => {
    it("parses JSON from text response", async () => {
      const jsonText = JSON.stringify({ name: "Alice", age: 30 });
      const completeFn = vi
        .fn()
        .mockResolvedValue(makeTextResponse(jsonText));
      const client = createMockClient(completeFn, "openai");

      const result = await generateObject({
        model: "gpt-4o",
        prompt: "Extract user info",
        schema: testSchema,
        provider: "openai",
        client,
      });

      expect(result.output).toEqual({ name: "Alice", age: 30 });
      expect(result.text).toBe(jsonText);

      // Verify the request used json_schema response format
      const req = completeFn.mock.calls[0][0];
      expect(req.response_format).toEqual({
        type: "json_schema",
        json_schema: {
          name: "output",
          schema: testSchema,
          strict: true,
        },
      });
    });
  });

  describe("Gemini strategy", () => {
    it("uses json_schema with schema directly", async () => {
      const jsonText = JSON.stringify({ name: "Bob", age: 25 });
      const completeFn = vi
        .fn()
        .mockResolvedValue(makeTextResponse(jsonText));
      const client = createMockClient(completeFn, "gemini");

      const result = await generateObject({
        model: "gemini-pro",
        prompt: "Extract user info",
        schema: testSchema,
        provider: "gemini",
        client,
      });

      expect(result.output).toEqual({ name: "Bob", age: 25 });

      const req = completeFn.mock.calls[0][0];
      expect(req.response_format).toEqual({
        type: "json_schema",
        json_schema: testSchema,
      });
    });
  });

  describe("Anthropic tool extraction strategy", () => {
    it("extracts output from tool call arguments", async () => {
      const completeFn = vi
        .fn()
        .mockResolvedValue(
          makeToolCallResponse({ name: "Charlie", age: 35 }),
        );
      const client = createMockClient(completeFn, "anthropic");

      const result = await generateObject({
        model: "claude-3-sonnet",
        prompt: "Extract user info",
        schema: testSchema,
        provider: "anthropic",
        client,
      });

      expect(result.output).toEqual({ name: "Charlie", age: 35 });

      // Verify the request used tool-based extraction
      const req = completeFn.mock.calls[0][0];
      expect(req.tools).toHaveLength(1);
      expect(req.tools![0].name).toBe("extract");
      expect(req.tools![0].parameters).toEqual(testSchema);
      expect(req.tool_choice).toEqual({
        mode: "named",
        tool_name: "extract",
      });
    });

    it("throws NoObjectGeneratedError when Anthropic does not produce a tool call", async () => {
      const completeFn = vi
        .fn()
        .mockResolvedValue(makeTextResponse("No tool call"));
      const client = createMockClient(completeFn, "anthropic");

      await expect(
        generateObject({
          model: "claude-3-sonnet",
          prompt: "Extract user info",
          schema: testSchema,
          provider: "anthropic",
          client,
        }),
      ).rejects.toThrow(NoObjectGeneratedError);
    });
  });

  describe("error handling", () => {
    it("throws NoObjectGeneratedError when JSON parsing fails", async () => {
      const completeFn = vi
        .fn()
        .mockResolvedValue(makeTextResponse("not valid json {{{"));
      const client = createMockClient(completeFn, "openai");

      await expect(
        generateObject({
          model: "gpt-4o",
          prompt: "Extract user info",
          schema: testSchema,
          provider: "openai",
          client,
        }),
      ).rejects.toThrow(NoObjectGeneratedError);
    });

    it("throws NoObjectGeneratedError when text is empty", async () => {
      const completeFn = vi
        .fn()
        .mockResolvedValue(makeTextResponse(""));
      const client = createMockClient(completeFn, "openai");

      await expect(
        generateObject({
          model: "gpt-4o",
          prompt: "Extract user info",
          schema: testSchema,
          provider: "openai",
          client,
        }),
      ).rejects.toThrow(NoObjectGeneratedError);
    });

    it("error has descriptive message for failed JSON parse", async () => {
      const completeFn = vi
        .fn()
        .mockResolvedValue(makeTextResponse("invalid json"));
      const client = createMockClient(completeFn, "openai");

      try {
        await generateObject({
          model: "gpt-4o",
          prompt: "Extract",
          schema: testSchema,
          provider: "openai",
          client,
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NoObjectGeneratedError);
        expect((err as Error).message).toContain(
          "Failed to parse model output as JSON",
        );
      }
    });
  });

  describe("default strategy", () => {
    it("uses OpenAI strategy when no provider is specified", async () => {
      const jsonText = JSON.stringify({ name: "Default", age: 0 });
      const completeFn = vi
        .fn()
        .mockResolvedValue(makeTextResponse(jsonText));
      const client = createMockClient(completeFn);

      const result = await generateObject({
        model: "some-model",
        prompt: "Extract",
        schema: testSchema,
        client,
      });

      expect(result.output).toEqual({ name: "Default", age: 0 });

      const req = completeFn.mock.calls[0][0];
      expect(req.response_format.type).toBe("json_schema");
      expect(req.response_format.json_schema.name).toBe("output");
    });
  });
});
