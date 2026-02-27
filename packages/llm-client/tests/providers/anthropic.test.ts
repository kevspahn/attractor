import { describe, it, expect } from "vitest";
import {
  Role,
  ContentKind,
  StreamEventType,
  type Request,
  type Message,
  type Tool,
} from "../../src/types/index.js";
import { translateRequest } from "../../src/providers/anthropic/translate-request.js";
import { translateResponse } from "../../src/providers/anthropic/translate-response.js";
import { translateStream } from "../../src/providers/anthropic/stream.js";
import type { SSEEvent } from "../../src/utils/index.js";

// ---------------------------------------------------------------------------
// Helper to create an async iterable from an array of SSE events
// ---------------------------------------------------------------------------

async function* mockSSEStream(events: SSEEvent[]): AsyncIterableIterator<SSEEvent> {
  for (const event of events) {
    yield event;
  }
}

// ===========================================================================
// Request Translation Tests
// ===========================================================================

describe("Anthropic translate-request", () => {
  it("extracts system messages to system parameter", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        {
          role: Role.SYSTEM,
          content: [{ kind: ContentKind.TEXT, text: "You are helpful." }],
        },
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Hello" }],
        },
      ],
    };

    const { body } = translateRequest(request);

    expect(body.system).toBeDefined();
    expect(body.system).toHaveLength(1);
    expect(body.system![0]).toMatchObject({ type: "text", text: "You are helpful." });
    // System should have cache_control injected on last block
    expect((body.system![0] as Record<string, unknown>)["cache_control"]).toEqual({
      type: "ephemeral",
    });
    // Messages should only have the user message
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.role).toBe("user");
  });

  it("merges DEVELOPER messages with system", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        {
          role: Role.SYSTEM,
          content: [{ kind: ContentKind.TEXT, text: "System prompt." }],
        },
        {
          role: Role.DEVELOPER,
          content: [{ kind: ContentKind.TEXT, text: "Developer instructions." }],
        },
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Hello" }],
        },
      ],
    };

    const { body } = translateRequest(request);

    expect(body.system).toHaveLength(2);
    expect(body.system![0]).toMatchObject({ type: "text", text: "System prompt." });
    expect(body.system![1]).toMatchObject({
      type: "text",
      text: "Developer instructions.",
    });
    // cache_control on last system block
    expect((body.system![1] as Record<string, unknown>)["cache_control"]).toEqual({
      type: "ephemeral",
    });
  });

  it("merges consecutive same-role messages for strict alternation", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "First user msg" }],
        },
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Second user msg" }],
        },
        {
          role: Role.ASSISTANT,
          content: [{ kind: ContentKind.TEXT, text: "Response" }],
        },
      ],
    };

    const { body } = translateRequest(request);

    // Two user messages should be merged into one
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]!.role).toBe("user");
    expect(body.messages[0]!.content).toHaveLength(2);
    expect(body.messages[1]!.role).toBe("assistant");
  });

  it("translates TOOL messages as user role with tool_result content", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "What's the weather?" }],
        },
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: ContentKind.TOOL_CALL,
              tool_call: {
                id: "call_1",
                name: "get_weather",
                arguments: { city: "SF" },
              },
            },
          ],
        },
        {
          role: Role.TOOL,
          content: [
            {
              kind: ContentKind.TOOL_RESULT,
              tool_result: {
                tool_call_id: "call_1",
                content: "72F sunny",
                is_error: false,
              },
            },
          ],
          tool_call_id: "call_1",
        },
      ],
    };

    const { body } = translateRequest(request);

    // TOOL message should become a user message with tool_result blocks
    expect(body.messages).toHaveLength(3);
    // Tool message becomes user role
    expect(body.messages[2]!.role).toBe("user");
    expect(body.messages[2]!.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "call_1",
      content: "72F sunny",
    });
  });

  it("preserves thinking blocks", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Solve this" }],
        },
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: ContentKind.THINKING,
              thinking: {
                text: "Let me think...",
                signature: "sig_abc",
                redacted: false,
              },
            },
            { kind: ContentKind.TEXT, text: "The answer is 42." },
          ],
        },
      ],
    };

    const { body } = translateRequest(request);

    const assistantMsg = body.messages[1]!;
    expect(assistantMsg.content).toHaveLength(2);
    expect(assistantMsg.content[0]).toMatchObject({
      type: "thinking",
      thinking: "Let me think...",
      signature: "sig_abc",
    });
    expect(assistantMsg.content[1]).toMatchObject({
      type: "text",
      text: "The answer is 42.",
    });
  });

  it("preserves redacted thinking blocks", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Continue" }],
        },
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: ContentKind.REDACTED_THINKING,
              thinking: {
                text: "opaque_data_here",
                redacted: true,
              },
            },
          ],
        },
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Next question" }],
        },
      ],
    };

    const { body } = translateRequest(request);

    const assistantMsg = body.messages[1]!;
    expect(assistantMsg.content[0]).toMatchObject({
      type: "redacted_thinking",
      data: "opaque_data_here",
    });
  });

  it("injects cache_control on tool definitions", () => {
    const tools: Tool[] = [
      {
        name: "tool_a",
        description: "Tool A",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "tool_b",
        description: "Tool B",
        parameters: { type: "object", properties: {} },
      },
    ];

    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Hi" }],
        },
      ],
      tools,
    };

    const { body } = translateRequest(request);

    // cache_control should be on the last tool definition
    expect(body.tools).toHaveLength(2);
    expect(body.tools![0]!.cache_control).toBeUndefined();
    expect(body.tools![1]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("translates tool choice modes correctly", () => {
    const baseRequest: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: ContentKind.TEXT, text: "Hi" }] },
      ],
      tools: [
        {
          name: "my_tool",
          description: "desc",
          parameters: { type: "object", properties: {} },
        },
      ],
    };

    // auto
    const { body: autoBody } = translateRequest({
      ...baseRequest,
      tool_choice: { mode: "auto" },
    });
    expect(autoBody.tool_choice).toEqual({ type: "auto" });

    // none - should omit tools entirely
    const { body: noneBody } = translateRequest({
      ...baseRequest,
      tool_choice: { mode: "none" },
    });
    expect(noneBody.tools).toBeUndefined();

    // required
    const { body: requiredBody } = translateRequest({
      ...baseRequest,
      tool_choice: { mode: "required" },
    });
    expect(requiredBody.tool_choice).toEqual({ type: "any" });

    // named
    const { body: namedBody } = translateRequest({
      ...baseRequest,
      tool_choice: { mode: "named", tool_name: "my_tool" },
    });
    expect(namedBody.tool_choice).toEqual({ type: "tool", name: "my_tool" });
  });

  it("defaults max_tokens to 4096", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: ContentKind.TEXT, text: "Hi" }] },
      ],
    };

    const { body } = translateRequest(request);
    expect(body.max_tokens).toBe(4096);
  });

  it("uses provided max_tokens", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: ContentKind.TEXT, text: "Hi" }] },
      ],
      max_tokens: 8192,
    };

    const { body } = translateRequest(request);
    expect(body.max_tokens).toBe(8192);
  });

  it("passes beta headers from provider_options", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: ContentKind.TEXT, text: "Hi" }] },
      ],
      provider_options: {
        anthropic: {
          beta_headers: [
            "interleaved-thinking-2025-05-14",
            "token-efficient-tools-2025-02-19",
          ],
        },
      },
    };

    const { extraHeaders } = translateRequest(request);
    expect(extraHeaders["anthropic-beta"]).toBe(
      "interleaved-thinking-2025-05-14,token-efficient-tools-2025-02-19",
    );
  });

  it("passes thinking config from provider_options", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        { role: Role.USER, content: [{ kind: ContentKind.TEXT, text: "Hi" }] },
      ],
      provider_options: {
        anthropic: {
          thinking: { type: "enabled", budget_tokens: 10000 },
        },
      },
    };

    const { body } = translateRequest(request);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
  });

  it("translates image content parts (URL)", () => {
    const request: Request = {
      model: "claude-opus-4-6",
      messages: [
        {
          role: Role.USER,
          content: [
            { kind: ContentKind.TEXT, text: "What is this?" },
            {
              kind: ContentKind.IMAGE,
              image: { url: "https://example.com/img.png" },
            },
          ],
        },
      ],
    };

    const { body } = translateRequest(request);

    expect(body.messages[0]!.content[1]).toMatchObject({
      type: "image",
      source: { type: "url", url: "https://example.com/img.png" },
    });
  });
});

// ===========================================================================
// Response Translation Tests
// ===========================================================================

describe("Anthropic translate-response", () => {
  it("translates text blocks to TEXT content parts", () => {
    const raw = {
      id: "msg_123",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-6",
      content: [{ type: "text", text: "Hello, world!" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
    };

    const response = translateResponse(raw);

    expect(response.id).toBe("msg_123");
    expect(response.model).toBe("claude-opus-4-6");
    expect(response.provider).toBe("anthropic");
    expect(response.message.role).toBe(Role.ASSISTANT);
    expect(response.message.content).toHaveLength(1);
    expect(response.message.content[0]).toMatchObject({
      kind: ContentKind.TEXT,
      text: "Hello, world!",
    });
  });

  it("translates tool_use blocks to TOOL_CALL content parts", () => {
    const raw = {
      id: "msg_456",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-6",
      content: [
        {
          type: "tool_use",
          id: "call_abc",
          name: "get_weather",
          input: { city: "SF" },
        },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 15, output_tokens: 30 },
    };

    const response = translateResponse(raw);

    expect(response.message.content).toHaveLength(1);
    expect(response.message.content[0]).toMatchObject({
      kind: ContentKind.TOOL_CALL,
      tool_call: {
        id: "call_abc",
        name: "get_weather",
        arguments: { city: "SF" },
      },
    });
  });

  it("translates thinking blocks", () => {
    const raw = {
      id: "msg_789",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-6",
      content: [
        { type: "thinking", thinking: "Let me consider...", signature: "sig_xyz" },
        { type: "text", text: "The answer is 42." },
      ],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 20, output_tokens: 50 },
    };

    const response = translateResponse(raw);

    expect(response.message.content).toHaveLength(2);
    expect(response.message.content[0]).toMatchObject({
      kind: ContentKind.THINKING,
      thinking: {
        text: "Let me consider...",
        signature: "sig_xyz",
        redacted: false,
      },
    });
    expect(response.message.content[1]).toMatchObject({
      kind: ContentKind.TEXT,
      text: "The answer is 42.",
    });
  });

  it("translates redacted_thinking blocks", () => {
    const raw = {
      id: "msg_red",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-6",
      content: [
        { type: "redacted_thinking", data: "opaque_data" },
        { type: "text", text: "Result" },
      ],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 40 },
    };

    const response = translateResponse(raw);

    expect(response.message.content[0]).toMatchObject({
      kind: ContentKind.REDACTED_THINKING,
      thinking: {
        text: "opaque_data",
        redacted: true,
      },
    });
  });

  it("maps finish reasons correctly", () => {
    const makeRaw = (stop_reason: string | null) => ({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-6",
      content: [{ type: "text", text: "Hi" }],
      stop_reason,
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 5 },
    });

    expect(translateResponse(makeRaw("end_turn")).finish_reason.reason).toBe("stop");
    expect(translateResponse(makeRaw("stop_sequence")).finish_reason.reason).toBe("stop");
    expect(translateResponse(makeRaw("max_tokens")).finish_reason.reason).toBe("length");
    expect(translateResponse(makeRaw("tool_use")).finish_reason.reason).toBe("tool_calls");
    expect(translateResponse(makeRaw(null)).finish_reason.reason).toBe("other");
  });

  it("extracts usage correctly including cache tokens", () => {
    const raw = {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-6",
      content: [{ type: "text", text: "Hi" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 20,
      },
    };

    const response = translateResponse(raw);

    expect(response.usage.input_tokens).toBe(100);
    expect(response.usage.output_tokens).toBe(50);
    expect(response.usage.cache_read_tokens).toBe(80);
    expect(response.usage.cache_write_tokens).toBe(20);
    expect(response.usage.total_tokens).toBe(150);
  });
});

// ===========================================================================
// Streaming Translation Tests
// ===========================================================================

describe("Anthropic streaming", () => {
  it("translates a complete text streaming sequence", async () => {
    const events: SSEEvent[] = [
      {
        event: "message_start",
        data: JSON.stringify({
          type: "message_start",
          message: {
            id: "msg_s1",
            model: "claude-opus-4-6",
            usage: { input_tokens: 10 },
          },
        }),
      },
      {
        event: "content_block_start",
        data: JSON.stringify({
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        }),
      },
      {
        event: "content_block_delta",
        data: JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello" },
        }),
      },
      {
        event: "content_block_delta",
        data: JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: " world!" },
        }),
      },
      {
        event: "content_block_stop",
        data: JSON.stringify({
          type: "content_block_stop",
          index: 0,
        }),
      },
      {
        event: "message_delta",
        data: JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 15 },
        }),
      },
      {
        event: "message_stop",
        data: JSON.stringify({ type: "message_stop" }),
      },
    ];

    const streamEvents: import("../../src/types/index.js").StreamEvent[] = [];
    for await (const event of translateStream(mockSSEStream(events))) {
      streamEvents.push(event);
    }

    // Verify event sequence
    expect(streamEvents[0]!.type).toBe(StreamEventType.STREAM_START);
    expect(streamEvents[1]!.type).toBe(StreamEventType.TEXT_START);
    expect(streamEvents[2]!.type).toBe(StreamEventType.TEXT_DELTA);
    expect(streamEvents[2]!.delta).toBe("Hello");
    expect(streamEvents[3]!.type).toBe(StreamEventType.TEXT_DELTA);
    expect(streamEvents[3]!.delta).toBe(" world!");
    expect(streamEvents[4]!.type).toBe(StreamEventType.TEXT_END);
    expect(streamEvents[5]!.type).toBe(StreamEventType.FINISH);
    expect(streamEvents[5]!.finish_reason?.reason).toBe("stop");
    expect(streamEvents[5]!.usage?.input_tokens).toBe(10);
    expect(streamEvents[5]!.usage?.output_tokens).toBe(15);
    expect(streamEvents[5]!.response?.message.content[0]).toMatchObject({
      kind: ContentKind.TEXT,
      text: "Hello world!",
    });
  });

  it("translates tool_use streaming events", async () => {
    const events: SSEEvent[] = [
      {
        event: "message_start",
        data: JSON.stringify({
          type: "message_start",
          message: {
            id: "msg_t1",
            model: "claude-opus-4-6",
            usage: { input_tokens: 20 },
          },
        }),
      },
      {
        event: "content_block_start",
        data: JSON.stringify({
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "call_t1", name: "get_weather" },
        }),
      },
      {
        event: "content_block_delta",
        data: JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"city":' },
        }),
      },
      {
        event: "content_block_delta",
        data: JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '"SF"}' },
        }),
      },
      {
        event: "content_block_stop",
        data: JSON.stringify({ type: "content_block_stop", index: 0 }),
      },
      {
        event: "message_delta",
        data: JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: "tool_use" },
          usage: { output_tokens: 30 },
        }),
      },
      {
        event: "message_stop",
        data: JSON.stringify({ type: "message_stop" }),
      },
    ];

    const streamEvents: import("../../src/types/index.js").StreamEvent[] = [];
    for await (const event of translateStream(mockSSEStream(events))) {
      streamEvents.push(event);
    }

    // Find the tool call events
    const toolStart = streamEvents.find(
      (e) => e.type === StreamEventType.TOOL_CALL_START,
    );
    expect(toolStart).toBeDefined();
    expect(toolStart!.tool_call?.name).toBe("get_weather");
    expect(toolStart!.tool_call?.id).toBe("call_t1");

    const toolDeltas = streamEvents.filter(
      (e) => e.type === StreamEventType.TOOL_CALL_DELTA,
    );
    expect(toolDeltas).toHaveLength(2);

    const toolEnd = streamEvents.find(
      (e) => e.type === StreamEventType.TOOL_CALL_END,
    );
    expect(toolEnd).toBeDefined();
    expect(toolEnd!.tool_call?.arguments).toEqual({ city: "SF" });

    const finish = streamEvents.find((e) => e.type === StreamEventType.FINISH);
    expect(finish!.finish_reason?.reason).toBe("tool_calls");
  });

  it("translates thinking streaming events", async () => {
    const events: SSEEvent[] = [
      {
        event: "message_start",
        data: JSON.stringify({
          type: "message_start",
          message: {
            id: "msg_th1",
            model: "claude-opus-4-6",
            usage: { input_tokens: 5 },
          },
        }),
      },
      {
        event: "content_block_start",
        data: JSON.stringify({
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking" },
        }),
      },
      {
        event: "content_block_delta",
        data: JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Thinking..." },
        }),
      },
      {
        event: "content_block_stop",
        data: JSON.stringify({ type: "content_block_stop", index: 0 }),
      },
      {
        event: "content_block_start",
        data: JSON.stringify({
          type: "content_block_start",
          index: 1,
          content_block: { type: "text", text: "" },
        }),
      },
      {
        event: "content_block_delta",
        data: JSON.stringify({
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "Answer." },
        }),
      },
      {
        event: "content_block_stop",
        data: JSON.stringify({ type: "content_block_stop", index: 1 }),
      },
      {
        event: "message_delta",
        data: JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 25 },
        }),
      },
      {
        event: "message_stop",
        data: JSON.stringify({ type: "message_stop" }),
      },
    ];

    const streamEvents: import("../../src/types/index.js").StreamEvent[] = [];
    for await (const event of translateStream(mockSSEStream(events))) {
      streamEvents.push(event);
    }

    const reasoningStart = streamEvents.find(
      (e) => e.type === StreamEventType.REASONING_START,
    );
    expect(reasoningStart).toBeDefined();

    const reasoningDelta = streamEvents.find(
      (e) => e.type === StreamEventType.REASONING_DELTA,
    );
    expect(reasoningDelta).toBeDefined();
    expect(reasoningDelta!.reasoning_delta).toBe("Thinking...");

    const reasoningEnd = streamEvents.find(
      (e) => e.type === StreamEventType.REASONING_END,
    );
    expect(reasoningEnd).toBeDefined();

    const textDelta = streamEvents.find(
      (e) => e.type === StreamEventType.TEXT_DELTA,
    );
    expect(textDelta).toBeDefined();
    expect(textDelta!.delta).toBe("Answer.");
  });
});
