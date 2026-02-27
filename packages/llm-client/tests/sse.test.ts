import { describe, it, expect } from "vitest";
import { parseSSEStream, type SSEEvent } from "../src/utils/sse.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a ReadableStream from an array of string chunks (simulating network). */
function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

/** Collect all events from an async iterable. */
async function collect(
  iter: AsyncIterableIterator<SSEEvent>,
): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of iter) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseSSEStream", () => {
  it("parses a simple data-only event", async () => {
    const stream = chunkedStream(["data: hello world\n\n"]);
    const events = await collect(parseSSEStream(stream));

    expect(events).toEqual([
      { event: undefined, data: "hello world", retry: undefined },
    ]);
  });

  it("parses multiple events separated by blank lines", async () => {
    const stream = chunkedStream([
      "data: first\n\ndata: second\n\n",
    ]);
    const events = await collect(parseSSEStream(stream));

    expect(events).toHaveLength(2);
    expect(events[0]!.data).toBe("first");
    expect(events[1]!.data).toBe("second");
  });

  it("handles event type field", async () => {
    const stream = chunkedStream([
      "event: message\ndata: {\"text\":\"hi\"}\n\n",
    ]);
    const events = await collect(parseSSEStream(stream));

    expect(events).toEqual([
      {
        event: "message",
        data: '{"text":"hi"}',
        retry: undefined,
      },
    ]);
  });

  it("handles multi-line data (multiple data: lines)", async () => {
    const stream = chunkedStream([
      "data: line1\ndata: line2\ndata: line3\n\n",
    ]);
    const events = await collect(parseSSEStream(stream));

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("line1\nline2\nline3");
  });

  it("handles retry field", async () => {
    const stream = chunkedStream([
      "retry: 3000\ndata: payload\n\n",
    ]);
    const events = await collect(parseSSEStream(stream));

    expect(events).toHaveLength(1);
    expect(events[0]!.retry).toBe(3000);
    expect(events[0]!.data).toBe("payload");
  });

  it("ignores comment lines (starting with :)", async () => {
    const stream = chunkedStream([
      ": this is a comment\ndata: actual data\n\n",
    ]);
    const events = await collect(parseSSEStream(stream));

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("actual data");
  });

  it("strips exactly one leading space from field value", async () => {
    const stream = chunkedStream([
      "data:  two spaces\n\n",
    ]);
    const events = await collect(parseSSEStream(stream));

    // One leading space stripped -> " two spaces" with one remaining space
    expect(events[0]!.data).toBe(" two spaces");
  });

  it("handles field with no space after colon", async () => {
    const stream = chunkedStream([
      "data:nospace\n\n",
    ]);
    const events = await collect(parseSSEStream(stream));

    expect(events[0]!.data).toBe("nospace");
  });

  it("ignores blank lines without preceding data (no event emitted)", async () => {
    const stream = chunkedStream([
      "\n\n\ndata: after blanks\n\n",
    ]);
    const events = await collect(parseSSEStream(stream));

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("after blanks");
  });

  it("handles chunks that split mid-line", async () => {
    // "data: hello world\n\n" split across three chunks:
    const stream = chunkedStream([
      "dat",
      "a: hello ",
      "world\n\n",
    ]);
    const events = await collect(parseSSEStream(stream));

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("hello world");
  });

  it("handles chunks that split on the newline boundary", async () => {
    const stream = chunkedStream([
      "data: part1\n",
      "\n",
    ]);
    const events = await collect(parseSSEStream(stream));

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("part1");
  });

  it("handles \\r\\n line endings", async () => {
    const stream = chunkedStream([
      "data: crlf\r\n\r\n",
    ]);
    const events = await collect(parseSSEStream(stream));

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("crlf");
  });

  it("handles bare \\r line endings", async () => {
    const stream = chunkedStream([
      "data: cr\r\r",
    ]);
    const events = await collect(parseSSEStream(stream));

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("cr");
  });

  it("emits trailing event at stream end (no final blank line)", async () => {
    const stream = chunkedStream([
      "data: trailing",
    ]);
    const events = await collect(parseSSEStream(stream));

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("trailing");
  });

  it("resets event type between events", async () => {
    const stream = chunkedStream([
      "event: typeA\ndata: first\n\ndata: second\n\n",
    ]);
    const events = await collect(parseSSEStream(stream));

    expect(events).toHaveLength(2);
    expect(events[0]!.event).toBe("typeA");
    expect(events[1]!.event).toBeUndefined();
  });

  it("handles a realistic SSE stream (Anthropic-like)", async () => {
    const raw = [
      "event: message_start\ndata: {\"type\":\"message_start\"}\n\n",
      "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"Hello\"}}\n\n",
      "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\" world\"}}\n\n",
      "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
    ];
    const stream = chunkedStream(raw);
    const events = await collect(parseSSEStream(stream));

    expect(events).toHaveLength(4);
    expect(events[0]!.event).toBe("message_start");
    expect(JSON.parse(events[0]!.data)).toEqual({ type: "message_start" });
    expect(events[1]!.event).toBe("content_block_delta");
    expect(events[3]!.event).toBe("message_stop");
  });

  it("handles empty data field", async () => {
    const stream = chunkedStream(["data:\n\n"]);
    const events = await collect(parseSSEStream(stream));

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("");
  });

  it("ignores non-standard retry values", async () => {
    const stream = chunkedStream([
      "retry: not-a-number\ndata: test\n\n",
    ]);
    const events = await collect(parseSSEStream(stream));

    expect(events[0]!.retry).toBeUndefined();
  });

  it("handles unknown fields gracefully (ignores them)", async () => {
    const stream = chunkedStream([
      "id: 123\ndata: with-id\n\n",
    ]);
    const events = await collect(parseSSEStream(stream));

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("with-id");
  });

  it("produces no events from an empty stream", async () => {
    const stream = chunkedStream([]);
    const events = await collect(parseSSEStream(stream));
    expect(events).toHaveLength(0);
  });

  it("produces no events from a stream with only comments", async () => {
    const stream = chunkedStream([
      ": keep-alive\n\n",
    ]);
    const events = await collect(parseSSEStream(stream));
    expect(events).toHaveLength(0);
  });
});
