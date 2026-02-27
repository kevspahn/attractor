import { describe, it, expect } from "vitest";
import { StreamAccumulator } from "../src/types/stream.js";
import type { StreamEvent } from "../src/types/stream.js";
import { StreamEventType, ContentKind } from "../src/types/enums.js";
import { Usage } from "../src/types/response.js";

describe("StreamAccumulator", () => {
  it("accumulates text deltas into a response", () => {
    const acc = new StreamAccumulator();

    const events: StreamEvent[] = [
      { type: StreamEventType.STREAM_START },
      { type: StreamEventType.TEXT_START, text_id: "t1" },
      { type: StreamEventType.TEXT_DELTA, delta: "Hello ", text_id: "t1" },
      { type: StreamEventType.TEXT_DELTA, delta: "world!", text_id: "t1" },
      { type: StreamEventType.TEXT_END, text_id: "t1" },
      {
        type: StreamEventType.FINISH,
        finish_reason: { reason: "stop", raw: "end_turn" },
        usage: new Usage({ input_tokens: 10, output_tokens: 5 }),
      },
    ];

    for (const event of events) {
      acc.process(event);
    }

    const response = acc.response();
    expect(response.finish_reason.reason).toBe("stop");
    expect(response.usage.input_tokens).toBe(10);
    expect(response.usage.output_tokens).toBe(5);

    // Check accumulated text
    expect(acc.text).toBe("Hello world!");

    // Check response message has text content
    const textParts = response.message.content.filter(
      (p) => p.kind === ContentKind.TEXT,
    );
    expect(textParts).toHaveLength(1);
    if (textParts[0]!.kind === ContentKind.TEXT) {
      expect(textParts[0]!.text).toBe("Hello world!");
    }
  });

  it("accumulates reasoning deltas", () => {
    const acc = new StreamAccumulator();

    const events: StreamEvent[] = [
      { type: StreamEventType.STREAM_START },
      { type: StreamEventType.REASONING_START },
      { type: StreamEventType.REASONING_DELTA, reasoning_delta: "Let me " },
      { type: StreamEventType.REASONING_DELTA, reasoning_delta: "think..." },
      { type: StreamEventType.REASONING_END },
      { type: StreamEventType.TEXT_DELTA, delta: "The answer is 42." },
      {
        type: StreamEventType.FINISH,
        finish_reason: { reason: "stop" },
        usage: new Usage({ input_tokens: 20, output_tokens: 30 }),
      },
    ];

    for (const event of events) {
      acc.process(event);
    }

    expect(acc.reasoning).toBe("Let me think...");
    expect(acc.text).toBe("The answer is 42.");

    const response = acc.response();
    // Check that thinking content part exists
    const thinkingParts = response.message.content.filter(
      (p) => p.kind === ContentKind.THINKING,
    );
    expect(thinkingParts).toHaveLength(1);
  });

  it("accumulates tool calls from start/delta/end events", () => {
    const acc = new StreamAccumulator();

    const events: StreamEvent[] = [
      { type: StreamEventType.STREAM_START },
      {
        type: StreamEventType.TOOL_CALL_START,
        tool_call: {
          id: "call_1",
          name: "get_weather",
          arguments: {},
        },
      },
      {
        type: StreamEventType.TOOL_CALL_DELTA,
        tool_call: {
          id: "call_1",
          name: "get_weather",
          arguments: {},
          raw_arguments: '{"loc',
        },
      },
      {
        type: StreamEventType.TOOL_CALL_DELTA,
        tool_call: {
          id: "call_1",
          name: "get_weather",
          arguments: {},
          raw_arguments: 'ation":"SF"}',
        },
      },
      {
        type: StreamEventType.TOOL_CALL_END,
        tool_call: {
          id: "call_1",
          name: "get_weather",
          arguments: { location: "SF" },
        },
      },
      {
        type: StreamEventType.FINISH,
        finish_reason: { reason: "tool_calls" },
        usage: new Usage({ input_tokens: 15, output_tokens: 10 }),
      },
    ];

    for (const event of events) {
      acc.process(event);
    }

    expect(acc.toolCalls).toHaveLength(1);
    expect(acc.toolCalls[0]!.name).toBe("get_weather");
    expect(acc.toolCalls[0]!.arguments).toEqual({ location: "SF" });

    const response = acc.response();
    const toolCallParts = response.message.content.filter(
      (p) => p.kind === ContentKind.TOOL_CALL,
    );
    expect(toolCallParts).toHaveLength(1);
  });

  it("returns the full response from FINISH event if provided", () => {
    const acc = new StreamAccumulator();
    const fullResponse = {
      id: "resp_123",
      model: "test-model",
      provider: "test",
      message: {
        role: "assistant" as const,
        content: [{ kind: ContentKind.TEXT as const, text: "Done!" }],
      },
      finish_reason: { reason: "stop" },
      usage: new Usage({ input_tokens: 5, output_tokens: 2 }),
    };

    acc.process({
      type: StreamEventType.TEXT_DELTA,
      delta: "Done!",
    });
    acc.process({
      type: StreamEventType.FINISH,
      finish_reason: { reason: "stop" },
      usage: new Usage({ input_tokens: 5, output_tokens: 2 }),
      response: fullResponse,
    });

    const response = acc.response();
    expect(response.id).toBe("resp_123");
    expect(response.model).toBe("test-model");
  });

  it("synthesizes a response when FINISH has no full response", () => {
    const acc = new StreamAccumulator();
    acc.process({ type: StreamEventType.TEXT_DELTA, delta: "Hello" });
    acc.process({
      type: StreamEventType.FINISH,
      finish_reason: { reason: "stop" },
    });

    const response = acc.response();
    expect(response.id).toBe("");
    expect(response.model).toBe("");
    expect(response.finish_reason.reason).toBe("stop");
  });

  it("accumulates warnings from STREAM_START", () => {
    const acc = new StreamAccumulator();
    acc.process({
      type: StreamEventType.STREAM_START,
      warnings: [
        { message: "Model is deprecated", code: "deprecated" },
      ],
    });
    acc.process({ type: StreamEventType.TEXT_DELTA, delta: "Hi" });
    acc.process({
      type: StreamEventType.FINISH,
      finish_reason: { reason: "stop" },
    });

    const response = acc.response();
    expect(response.warnings).toHaveLength(1);
    expect(response.warnings![0]!.message).toBe("Model is deprecated");
  });

  it("defaults to 'other' finish reason when no finish event received", () => {
    const acc = new StreamAccumulator();
    acc.process({ type: StreamEventType.TEXT_DELTA, delta: "partial" });
    const response = acc.response();
    expect(response.finish_reason.reason).toBe("other");
  });
});
