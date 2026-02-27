import { describe, it, expect, vi } from "vitest";
import { stream } from "../src/stream-fn.js";
import { Client } from "../src/client.js";
import type { ProviderAdapter } from "../src/providers/adapter.js";
import type { StreamEvent } from "../src/types/stream.js";
import { Role, ContentKind, StreamEventType } from "../src/types/enums.js";
import { Usage } from "../src/types/response.js";
import type { Response } from "../src/types/response.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStreamClient(
  streamFn: ReturnType<typeof vi.fn>,
): Client {
  const adapter: ProviderAdapter = {
    name: "test",
    complete: vi.fn(),
    stream: streamFn,
  };
  return new Client({
    providers: { test: adapter },
    defaultProvider: "test",
  });
}

function makeFinishEvent(overrides?: Partial<StreamEvent>): StreamEvent {
  const response: Response = {
    id: "resp-1",
    model: "test-model",
    provider: "test",
    message: {
      role: Role.ASSISTANT,
      content: [{ kind: ContentKind.TEXT, text: "Hello world" }],
    },
    finish_reason: { reason: "stop" },
    usage: new Usage({ input_tokens: 5, output_tokens: 3 }),
  };

  return {
    type: StreamEventType.FINISH,
    finish_reason: { reason: "stop" },
    usage: new Usage({ input_tokens: 5, output_tokens: 3 }),
    response,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("stream()", () => {
  describe("simple streaming", () => {
    it("yields TEXT_DELTA events from the stream", async () => {
      const streamFn = vi.fn().mockImplementation(function* () {
        yield {
          type: StreamEventType.STREAM_START,
        } as StreamEvent;
        yield {
          type: StreamEventType.TEXT_DELTA,
          delta: "Hello",
        } as StreamEvent;
        yield {
          type: StreamEventType.TEXT_DELTA,
          delta: " world",
        } as StreamEvent;
        yield makeFinishEvent();
      });

      const client = createMockStreamClient(streamFn);

      const result = stream({
        model: "test-model",
        prompt: "Say hello",
        client,
      });

      const events: StreamEvent[] = [];
      for await (const event of result) {
        events.push(event);
      }

      expect(events).toHaveLength(4);
      expect(events[0].type).toBe(StreamEventType.STREAM_START);
      expect(events[1].type).toBe(StreamEventType.TEXT_DELTA);
      expect(events[1].delta).toBe("Hello");
      expect(events[2].type).toBe(StreamEventType.TEXT_DELTA);
      expect(events[2].delta).toBe(" world");
      expect(events[3].type).toBe(StreamEventType.FINISH);
    });
  });

  describe("textStream", () => {
    it("yields only text delta strings", async () => {
      const streamFn = vi.fn().mockImplementation(function* () {
        yield {
          type: StreamEventType.STREAM_START,
        } as StreamEvent;
        yield {
          type: StreamEventType.TEXT_DELTA,
          delta: "Hello",
        } as StreamEvent;
        yield {
          type: StreamEventType.TEXT_DELTA,
          delta: " world",
        } as StreamEvent;
        yield makeFinishEvent();
      });

      const client = createMockStreamClient(streamFn);

      const result = stream({
        model: "test-model",
        prompt: "Say hello",
        client,
      });

      const texts: string[] = [];
      for await (const text of result.textStream) {
        texts.push(text);
      }

      expect(texts).toEqual(["Hello", " world"]);
    });
  });

  describe("response()", () => {
    it("returns the accumulated response after stream ends", async () => {
      const response: Response = {
        id: "resp-stream",
        model: "test-model",
        provider: "test",
        message: {
          role: Role.ASSISTANT,
          content: [{ kind: ContentKind.TEXT, text: "Hello world" }],
        },
        finish_reason: { reason: "stop" },
        usage: new Usage({ input_tokens: 5, output_tokens: 3 }),
      };

      const streamFn = vi.fn().mockImplementation(function* () {
        yield {
          type: StreamEventType.TEXT_DELTA,
          delta: "Hello world",
        } as StreamEvent;
        yield {
          type: StreamEventType.FINISH,
          finish_reason: { reason: "stop" },
          usage: new Usage({ input_tokens: 5, output_tokens: 3 }),
          response,
        } as StreamEvent;
      });

      const client = createMockStreamClient(streamFn);

      const result = stream({
        model: "test-model",
        prompt: "Say hello",
        client,
      });

      // Consume the stream
      for await (const _event of result) {
        // drain
      }

      const resp = await result.response();
      expect(resp.id).toBe("resp-stream");
      expect(resp.finish_reason.reason).toBe("stop");
    });
  });

  describe("prompt standardization", () => {
    it("throws when both prompt and messages are provided", () => {
      const streamFn = vi.fn();
      const client = createMockStreamClient(streamFn);

      expect(() =>
        stream({
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
      ).toThrow('Cannot specify both "prompt" and "messages"');
    });
  });
});
