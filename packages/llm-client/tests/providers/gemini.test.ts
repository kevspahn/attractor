import { describe, it, expect } from "vitest";
import {
  Role,
  ContentKind,
  StreamEventType,
  type Request,
  type StreamEvent,
} from "../../src/types/index.js";
import {
  translateRequest,
  GeminiIdMap,
} from "../../src/providers/gemini/translate-request.js";
import { translateResponse } from "../../src/providers/gemini/translate-response.js";
import { translateStream } from "../../src/providers/gemini/stream.js";
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

describe("Gemini translate-request", () => {
  it("extracts system messages to systemInstruction", () => {
    const idMap = new GeminiIdMap();
    const request: Request = {
      model: "gemini-3-flash-preview",
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

    const body = translateRequest(request, idMap);

    expect(body.systemInstruction).toBeDefined();
    expect(body.systemInstruction!.parts).toHaveLength(1);
    expect(body.systemInstruction!.parts[0]).toMatchObject({
      text: "You are helpful.",
    });
    // Contents should only have user message
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0]!.role).toBe("user");
  });

  it("maps ASSISTANT to model role", () => {
    const idMap = new GeminiIdMap();
    const request: Request = {
      model: "gemini-3-flash-preview",
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

    const body = translateRequest(request, idMap);

    expect(body.contents[1]!.role).toBe("model");
    expect(body.contents[1]!.parts[0]).toMatchObject({ text: "Hello!" });
  });

  it("generates synthetic IDs for tool calls", () => {
    const idMap = new GeminiIdMap();
    const request: Request = {
      model: "gemini-3-flash-preview",
      messages: [
        {
          role: Role.ASSISTANT,
          content: [
            {
              kind: ContentKind.TOOL_CALL,
              tool_call: {
                id: "call_syn1",
                name: "search",
                arguments: { query: "test" },
              },
            },
          ],
        },
      ],
    };

    const body = translateRequest(request, idMap);

    const part = body.contents[0]!.parts[0] as Record<string, unknown>;
    expect(part["functionCall"]).toBeDefined();
    const fc = part["functionCall"] as Record<string, unknown>;
    expect(fc["name"]).toBe("search");
    expect(fc["args"]).toEqual({ query: "test" });

    // The idMap should have registered the mapping
    expect(idMap.getName("call_syn1")).toBe("search");
  });

  it("wraps tool results in functionResponse with name lookup", () => {
    const idMap = new GeminiIdMap();
    // Pre-register a mapping
    idMap.register("call_r1", "get_weather");

    const request: Request = {
      model: "gemini-3-flash-preview",
      messages: [
        {
          role: Role.TOOL,
          content: [
            {
              kind: ContentKind.TOOL_RESULT,
              tool_result: {
                tool_call_id: "call_r1",
                content: "72F sunny",
                is_error: false,
              },
            },
          ],
          tool_call_id: "call_r1",
        },
      ],
    };

    const body = translateRequest(request, idMap);

    const part = body.contents[0]!.parts[0] as Record<string, unknown>;
    expect(part["functionResponse"]).toBeDefined();
    const fr = part["functionResponse"] as Record<string, unknown>;
    expect(fr["name"]).toBe("get_weather");
    expect(fr["response"]).toEqual({ result: "72F sunny" });
  });

  it("translates content parts correctly", () => {
    const idMap = new GeminiIdMap();
    const request: Request = {
      model: "gemini-3-flash-preview",
      messages: [
        {
          role: Role.USER,
          content: [
            { kind: ContentKind.TEXT, text: "What is this?" },
            {
              kind: ContentKind.IMAGE,
              image: { url: "https://example.com/img.jpg", media_type: "image/jpeg" },
            },
          ],
        },
      ],
    };

    const body = translateRequest(request, idMap);

    expect(body.contents[0]!.parts).toHaveLength(2);
    expect(body.contents[0]!.parts[0]).toMatchObject({ text: "What is this?" });
    expect(body.contents[0]!.parts[1]).toMatchObject({
      fileData: { mimeType: "image/jpeg", fileUri: "https://example.com/img.jpg" },
    });
  });

  it("translates tool definitions to functionDeclarations", () => {
    const idMap = new GeminiIdMap();
    const request: Request = {
      model: "gemini-3-flash-preview",
      messages: [
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Hi" }],
        },
      ],
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      ],
    };

    const body = translateRequest(request, idMap);

    expect(body.tools).toHaveLength(1);
    expect(body.tools![0]!.functionDeclarations).toHaveLength(1);
    expect(body.tools![0]!.functionDeclarations[0]).toMatchObject({
      name: "get_weather",
      description: "Get weather",
    });
  });

  it("translates tool choice modes", () => {
    const idMap = new GeminiIdMap();
    const baseRequest: Request = {
      model: "gemini-3-flash-preview",
      messages: [
        { role: Role.USER, content: [{ kind: ContentKind.TEXT, text: "Hi" }] },
      ],
      tools: [
        {
          name: "tool1",
          description: "d",
          parameters: { type: "object", properties: {} },
        },
      ],
    };

    // auto
    const autoBody = translateRequest(
      { ...baseRequest, tool_choice: { mode: "auto" } },
      idMap,
    );
    expect(autoBody.toolConfig?.functionCallingConfig.mode).toBe("AUTO");

    // none
    const noneBody = translateRequest(
      { ...baseRequest, tool_choice: { mode: "none" } },
      idMap,
    );
    expect(noneBody.toolConfig?.functionCallingConfig.mode).toBe("NONE");

    // required
    const reqBody = translateRequest(
      { ...baseRequest, tool_choice: { mode: "required" } },
      idMap,
    );
    expect(reqBody.toolConfig?.functionCallingConfig.mode).toBe("ANY");

    // named
    const namedBody = translateRequest(
      { ...baseRequest, tool_choice: { mode: "named", tool_name: "tool1" } },
      idMap,
    );
    expect(namedBody.toolConfig?.functionCallingConfig.mode).toBe("ANY");
    expect(namedBody.toolConfig?.functionCallingConfig.allowedFunctionNames).toEqual([
      "tool1",
    ]);
  });

  it("maps max_tokens to maxOutputTokens in generationConfig", () => {
    const idMap = new GeminiIdMap();
    const request: Request = {
      model: "gemini-3-flash-preview",
      messages: [
        { role: Role.USER, content: [{ kind: ContentKind.TEXT, text: "Hi" }] },
      ],
      max_tokens: 2000,
      temperature: 0.7,
    };

    const body = translateRequest(request, idMap);

    expect(body.generationConfig?.maxOutputTokens).toBe(2000);
    expect(body.generationConfig?.temperature).toBe(0.7);
  });

  it("merges DEVELOPER messages with system", () => {
    const idMap = new GeminiIdMap();
    const request: Request = {
      model: "gemini-3-flash-preview",
      messages: [
        {
          role: Role.SYSTEM,
          content: [{ kind: ContentKind.TEXT, text: "System" }],
        },
        {
          role: Role.DEVELOPER,
          content: [{ kind: ContentKind.TEXT, text: "Developer" }],
        },
        {
          role: Role.USER,
          content: [{ kind: ContentKind.TEXT, text: "Hi" }],
        },
      ],
    };

    const body = translateRequest(request, idMap);

    expect(body.systemInstruction?.parts).toHaveLength(2);
    expect(body.systemInstruction!.parts[0]).toMatchObject({ text: "System" });
    expect(body.systemInstruction!.parts[1]).toMatchObject({ text: "Developer" });
  });
});

// ===========================================================================
// Response Translation Tests
// ===========================================================================

describe("Gemini translate-response", () => {
  it("translates text parts to TEXT content parts", () => {
    const idMap = new GeminiIdMap();
    const raw = {
      candidates: [
        {
          content: {
            parts: [{ text: "Hello, world!" }],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30,
      },
    };

    const response = translateResponse(raw, idMap);

    expect(response.provider).toBe("gemini");
    expect(response.message.content[0]).toMatchObject({
      kind: ContentKind.TEXT,
      text: "Hello, world!",
    });
    expect(response.finish_reason.reason).toBe("stop");
  });

  it("translates functionCall parts with synthetic IDs", () => {
    const idMap = new GeminiIdMap();
    const raw = {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: "get_weather",
                  args: { city: "SF" },
                },
              },
            ],
            role: "model",
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 15,
        candidatesTokenCount: 25,
      },
    };

    const response = translateResponse(raw, idMap);

    expect(response.message.content[0]!.kind).toBe(ContentKind.TOOL_CALL);
    const toolCall = (
      response.message.content[0] as { kind: string; tool_call: Record<string, unknown> }
    ).tool_call;
    expect(toolCall["name"]).toBe("get_weather");
    expect(toolCall["arguments"]).toEqual({ city: "SF" });
    // Synthetic ID should start with "call_"
    expect((toolCall["id"] as string).startsWith("call_")).toBe(true);

    // finish_reason should be inferred as tool_calls
    expect(response.finish_reason.reason).toBe("tool_calls");
  });

  it("maps finish reasons correctly", () => {
    const idMap = new GeminiIdMap();
    const makeRaw = (finishReason: string, hasFunctionCall = false) => ({
      candidates: [
        {
          content: {
            parts: hasFunctionCall
              ? [{ functionCall: { name: "f", args: {} } }]
              : [{ text: "Hi" }],
            role: "model",
          },
          finishReason,
        },
      ],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
    });

    expect(translateResponse(makeRaw("STOP"), idMap).finish_reason.reason).toBe("stop");
    expect(translateResponse(makeRaw("MAX_TOKENS"), idMap).finish_reason.reason).toBe(
      "length",
    );
    expect(translateResponse(makeRaw("SAFETY"), idMap).finish_reason.reason).toBe(
      "content_filter",
    );
    expect(translateResponse(makeRaw("RECITATION"), idMap).finish_reason.reason).toBe(
      "content_filter",
    );
    // Infer tool_calls from functionCall presence
    expect(
      translateResponse(makeRaw("STOP", true), idMap).finish_reason.reason,
    ).toBe("tool_calls");
  });

  it("extracts usage metadata correctly", () => {
    const idMap = new GeminiIdMap();
    const raw = {
      candidates: [
        {
          content: { parts: [{ text: "Hi" }], role: "model" },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        thoughtsTokenCount: 20,
        cachedContentTokenCount: 80,
      },
    };

    const response = translateResponse(raw, idMap);

    expect(response.usage.input_tokens).toBe(100);
    expect(response.usage.output_tokens).toBe(50);
    expect(response.usage.reasoning_tokens).toBe(20);
    expect(response.usage.cache_read_tokens).toBe(80);
  });
});

// ===========================================================================
// Streaming Translation Tests
// ===========================================================================

describe("Gemini streaming", () => {
  it("translates text streaming chunks", async () => {
    const idMap = new GeminiIdMap();
    const events: SSEEvent[] = [
      {
        data: JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "Hello" }],
                role: "model",
              },
            },
          ],
        }),
      },
      {
        data: JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: " world!" }],
                role: "model",
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 15,
          },
        }),
      },
    ];

    const streamEvents: StreamEvent[] = [];
    for await (const event of translateStream(mockSSEStream(events), idMap)) {
      streamEvents.push(event);
    }

    expect(streamEvents[0]!.type).toBe(StreamEventType.STREAM_START);
    expect(streamEvents[1]!.type).toBe(StreamEventType.TEXT_START);
    expect(streamEvents[2]!.type).toBe(StreamEventType.TEXT_DELTA);
    expect(streamEvents[2]!.delta).toBe("Hello");

    // Second chunk
    const secondDelta = streamEvents.find(
      (e) => e.type === StreamEventType.TEXT_DELTA && e.delta === " world!",
    );
    expect(secondDelta).toBeDefined();

    // Text end
    const textEnd = streamEvents.find((e) => e.type === StreamEventType.TEXT_END);
    expect(textEnd).toBeDefined();

    // Finish
    const finish = streamEvents.find((e) => e.type === StreamEventType.FINISH);
    expect(finish).toBeDefined();
    expect(finish!.finish_reason?.reason).toBe("stop");
    expect(finish!.usage?.input_tokens).toBe(10);
    expect(finish!.usage?.output_tokens).toBe(15);
  });

  it("translates function call chunks (complete in one chunk)", async () => {
    const idMap = new GeminiIdMap();
    const events: SSEEvent[] = [
      {
        data: JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: "search",
                      args: { query: "test" },
                    },
                  },
                ],
                role: "model",
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 20,
            candidatesTokenCount: 30,
          },
        }),
      },
    ];

    const streamEvents: StreamEvent[] = [];
    for await (const event of translateStream(mockSSEStream(events), idMap)) {
      streamEvents.push(event);
    }

    // Function calls should emit TOOL_CALL_START and TOOL_CALL_END
    const toolStart = streamEvents.find(
      (e) => e.type === StreamEventType.TOOL_CALL_START,
    );
    expect(toolStart).toBeDefined();
    expect(toolStart!.tool_call?.name).toBe("search");

    const toolEnd = streamEvents.find(
      (e) => e.type === StreamEventType.TOOL_CALL_END,
    );
    expect(toolEnd).toBeDefined();
    expect(toolEnd!.tool_call?.arguments).toEqual({ query: "test" });

    // Finish should have tool_calls reason
    const finish = streamEvents.find((e) => e.type === StreamEventType.FINISH);
    expect(finish!.finish_reason?.reason).toBe("tool_calls");
  });

  it("handles SSE format correctly", async () => {
    const idMap = new GeminiIdMap();
    const events: SSEEvent[] = [
      {
        data: JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "chunk1" }], role: "model" },
            },
          ],
          modelVersion: "gemini-3-flash-preview",
        }),
      },
      {
        data: JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "chunk2" }], role: "model" },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 10,
            thoughtsTokenCount: 3,
          },
        }),
      },
    ];

    const streamEvents: StreamEvent[] = [];
    for await (const event of translateStream(mockSSEStream(events), idMap)) {
      streamEvents.push(event);
    }

    const finish = streamEvents.find((e) => e.type === StreamEventType.FINISH);
    expect(finish).toBeDefined();
    expect(finish!.response?.model).toBe("gemini-3-flash-preview");
    expect(finish!.usage?.reasoning_tokens).toBe(3);
  });
});
