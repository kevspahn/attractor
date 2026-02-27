import { describe, it, expect, vi, beforeEach } from "vitest";
import { generate, executeTools } from "../src/generate.js";
import type { GenerateOptions, StepResult } from "../src/generate.js";
import { Client } from "../src/client.js";
import type { ProviderAdapter } from "../src/providers/adapter.js";
import type { Request } from "../src/types/request.js";
import type { Response } from "../src/types/response.js";
import type { StreamEvent } from "../src/types/stream.js";
import type { Tool, ToolCall } from "../src/types/tool.js";
import { Role, ContentKind } from "../src/types/enums.js";
import { Usage } from "../src/types/response.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
  overrides?: Partial<Response>,
): Response {
  return {
    id: "resp-tc",
    model: "test-model",
    provider: "test",
    message: {
      role: Role.ASSISTANT,
      content: toolCalls.map((tc) => ({
        kind: ContentKind.TOOL_CALL as const,
        tool_call: {
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        },
      })),
    },
    finish_reason: { reason: "tool_calls" },
    usage: new Usage({ input_tokens: 15, output_tokens: 10 }),
    ...overrides,
  };
}

function createMockClient(
  completeFn: ReturnType<typeof vi.fn>,
): Client {
  const adapter: ProviderAdapter = {
    name: "test",
    complete: completeFn,
    stream: vi.fn(),
  };
  return new Client({
    providers: { test: adapter },
    defaultProvider: "test",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generate()", () => {
  describe("prompt standardization", () => {
    it("converts prompt to a single user message", async () => {
      const completeFn = vi
        .fn()
        .mockResolvedValue(makeTextResponse("Hello!"));
      const client = createMockClient(completeFn);

      await generate({
        model: "test-model",
        prompt: "Say hello",
        client,
      });

      const request = completeFn.mock.calls[0][0] as Request;
      expect(request.messages).toHaveLength(1);
      expect(request.messages[0].role).toBe(Role.USER);
      expect(request.messages[0].content[0]).toEqual({
        kind: ContentKind.TEXT,
        text: "Say hello",
      });
    });

    it("passes messages through unchanged", async () => {
      const completeFn = vi
        .fn()
        .mockResolvedValue(makeTextResponse("Hello!"));
      const client = createMockClient(completeFn);

      const msgs = [
        {
          role: Role.USER as const,
          content: [{ kind: ContentKind.TEXT as const, text: "First" }],
        },
        {
          role: Role.ASSISTANT as const,
          content: [{ kind: ContentKind.TEXT as const, text: "Response" }],
        },
        {
          role: Role.USER as const,
          content: [{ kind: ContentKind.TEXT as const, text: "Second" }],
        },
      ];

      await generate({
        model: "test-model",
        messages: msgs,
        client,
      });

      const request = completeFn.mock.calls[0][0] as Request;
      expect(request.messages).toHaveLength(3);
      expect(request.messages[0].content[0]).toEqual({
        kind: ContentKind.TEXT,
        text: "First",
      });
    });

    it("throws when both prompt and messages are provided", async () => {
      const completeFn = vi.fn();
      const client = createMockClient(completeFn);

      await expect(
        generate({
          model: "test-model",
          prompt: "Hello",
          messages: [
            {
              role: Role.USER,
              content: [{ kind: ContentKind.TEXT, text: "Hello" }],
            },
          ],
          client,
        }),
      ).rejects.toThrow(
        'Cannot specify both "prompt" and "messages"',
      );
    });

    it("prepends system message when provided", async () => {
      const completeFn = vi
        .fn()
        .mockResolvedValue(makeTextResponse("Hi"));
      const client = createMockClient(completeFn);

      await generate({
        model: "test-model",
        prompt: "Hello",
        system: "You are helpful",
        client,
      });

      const request = completeFn.mock.calls[0][0] as Request;
      expect(request.messages).toHaveLength(2);
      expect(request.messages[0].role).toBe(Role.SYSTEM);
      expect(request.messages[0].content[0]).toEqual({
        kind: ContentKind.TEXT,
        text: "You are helpful",
      });
      expect(request.messages[1].role).toBe(Role.USER);
    });
  });

  describe("simple generation (no tools)", () => {
    it("returns text from a simple completion", async () => {
      const completeFn = vi
        .fn()
        .mockResolvedValue(makeTextResponse("The answer is 42."));
      const client = createMockClient(completeFn);

      const result = await generate({
        model: "test-model",
        prompt: "What is the answer?",
        client,
      });

      expect(result.text).toBe("The answer is 42.");
      expect(result.toolCalls).toEqual([]);
      expect(result.toolResults).toEqual([]);
      expect(result.finishReason.reason).toBe("stop");
      expect(result.steps).toHaveLength(1);
      expect(result.usage.input_tokens).toBe(10);
      expect(result.usage.output_tokens).toBe(5);
      expect(result.totalUsage.input_tokens).toBe(10);
      expect(result.totalUsage.output_tokens).toBe(5);
    });
  });

  describe("tool execution loop", () => {
    it("executes a tool and makes a follow-up call", async () => {
      const toolCallResp = makeToolCallResponse([
        { id: "tc-1", name: "get_weather", arguments: { city: "NYC" } },
      ]);
      const finalResp = makeTextResponse("It's sunny in NYC!", {
        usage: new Usage({ input_tokens: 20, output_tokens: 8 }),
      });

      const completeFn = vi
        .fn()
        .mockResolvedValueOnce(toolCallResp)
        .mockResolvedValueOnce(finalResp);
      const client = createMockClient(completeFn);

      const weatherTool: Tool = {
        name: "get_weather",
        description: "Get the weather",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
        },
        execute: vi.fn().mockResolvedValue("Sunny, 72F"),
      };

      const result = await generate({
        model: "test-model",
        prompt: "What's the weather in NYC?",
        tools: [weatherTool],
        client,
      });

      // Tool should have been executed
      expect(weatherTool.execute).toHaveBeenCalledWith({ city: "NYC" });

      // Final result should be from the second LLM call
      expect(result.text).toBe("It's sunny in NYC!");
      expect(result.steps).toHaveLength(2);

      // First step had tool calls
      expect(result.steps[0].toolCalls).toHaveLength(1);
      expect(result.steps[0].toolCalls[0].name).toBe("get_weather");
      expect(result.steps[0].toolResults).toHaveLength(1);
      expect(result.steps[0].toolResults[0].content).toBe("Sunny, 72F");
      expect(result.steps[0].toolResults[0].is_error).toBe(false);

      // Second step is the final text
      expect(result.steps[1].toolCalls).toEqual([]);

      // LLM was called twice
      expect(completeFn).toHaveBeenCalledTimes(2);

      // Second call should include tool result messages
      const secondReq = completeFn.mock.calls[1][0] as Request;
      // Should have: user msg + assistant (tool call) msg + tool result msg
      expect(secondReq.messages.length).toBeGreaterThanOrEqual(3);
    });

    it("executes multiple tools concurrently", async () => {
      const executionOrder: string[] = [];

      const toolCallResp = makeToolCallResponse([
        { id: "tc-1", name: "tool_a", arguments: { x: 1 } },
        { id: "tc-2", name: "tool_b", arguments: { y: 2 } },
      ]);
      const finalResp = makeTextResponse("Done!");

      const completeFn = vi
        .fn()
        .mockResolvedValueOnce(toolCallResp)
        .mockResolvedValueOnce(finalResp);
      const client = createMockClient(completeFn);

      const tools: Tool[] = [
        {
          name: "tool_a",
          description: "Tool A",
          parameters: { type: "object", properties: {} },
          execute: vi.fn().mockImplementation(async () => {
            executionOrder.push("a_start");
            await new Promise((r) => setTimeout(r, 10));
            executionOrder.push("a_end");
            return "result_a";
          }),
        },
        {
          name: "tool_b",
          description: "Tool B",
          parameters: { type: "object", properties: {} },
          execute: vi.fn().mockImplementation(async () => {
            executionOrder.push("b_start");
            await new Promise((r) => setTimeout(r, 10));
            executionOrder.push("b_end");
            return "result_b";
          }),
        },
      ];

      const result = await generate({
        model: "test-model",
        prompt: "Use both tools",
        tools,
        client,
      });

      // Both tools executed
      expect(tools[0].execute).toHaveBeenCalled();
      expect(tools[1].execute).toHaveBeenCalled();

      // They ran concurrently (both started before either ended)
      expect(executionOrder[0]).toBe("a_start");
      expect(executionOrder[1]).toBe("b_start");

      expect(result.text).toBe("Done!");
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].toolResults).toHaveLength(2);
    });

    it("handles tool execution errors gracefully", async () => {
      const toolCallResp = makeToolCallResponse([
        { id: "tc-1", name: "failing_tool", arguments: {} },
      ]);
      const finalResp = makeTextResponse("Sorry, tool failed");

      const completeFn = vi
        .fn()
        .mockResolvedValueOnce(toolCallResp)
        .mockResolvedValueOnce(finalResp);
      const client = createMockClient(completeFn);

      const tools: Tool[] = [
        {
          name: "failing_tool",
          description: "Will fail",
          parameters: { type: "object", properties: {} },
          execute: vi.fn().mockRejectedValue(new Error("Boom!")),
        },
      ];

      const result = await generate({
        model: "test-model",
        prompt: "Try the tool",
        tools,
        client,
      });

      // Error was caught and sent as error result
      expect(result.steps[0].toolResults[0].is_error).toBe(true);
      expect(result.steps[0].toolResults[0].content).toContain("Boom!");

      // LLM was still called a second time with the error result
      expect(completeFn).toHaveBeenCalledTimes(2);
      expect(result.text).toBe("Sorry, tool failed");
    });

    it("returns error result for unknown tools", async () => {
      const toolCallResp = makeToolCallResponse([
        { id: "tc-1", name: "nonexistent_tool", arguments: {} },
      ]);
      const finalResp = makeTextResponse("Unknown tool response");

      const completeFn = vi
        .fn()
        .mockResolvedValueOnce(toolCallResp)
        .mockResolvedValueOnce(finalResp);
      const client = createMockClient(completeFn);

      const tools: Tool[] = [
        {
          name: "known_tool",
          description: "Known",
          parameters: { type: "object", properties: {} },
          execute: vi.fn(),
        },
      ];

      const result = await generate({
        model: "test-model",
        prompt: "Call unknown tool",
        tools,
        client,
      });

      expect(result.steps[0].toolResults[0].is_error).toBe(true);
      expect(result.steps[0].toolResults[0].content).toContain(
        "Unknown tool: nonexistent_tool",
      );
    });
  });

  describe("maxToolRounds", () => {
    it("maxToolRounds=0 means no automatic execution", async () => {
      const toolCallResp = makeToolCallResponse([
        { id: "tc-1", name: "tool_a", arguments: {} },
      ]);

      const completeFn = vi.fn().mockResolvedValue(toolCallResp);
      const client = createMockClient(completeFn);

      const tools: Tool[] = [
        {
          name: "tool_a",
          description: "Tool A",
          parameters: { type: "object", properties: {} },
          execute: vi.fn().mockResolvedValue("result"),
        },
      ];

      const result = await generate({
        model: "test-model",
        prompt: "Use tool",
        tools,
        maxToolRounds: 0,
        client,
      });

      // Tool should NOT have been executed
      expect(tools[0].execute).not.toHaveBeenCalled();
      // LLM was only called once
      expect(completeFn).toHaveBeenCalledTimes(1);
      // Result still has tool calls (just not executed)
      expect(result.toolCalls).toHaveLength(1);
      expect(result.steps).toHaveLength(1);
    });

    it("maxToolRounds=1 allows one round of tool execution", async () => {
      // Tool calls on every response
      const toolCallResp = makeToolCallResponse([
        { id: "tc-1", name: "tool_a", arguments: {} },
      ]);

      const completeFn = vi.fn().mockResolvedValue(toolCallResp);
      const client = createMockClient(completeFn);

      const tools: Tool[] = [
        {
          name: "tool_a",
          description: "Tool A",
          parameters: { type: "object", properties: {} },
          execute: vi.fn().mockResolvedValue("result"),
        },
      ];

      const result = await generate({
        model: "test-model",
        prompt: "Use tool",
        maxToolRounds: 1,
        tools,
        client,
      });

      // LLM was called twice: initial + 1 follow-up
      expect(completeFn).toHaveBeenCalledTimes(2);
      // Tool was executed once (during the first round)
      expect(tools[0].execute).toHaveBeenCalledTimes(1);
      // 2 steps recorded
      expect(result.steps).toHaveLength(2);
    });
  });

  describe("stopWhen", () => {
    it("stops the tool loop early when stopWhen returns true", async () => {
      const toolCallResp = makeToolCallResponse([
        { id: "tc-1", name: "tool_a", arguments: {} },
      ]);

      const completeFn = vi.fn().mockResolvedValue(toolCallResp);
      const client = createMockClient(completeFn);

      const tools: Tool[] = [
        {
          name: "tool_a",
          description: "Tool A",
          parameters: { type: "object", properties: {} },
          execute: vi.fn().mockResolvedValue("result"),
        },
      ];

      const result = await generate({
        model: "test-model",
        prompt: "Use tool",
        tools,
        maxToolRounds: 10,
        stopWhen: (steps: StepResult[]) => steps.length >= 1,
        client,
      });

      // Only one LLM call + tool execution, then stopped
      expect(completeFn).toHaveBeenCalledTimes(1);
      expect(result.steps).toHaveLength(1);
    });
  });

  describe("usage aggregation", () => {
    it("aggregates usage across multiple steps", async () => {
      const toolCallResp = makeToolCallResponse(
        [{ id: "tc-1", name: "tool_a", arguments: {} }],
        { usage: new Usage({ input_tokens: 10, output_tokens: 5 }) },
      );
      const finalResp = makeTextResponse("Done!", {
        usage: new Usage({ input_tokens: 20, output_tokens: 8 }),
      });

      const completeFn = vi
        .fn()
        .mockResolvedValueOnce(toolCallResp)
        .mockResolvedValueOnce(finalResp);
      const client = createMockClient(completeFn);

      const tools: Tool[] = [
        {
          name: "tool_a",
          description: "Tool A",
          parameters: { type: "object", properties: {} },
          execute: vi.fn().mockResolvedValue("r"),
        },
      ];

      const result = await generate({
        model: "test-model",
        prompt: "Go",
        tools,
        client,
      });

      // Final step usage
      expect(result.usage.input_tokens).toBe(20);
      expect(result.usage.output_tokens).toBe(8);

      // Total aggregated usage
      expect(result.totalUsage.input_tokens).toBe(30); // 10 + 20
      expect(result.totalUsage.output_tokens).toBe(13); // 5 + 8
      expect(result.totalUsage.total_tokens).toBe(43);
    });
  });

  describe("step tracking", () => {
    it("records each step with correct data", async () => {
      const toolCallResp = makeToolCallResponse([
        { id: "tc-1", name: "get_time", arguments: {} },
      ]);
      const finalResp = makeTextResponse("The time is now.", {
        id: "resp-final",
      });

      const completeFn = vi
        .fn()
        .mockResolvedValueOnce(toolCallResp)
        .mockResolvedValueOnce(finalResp);
      const client = createMockClient(completeFn);

      const tools: Tool[] = [
        {
          name: "get_time",
          description: "Get current time",
          parameters: { type: "object", properties: {} },
          execute: vi.fn().mockResolvedValue("12:00 PM"),
        },
      ];

      const result = await generate({
        model: "test-model",
        prompt: "What time is it?",
        tools,
        client,
      });

      expect(result.steps).toHaveLength(2);

      // Step 1: tool call
      const step1 = result.steps[0];
      expect(step1.toolCalls).toHaveLength(1);
      expect(step1.toolCalls[0].name).toBe("get_time");
      expect(step1.toolResults).toHaveLength(1);
      expect(step1.toolResults[0].content).toBe("12:00 PM");
      expect(step1.finishReason.reason).toBe("tool_calls");

      // Step 2: final text
      const step2 = result.steps[1];
      expect(step2.text).toBe("The time is now.");
      expect(step2.toolCalls).toEqual([]);
      expect(step2.toolResults).toEqual([]);
      expect(step2.finishReason.reason).toBe("stop");
      expect(step2.response.id).toBe("resp-final");
    });
  });
});

describe("executeTools()", () => {
  it("executes tools and returns results", async () => {
    const tools: Tool[] = [
      {
        name: "add",
        description: "Add numbers",
        parameters: { type: "object", properties: {} },
        execute: vi
          .fn()
          .mockImplementation(
            (args: Record<string, unknown>) =>
              (args.a as number) + (args.b as number),
          ),
      },
    ];

    const toolCalls: ToolCall[] = [
      { id: "tc-1", name: "add", arguments: { a: 2, b: 3 } },
    ];

    const results = await executeTools(tools, toolCalls);

    expect(results).toHaveLength(1);
    expect(results[0].tool_call_id).toBe("tc-1");
    expect(results[0].content).toBe("5");
    expect(results[0].is_error).toBe(false);
  });

  it("returns string content directly without JSON.stringify", async () => {
    const tools: Tool[] = [
      {
        name: "greet",
        description: "Greet",
        parameters: { type: "object", properties: {} },
        execute: vi.fn().mockResolvedValue("Hello, world!"),
      },
    ];

    const results = await executeTools(tools, [
      { id: "tc-1", name: "greet", arguments: {} },
    ]);

    expect(results[0].content).toBe("Hello, world!");
  });

  it("JSON stringifies non-string results", async () => {
    const tools: Tool[] = [
      {
        name: "get_data",
        description: "Get data",
        parameters: { type: "object", properties: {} },
        execute: vi.fn().mockResolvedValue({ key: "value" }),
      },
    ];

    const results = await executeTools(tools, [
      { id: "tc-1", name: "get_data", arguments: {} },
    ]);

    expect(results[0].content).toBe('{"key":"value"}');
  });

  it("returns error result for unknown tool", async () => {
    const tools: Tool[] = [];

    const results = await executeTools(tools, [
      { id: "tc-1", name: "unknown", arguments: {} },
    ]);

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("Unknown tool: unknown");
  });

  it("catches tool execution errors", async () => {
    const tools: Tool[] = [
      {
        name: "boom",
        description: "Boom",
        parameters: { type: "object", properties: {} },
        execute: vi.fn().mockRejectedValue(new Error("Kaboom!")),
      },
    ];

    const results = await executeTools(tools, [
      { id: "tc-1", name: "boom", arguments: {} },
    ]);

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("Kaboom!");
  });
});
