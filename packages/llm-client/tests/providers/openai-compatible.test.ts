import { describe, it, expect } from "vitest";
import {
  Role,
  ContentKind,
  StreamEventType,
  type Request,
  type StreamEvent,
} from "../../src/types/index.js";
import { translateRequest } from "../../src/providers/openai-compatible/translate-request.js";
import { translateResponse } from "../../src/providers/openai-compatible/translate-response.js";
import { translateStream } from "../../src/providers/openai-compatible/stream.js";
import type { SSEEvent } from "../../src/utils/index.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function* mockSSEStream(events: SSEEvent[]): AsyncIterableIterator<SSEEvent> {
  for (const event of events) {
    yield event;
  }
}

// ===========================================================================
// Request Translation Tests
// ===========================================================================

describe("OpenAI-compatible translate-request (Chat Completions)", () => {
  it("uses messages array (not input)", () => {
    const request: Request = {
      model: "llama-3-70b",
      messages: [
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Hello" }],
        },
      ],
    };

    const body = translateRequest(request);

    // Should use messages, not input
    expect(body.messages).toBeDefined();
    expect((body as Record<string, unknown>)["input"]).toBeUndefined();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({
      role: "user",
      content: "Hello",
    });
  });

  it("keeps system messages as messages (not instructions)", () => {
    const request: Request = {
      model: "llama-3-70b",
      messages: [
        {
          role: Role.SYSTEM,
          content: [{ kind: ContentKind.TEXT, text: "Be helpful." }],
        },
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Hi" }],
        },
      ],
    };

    const body = translateRequest(request);

    expect((body as Record<string, unknown>)["instructions"]).toBeUndefined();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toMatchObject({
      role: "system",
      content: "Be helpful.",
    });
  });

  it("translates assistant messages with tool calls", () => {
    const request: Request = {
      model: "llama-3-70b",
      messages: [
        {
          role: Role.ASSISTANT,
          content: [
            { kind: ContentKind.TEXT, text: "Let me check." },
            {
              kind: ContentKind.TOOL_CALL,
              tool_call: {
                id: "tc_1",
                name: "search",
                arguments: { q: "test" },
              },
            },
          ],
        },
      ],
    };

    const body = translateRequest(request);

    expect(body.messages[0]).toMatchObject({
      role: "assistant",
      content: "Let me check.",
    });
    expect(body.messages[0]!.tool_calls).toHaveLength(1);
    expect(body.messages[0]!.tool_calls![0]).toMatchObject({
      id: "tc_1",
      type: "function",
      function: { name: "search", arguments: '{"q":"test"}' },
    });
  });

  it("translates tool result messages", () => {
    const request: Request = {
      model: "llama-3-70b",
      messages: [
        {
          role: Role.TOOL,
          content: [
            {
              kind: ContentKind.TOOL_RESULT,
              tool_result: {
                tool_call_id: "tc_1",
                content: "Result data",
                is_error: false,
              },
            },
          ],
          tool_call_id: "tc_1",
        },
      ],
    };

    const body = translateRequest(request);

    expect(body.messages[0]).toMatchObject({
      role: "tool",
      content: "Result data",
      tool_call_id: "tc_1",
    });
  });

  it("uses standard tool format (not strict)", () => {
    const request: Request = {
      model: "llama-3-70b",
      messages: [
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Hi" }],
        },
      ],
      tools: [
        {
          name: "my_tool",
          description: "A tool",
          parameters: { type: "object", properties: {} },
        },
      ],
    };

    const body = translateRequest(request);

    expect(body.tools).toHaveLength(1);
    expect(body.tools![0]).toMatchObject({
      type: "function",
      function: {
        name: "my_tool",
        description: "A tool",
      },
    });
    // Should NOT have strict field (unlike the OpenAI Responses API adapter)
    expect((body.tools![0] as Record<string, unknown>)["strict"]).toBeUndefined();
  });

  it("does not include reasoning or instructions fields", () => {
    const request: Request = {
      model: "llama-3-70b",
      messages: [
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Hi" }],
        },
      ],
      reasoning_effort: "high", // Should be ignored
    };

    const body = translateRequest(request);

    expect((body as Record<string, unknown>)["reasoning"]).toBeUndefined();
    expect((body as Record<string, unknown>)["instructions"]).toBeUndefined();
  });

  it("uses max_tokens (not max_output_tokens)", () => {
    const request: Request = {
      model: "llama-3-70b",
      messages: [
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Hi" }],
        },
      ],
      max_tokens: 500,
    };

    const body = translateRequest(request);

    expect(body.max_tokens).toBe(500);
    expect((body as Record<string, unknown>)["max_output_tokens"]).toBeUndefined();
  });
});

// ===========================================================================
// Response Translation Tests
// ===========================================================================

describe("OpenAI-compatible translate-response", () => {
  it("translates standard chat completion response", () => {
    const raw = {
      id: "chatcmpl-123",
      model: "llama-3-70b",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "The answer is 4.",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 8,
        total_tokens: 18,
      },
    };

    const response = translateResponse(raw, "vllm");

    expect(response.id).toBe("chatcmpl-123");
    expect(response.model).toBe("llama-3-70b");
    expect(response.provider).toBe("vllm");
    expect(response.message.content[0]).toMatchObject({
      kind: ContentKind.TEXT,
      text: "The answer is 4.",
    });
    expect(response.finish_reason.reason).toBe("stop");
    expect(response.usage.input_tokens).toBe(10);
    expect(response.usage.output_tokens).toBe(8);
  });

  it("translates tool call responses", () => {
    const raw = {
      id: "chatcmpl-456",
      model: "llama-3-70b",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "tc_abc",
                type: "function",
                function: {
                  name: "search",
                  arguments: '{"query":"test"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 15, completion_tokens: 20 },
    };

    const response = translateResponse(raw, "ollama");

    expect(response.message.content[0]).toMatchObject({
      kind: ContentKind.TOOL_CALL,
      tool_call: {
        id: "tc_abc",
        name: "search",
        arguments: { query: "test" },
      },
    });
    expect(response.finish_reason.reason).toBe("tool_calls");
  });

  it("maps finish reasons correctly", () => {
    const makeRaw = (finish_reason: string | null) => ({
      id: "c1",
      model: "m",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hi" },
          finish_reason,
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    expect(translateResponse(makeRaw("stop"), "p").finish_reason.reason).toBe("stop");
    expect(translateResponse(makeRaw("length"), "p").finish_reason.reason).toBe("length");
    expect(translateResponse(makeRaw("tool_calls"), "p").finish_reason.reason).toBe(
      "tool_calls",
    );
    expect(translateResponse(makeRaw("content_filter"), "p").finish_reason.reason).toBe(
      "content_filter",
    );
    expect(translateResponse(makeRaw(null), "p").finish_reason.reason).toBe("other");
  });
});

// ===========================================================================
// Streaming Translation Tests
// ===========================================================================

describe("OpenAI-compatible streaming", () => {
  it("translates standard chat completion streaming", async () => {
    const events: SSEEvent[] = [
      {
        data: JSON.stringify({
          id: "chatcmpl-s1",
          model: "llama-3-70b",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "Hello" },
              finish_reason: null,
            },
          ],
        }),
      },
      {
        data: JSON.stringify({
          id: "chatcmpl-s1",
          model: "llama-3-70b",
          choices: [
            {
              index: 0,
              delta: { content: " world!" },
              finish_reason: null,
            },
          ],
        }),
      },
      {
        data: JSON.stringify({
          id: "chatcmpl-s1",
          model: "llama-3-70b",
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
        }),
      },
      { data: "[DONE]" },
    ];

    const streamEvents: StreamEvent[] = [];
    for await (const event of translateStream(
      mockSSEStream(events),
      "openai-compatible",
    )) {
      streamEvents.push(event);
    }

    expect(streamEvents[0]!.type).toBe(StreamEventType.STREAM_START);
    expect(streamEvents[1]!.type).toBe(StreamEventType.TEXT_START);
    expect(streamEvents[2]!.type).toBe(StreamEventType.TEXT_DELTA);
    expect(streamEvents[2]!.delta).toBe("Hello");
    expect(streamEvents[3]!.type).toBe(StreamEventType.TEXT_DELTA);
    expect(streamEvents[3]!.delta).toBe(" world!");

    const textEnd = streamEvents.find((e) => e.type === StreamEventType.TEXT_END);
    expect(textEnd).toBeDefined();

    const finish = streamEvents.find((e) => e.type === StreamEventType.FINISH);
    expect(finish).toBeDefined();
    expect(finish!.finish_reason?.reason).toBe("stop");
    expect(finish!.response?.message.content[0]).toMatchObject({
      kind: ContentKind.TEXT,
      text: "Hello world!",
    });
  });

  it("translates tool call streaming", async () => {
    const events: SSEEvent[] = [
      {
        data: JSON.stringify({
          id: "chatcmpl-tc",
          model: "llama-3-70b",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "tc_1",
                    type: "function",
                    function: { name: "search", arguments: "" },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
      },
      {
        data: JSON.stringify({
          id: "chatcmpl-tc",
          model: "llama-3-70b",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: '{"q":"test"}' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
      },
      {
        data: JSON.stringify({
          id: "chatcmpl-tc",
          model: "llama-3-70b",
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "tool_calls",
            },
          ],
        }),
      },
      { data: "[DONE]" },
    ];

    const streamEvents: StreamEvent[] = [];
    for await (const event of translateStream(
      mockSSEStream(events),
      "openai-compatible",
    )) {
      streamEvents.push(event);
    }

    const toolStart = streamEvents.find(
      (e) => e.type === StreamEventType.TOOL_CALL_START,
    );
    expect(toolStart).toBeDefined();
    expect(toolStart!.tool_call?.name).toBe("search");

    const toolDelta = streamEvents.find(
      (e) => e.type === StreamEventType.TOOL_CALL_DELTA,
    );
    expect(toolDelta).toBeDefined();

    const toolEnd = streamEvents.find(
      (e) => e.type === StreamEventType.TOOL_CALL_END,
    );
    expect(toolEnd).toBeDefined();
    expect(toolEnd!.tool_call?.arguments).toEqual({ q: "test" });

    const finish = streamEvents.find((e) => e.type === StreamEventType.FINISH);
    expect(finish!.finish_reason?.reason).toBe("tool_calls");
  });

  it("handles [DONE] terminator correctly", async () => {
    const events: SSEEvent[] = [
      {
        data: JSON.stringify({
          id: "c1",
          model: "m",
          choices: [
            { index: 0, delta: { content: "Hi" }, finish_reason: "stop" },
          ],
        }),
      },
      { data: "[DONE]" },
    ];

    const streamEvents: StreamEvent[] = [];
    for await (const event of translateStream(
      mockSSEStream(events),
      "openai-compatible",
    )) {
      streamEvents.push(event);
    }

    const finish = streamEvents.find((e) => e.type === StreamEventType.FINISH);
    expect(finish).toBeDefined();
  });

  it("extracts usage from final chunk with stream_options", async () => {
    const events: SSEEvent[] = [
      {
        data: JSON.stringify({
          id: "c1",
          model: "m",
          choices: [
            { index: 0, delta: { content: "x" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
      },
      { data: "[DONE]" },
    ];

    const streamEvents: StreamEvent[] = [];
    for await (const event of translateStream(
      mockSSEStream(events),
      "openai-compatible",
    )) {
      streamEvents.push(event);
    }

    const finish = streamEvents.find((e) => e.type === StreamEventType.FINISH);
    expect(finish!.usage?.input_tokens).toBe(100);
    expect(finish!.usage?.output_tokens).toBe(50);
  });
});
