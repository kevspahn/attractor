/**
 * Integration smoke tests for @attractor/llm-client.
 *
 * These tests make REAL API calls and are SKIPPED unless the corresponding
 * provider API key is present in the environment. They are intended for
 * CI validation with secrets or local manual runs.
 *
 * Each provider suite covers:
 *   1. Simple text generation (complete())
 *   2. Streaming (stream())
 *   3. Tool calling with a calculator tool
 *   4. Error handling (invalid model name)
 */

import { describe, it, expect } from "vitest";
import { Client } from "../../src/client.js";
import { AnthropicAdapter } from "../../src/providers/anthropic/index.js";
import { OpenAIAdapter } from "../../src/providers/openai/index.js";
import { GeminiAdapter } from "../../src/providers/gemini/index.js";
import {
  Role,
  ContentKind,
  StreamAccumulator,
  getResponseText,
  getResponseToolCalls,
  ProviderError,
  SDKError,
} from "../../src/types/index.js";
import type { Request } from "../../src/types/request.js";
import type { Tool } from "../../src/types/tool.js";

// ---------------------------------------------------------------------------
// Environment variable checks
// ---------------------------------------------------------------------------

const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
const hasGeminiKey =
  !!process.env.GEMINI_API_KEY || !!process.env.GOOGLE_API_KEY;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** A simple calculator tool definition for tool-calling tests. */
const calculatorTool: Tool = {
  name: "calculator",
  description:
    "Evaluate a simple arithmetic expression. Returns the numeric result.",
  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: 'The arithmetic expression to evaluate, e.g. "2 + 3"',
      },
    },
    required: ["expression"],
  },
};

/** Build a minimal user-prompt request. */
function userRequest(
  model: string,
  prompt: string,
  overrides?: Partial<Request>,
): Request {
  return {
    model,
    messages: [
      {
        role: Role.USER,
        content: [{ kind: ContentKind.TEXT, text: prompt }],
      },
    ],
    max_tokens: 256,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

describe.skipIf(!hasAnthropicKey)("Anthropic integration", () => {
  const client = hasAnthropicKey
    ? new Client({
        providers: {
          anthropic: new AnthropicAdapter({
            apiKey: process.env.ANTHROPIC_API_KEY!,
          }),
        },
        defaultProvider: "anthropic",
      })
    : (undefined as unknown as Client);

  it("completes a simple text prompt", async () => {
    const response = await client.complete(
      userRequest("claude-sonnet-4-5-20250514", "Say hello in one word."),
    );
    const text = getResponseText(response);
    expect(text.length).toBeGreaterThan(0);
    expect(response.usage.output_tokens).toBeGreaterThan(0);
  }, 30_000);

  it("streams a response", async () => {
    const events = client.stream(
      userRequest("claude-sonnet-4-5-20250514", "Count from 1 to 3."),
    );
    const acc = new StreamAccumulator();
    for await (const event of events) {
      acc.process(event);
    }
    const text = acc.text;
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/1/);
  }, 30_000);

  it("handles tool calling", async () => {
    const response = await client.complete(
      userRequest(
        "claude-sonnet-4-5-20250514",
        "What is 7 + 15? Use the calculator tool.",
        {
          tools: [calculatorTool],
          tool_choice: { mode: "required" },
        },
      ),
    );
    const toolCalls = getResponseToolCalls(response);
    expect(toolCalls.length).toBeGreaterThan(0);
    expect(toolCalls[0]!.name).toBe("calculator");
  }, 30_000);

  it("returns an error for an invalid model", async () => {
    await expect(
      client.complete(
        userRequest("claude-nonexistent-model-xyz", "Hello"),
      ),
    ).rejects.toThrow();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

describe.skipIf(!hasOpenAIKey)("OpenAI integration", () => {
  const client = hasOpenAIKey
    ? new Client({
        providers: {
          openai: new OpenAIAdapter({
            apiKey: process.env.OPENAI_API_KEY!,
          }),
        },
        defaultProvider: "openai",
      })
    : (undefined as unknown as Client);

  it("completes a simple text prompt", async () => {
    const response = await client.complete(
      userRequest("gpt-4o-mini", "Say hello in one word."),
    );
    const text = getResponseText(response);
    expect(text.length).toBeGreaterThan(0);
    expect(response.usage.output_tokens).toBeGreaterThan(0);
  }, 30_000);

  it("streams a response", async () => {
    const events = client.stream(
      userRequest("gpt-4o-mini", "Count from 1 to 3."),
    );
    const acc = new StreamAccumulator();
    for await (const event of events) {
      acc.process(event);
    }
    expect(acc.text.length).toBeGreaterThan(0);
    expect(acc.text).toMatch(/1/);
  }, 30_000);

  it("handles tool calling", async () => {
    const response = await client.complete(
      userRequest("gpt-4o-mini", "What is 7 + 15? Use the calculator tool.", {
        tools: [calculatorTool],
        tool_choice: { mode: "required" },
      }),
    );
    const toolCalls = getResponseToolCalls(response);
    expect(toolCalls.length).toBeGreaterThan(0);
    expect(toolCalls[0]!.name).toBe("calculator");
  }, 30_000);

  it("returns an error for an invalid model", async () => {
    await expect(
      client.complete(
        userRequest("gpt-nonexistent-model-xyz", "Hello"),
      ),
    ).rejects.toThrow();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

describe.skipIf(!hasGeminiKey)("Gemini integration", () => {
  const geminiKey =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

  const client = hasGeminiKey
    ? new Client({
        providers: {
          gemini: new GeminiAdapter({ apiKey: geminiKey }),
        },
        defaultProvider: "gemini",
      })
    : (undefined as unknown as Client);

  it("completes a simple text prompt", async () => {
    const response = await client.complete(
      userRequest("gemini-2.0-flash", "Say hello in one word."),
    );
    const text = getResponseText(response);
    expect(text.length).toBeGreaterThan(0);
    expect(response.usage.output_tokens).toBeGreaterThan(0);
  }, 30_000);

  it("streams a response", async () => {
    const events = client.stream(
      userRequest("gemini-2.0-flash", "Count from 1 to 3."),
    );
    const acc = new StreamAccumulator();
    for await (const event of events) {
      acc.process(event);
    }
    expect(acc.text.length).toBeGreaterThan(0);
    expect(acc.text).toMatch(/1/);
  }, 30_000);

  it("handles tool calling", async () => {
    const response = await client.complete(
      userRequest(
        "gemini-2.0-flash",
        "What is 7 + 15? Use the calculator tool.",
        {
          tools: [calculatorTool],
          tool_choice: { mode: "required" },
        },
      ),
    );
    const toolCalls = getResponseToolCalls(response);
    expect(toolCalls.length).toBeGreaterThan(0);
    expect(toolCalls[0]!.name).toBe("calculator");
  }, 30_000);

  it("returns an error for an invalid model", async () => {
    await expect(
      client.complete(
        userRequest("gemini-nonexistent-model-xyz", "Hello"),
      ),
    ).rejects.toThrow();
  }, 30_000);
});
