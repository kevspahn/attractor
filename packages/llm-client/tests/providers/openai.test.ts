import { describe, it, expect } from "vitest";
import {
  Role,
  ContentKind,
  StreamEventType,
  type Request,
  type StreamEvent,
} from "../../src/types/index.js";
import { translateRequest } from "../../src/providers/openai/translate-request.js";
import { translateResponse } from "../../src/providers/openai/translate-response.js";
import { translateStream } from "../../src/providers/openai/stream.js";
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

describe("OpenAI translate-request (Responses API)", () => {
  it("extracts system messages to instructions parameter", () => {
    const request: Request = {
      model: "gpt-5.2",
      messages: [
        {
          role: Role.SYSTEM,
          content: [{ kind: ContentKind.TEXT, text: "Be helpful." }],
        },
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Hello" }],
        },
      ],
    };

    const body = translateRequest(request);

    expect(body.instructions).toBe("Be helpful.");
    // Input should only have the user message
    expect(body.input).toHaveLength(1);
    expect(body.input[0]).toMatchObject({
      type: "message",
      role: "user",
    });
  });

  it("translates user messages to input items with input_text content", () => {
    const request: Request = {
      model: "gpt-5.2",
      messages: [
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "What is 2+2?" }],
        },
      ],
    };

    const body = translateRequest(request);

    expect(body.input).toHaveLength(1);
    const item = body.input[0] as Record<string, unknown>;
    expect(item["type"]).toBe("message");
    expect(item["role"]).toBe("user");
    const content = item["content"] as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({ type: "input_text", text: "What is 2+2?" });
  });

  it("translates assistant messages to output_text content", () => {
    const request: Request = {
      model: "gpt-5.2",
      messages: [
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Hi" }],
        },
        {
          role: Role.ASSISTANT,
          content: [{ kind: ContentKind.TEXT, text: "Hello!" }],
        },
      ],
    };

    const body = translateRequest(request);

    const assistantItem = body.input[1] as Record<string, unknown>;
    expect(assistantItem["type"]).toBe("message");
    expect(assistantItem["role"]).toBe("assistant");
    const content = assistantItem["content"] as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({ type: "output_text", text: "Hello!" });
  });

  it("translates tool calls as function_call input items", () => {
    const request: Request = {
      model: "gpt-5.2",
      messages: [
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Weather?" }],
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
      ],
    };

    const body = translateRequest(request);

    // Tool calls should be separate function_call items
    const functionCall = body.input[1] as Record<string, unknown>;
    expect(functionCall["type"]).toBe("function_call");
    expect(functionCall["name"]).toBe("get_weather");
    expect(functionCall["call_id"]).toBe("call_1");
    expect(functionCall["arguments"]).toBe('{"city":"SF"}');
  });

  it("translates tool results as function_call_output input items", () => {
    const request: Request = {
      model: "gpt-5.2",
      messages: [
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

    const body = translateRequest(request);

    expect(body.input[0]).toMatchObject({
      type: "function_call_output",
      call_id: "call_1",
      output: "72F sunny",
    });
  });

  it("sets reasoning.effort from reasoning_effort parameter", () => {
    const request: Request = {
      model: "gpt-5.2",
      messages: [
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Think hard" }],
        },
      ],
      reasoning_effort: "high",
    };

    const body = translateRequest(request);
    expect(body.reasoning).toEqual({ effort: "high" });
  });

  it("maps max_tokens to max_output_tokens", () => {
    const request: Request = {
      model: "gpt-5.2",
      messages: [
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Hi" }],
        },
      ],
      max_tokens: 1000,
    };

    const body = translateRequest(request);
    expect(body.max_output_tokens).toBe(1000);
  });

  it("translates tools with strict:true", () => {
    const request: Request = {
      model: "gpt-5.2",
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
          parameters: { type: "object", properties: { x: { type: "string" } } },
        },
      ],
    };

    const body = translateRequest(request);

    expect(body.tools).toHaveLength(1);
    expect(body.tools![0]).toMatchObject({
      type: "function",
      name: "my_tool",
      description: "A tool",
      strict: true,
    });
  });

  it("translates image content (URL)", () => {
    const request: Request = {
      model: "gpt-5.2",
      messages: [
        {
          role: Role.USER,
          content: [
            {
              kind: ContentKind.IMAGE,
              image: { url: "https://example.com/img.png" },
            },
          ],
        },
      ],
    };

    const body = translateRequest(request);
    const msgItem = body.input[0] as Record<string, unknown>;
    const content = msgItem["content"] as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({
      type: "input_image",
      image_url: "https://example.com/img.png",
    });
  });
});

// ===========================================================================
// Response Translation Tests
// ===========================================================================

describe("OpenAI translate-response (Responses API)", () => {
  it("translates text output items", () => {
    const raw = {
      id: "resp_123",
      model: "gpt-5.2",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "The answer is 4." }],
        },
      ],
      status: "completed",
      usage: { input_tokens: 10, output_tokens: 20 },
    };

    const response = translateResponse(raw);

    expect(response.id).toBe("resp_123");
    expect(response.model).toBe("gpt-5.2");
    expect(response.provider).toBe("openai");
    expect(response.message.content[0]).toMatchObject({
      kind: ContentKind.TEXT,
      text: "The answer is 4.",
    });
    expect(response.finish_reason.reason).toBe("stop");
  });

  it("translates function call output items", () => {
    const raw = {
      id: "resp_456",
      model: "gpt-5.2",
      output: [
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_abc",
          name: "get_weather",
          arguments: '{"city":"NYC"}',
        },
      ],
      status: "completed",
      usage: { input_tokens: 15, output_tokens: 25 },
    };

    const response = translateResponse(raw);

    expect(response.message.content[0]).toMatchObject({
      kind: ContentKind.TOOL_CALL,
      tool_call: {
        id: "call_abc",
        name: "get_weather",
        arguments: { city: "NYC" },
      },
    });
    expect(response.finish_reason.reason).toBe("tool_calls");
  });

  it("extracts usage with reasoning tokens", () => {
    const raw = {
      id: "resp_789",
      model: "gpt-5.2",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Hi" }],
        },
      ],
      status: "completed",
      usage: {
        input_tokens: 50,
        output_tokens: 100,
        output_tokens_details: { reasoning_tokens: 60 },
        prompt_tokens_details: { cached_tokens: 30 },
      },
    };

    const response = translateResponse(raw);

    expect(response.usage.input_tokens).toBe(50);
    expect(response.usage.output_tokens).toBe(100);
    expect(response.usage.reasoning_tokens).toBe(60);
    expect(response.usage.cache_read_tokens).toBe(30);
  });

  it("maps status to finish reason", () => {
    const makeRaw = (status: string, hasToolCalls: boolean) => ({
      id: "resp_1",
      model: "gpt-5.2",
      output: hasToolCalls
        ? [{ type: "function_call", id: "fc", call_id: "c", name: "t", arguments: "{}" }]
        : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "." }] }],
      status,
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    expect(translateResponse(makeRaw("completed", false)).finish_reason.reason).toBe("stop");
    expect(translateResponse(makeRaw("incomplete", false)).finish_reason.reason).toBe("length");
    expect(translateResponse(makeRaw("completed", true)).finish_reason.reason).toBe("tool_calls");
  });
});

// ===========================================================================
// Streaming Translation Tests
// ===========================================================================

describe("OpenAI streaming (Responses API)", () => {
  it("translates text streaming events", async () => {
    const events: SSEEvent[] = [
      {
        event: "response.created",
        data: JSON.stringify({ id: "resp_s1", model: "gpt-5.2" }),
      },
      {
        event: "response.in_progress",
        data: JSON.stringify({ id: "resp_s1" }),
      },
      {
        event: "response.output_text.delta",
        data: JSON.stringify({ delta: "Hello" }),
      },
      {
        event: "response.output_text.delta",
        data: JSON.stringify({ delta: " world!" }),
      },
      {
        event: "response.output_item.done",
        data: JSON.stringify({
          item: {
            type: "message",
            content: [{ type: "output_text", text: "Hello world!" }],
          },
        }),
      },
      {
        event: "response.completed",
        data: JSON.stringify({
          response: {
            id: "resp_s1",
            model: "gpt-5.2",
            status: "completed",
            usage: { input_tokens: 5, output_tokens: 10 },
          },
        }),
      },
    ];

    const streamEvents: StreamEvent[] = [];
    for await (const event of translateStream(mockSSEStream(events))) {
      streamEvents.push(event);
    }

    expect(streamEvents[0]!.type).toBe(StreamEventType.STREAM_START);
    expect(streamEvents[1]!.type).toBe(StreamEventType.TEXT_START);
    expect(streamEvents[2]!.type).toBe(StreamEventType.TEXT_DELTA);
    expect(streamEvents[2]!.delta).toBe("Hello");
    expect(streamEvents[3]!.type).toBe(StreamEventType.TEXT_DELTA);
    expect(streamEvents[3]!.delta).toBe(" world!");

    const finish = streamEvents.find((e) => e.type === StreamEventType.FINISH);
    expect(finish).toBeDefined();
    expect(finish!.finish_reason?.reason).toBe("stop");
    expect(finish!.usage?.input_tokens).toBe(5);
    expect(finish!.usage?.output_tokens).toBe(10);
  });

  it("translates function call streaming events", async () => {
    const events: SSEEvent[] = [
      {
        event: "response.created",
        data: JSON.stringify({ id: "resp_fc", model: "gpt-5.2" }),
      },
      {
        event: "response.in_progress",
        data: JSON.stringify({ id: "resp_fc" }),
      },
      {
        event: "response.output_item.added",
        data: JSON.stringify({
          item: {
            type: "function_call",
            id: "fc_1",
            name: "search",
            call_id: "call_fc1",
          },
        }),
      },
      {
        event: "response.function_call_arguments.delta",
        data: JSON.stringify({ item_id: "fc_1", delta: '{"q":' }),
      },
      {
        event: "response.function_call_arguments.delta",
        data: JSON.stringify({ item_id: "fc_1", delta: '"test"}' }),
      },
      {
        event: "response.output_item.done",
        data: JSON.stringify({
          item: {
            type: "function_call",
            id: "fc_1",
            name: "search",
            call_id: "call_fc1",
            arguments: '{"q":"test"}',
          },
        }),
      },
      {
        event: "response.completed",
        data: JSON.stringify({
          response: {
            id: "resp_fc",
            model: "gpt-5.2",
            status: "completed",
            usage: { input_tokens: 10, output_tokens: 20 },
          },
        }),
      },
    ];

    const streamEvents: StreamEvent[] = [];
    for await (const event of translateStream(mockSSEStream(events))) {
      streamEvents.push(event);
    }

    const toolStart = streamEvents.find(
      (e) => e.type === StreamEventType.TOOL_CALL_START,
    );
    expect(toolStart).toBeDefined();
    expect(toolStart!.tool_call?.name).toBe("search");

    const toolDeltas = streamEvents.filter(
      (e) => e.type === StreamEventType.TOOL_CALL_DELTA,
    );
    expect(toolDeltas).toHaveLength(2);

    const toolEnd = streamEvents.find(
      (e) => e.type === StreamEventType.TOOL_CALL_END,
    );
    expect(toolEnd).toBeDefined();
    expect(toolEnd!.tool_call?.arguments).toEqual({ q: "test" });

    const finish = streamEvents.find((e) => e.type === StreamEventType.FINISH);
    expect(finish!.finish_reason?.reason).toBe("tool_calls");
  });

  it("includes reasoning_tokens in usage from completed event", async () => {
    const events: SSEEvent[] = [
      {
        event: "response.created",
        data: JSON.stringify({ id: "r1", model: "gpt-5.2" }),
      },
      {
        event: "response.in_progress",
        data: JSON.stringify({}),
      },
      {
        event: "response.output_text.delta",
        data: JSON.stringify({ delta: "Answer." }),
      },
      {
        event: "response.output_item.done",
        data: JSON.stringify({
          item: {
            type: "message",
            content: [{ type: "output_text", text: "Answer." }],
          },
        }),
      },
      {
        event: "response.completed",
        data: JSON.stringify({
          response: {
            id: "r1",
            model: "gpt-5.2",
            status: "completed",
            usage: {
              input_tokens: 20,
              output_tokens: 80,
              output_tokens_details: { reasoning_tokens: 50 },
            },
          },
        }),
      },
    ];

    const streamEvents: StreamEvent[] = [];
    for await (const event of translateStream(mockSSEStream(events))) {
      streamEvents.push(event);
    }

    const finish = streamEvents.find((e) => e.type === StreamEventType.FINISH);
    expect(finish!.usage?.reasoning_tokens).toBe(50);
  });
});
