/**
 * Server-Sent Events (SSE) stream parser.
 *
 * Parses a `ReadableStream<Uint8Array>` into an async iterable of SSE events.
 * Follows the W3C specification for event-stream parsing:
 *   - `event:` lines set the event type
 *   - `data:` lines form the payload (multiple `data:` lines are joined with "\n")
 *   - `retry:` lines set a reconnection interval
 *   - Lines starting with `:` are comments (ignored)
 *   - A blank line dispatches the accumulated event
 *
 * Correctly handles chunks that split mid-line and multi-line data fields.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single parsed SSE event. */
export interface SSEEvent {
  /** The event type (from `event:` line). `undefined` if not specified. */
  event?: string;
  /** The event data (from `data:` lines, joined with newlines). */
  data: string;
  /** Reconnection interval in milliseconds (from `retry:` line). */
  retry?: number;
}

// ---------------------------------------------------------------------------
// Internal: parse a single non-blank, non-comment line into field accumulators.
// ---------------------------------------------------------------------------

interface SSEAccumulator {
  eventType: string | undefined;
  dataLines: string[];
  retry: number | undefined;
}

/**
 * Process a single SSE line, updating the accumulator.
 * Blank lines and comment lines must be handled by the caller before
 * invoking this function.
 */
function processField(line: string, acc: SSEAccumulator): void {
  const colonIdx = line.indexOf(":");
  let field: string;
  let value: string;

  if (colonIdx === -1) {
    field = line;
    value = "";
  } else {
    field = line.slice(0, colonIdx);
    value = line.slice(colonIdx + 1);
    // Strip a single leading space if present.
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
  }

  switch (field) {
    case "event":
      acc.eventType = value;
      break;
    case "data":
      acc.dataLines.push(value);
      break;
    case "retry": {
      const parsed = parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        acc.retry = parsed;
      }
      break;
    }
    // Unknown fields are ignored per the SSE spec.
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a ReadableStream of bytes as an SSE event stream.
 *
 * Yields `SSEEvent` objects as they become complete (delimited by blank lines).
 * The stream is consumed completely; the async iterator finishes when the
 * underlying stream closes.
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterableIterator<SSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  // Buffer for incomplete lines across chunk boundaries.
  let buffer = "";

  // Accumulator for the event currently being assembled.
  const acc: SSEAccumulator = {
    eventType: undefined,
    dataLines: [],
    retry: undefined,
  };

  /** Dispatch the current event and reset the accumulator. */
  function resetAcc(): void {
    acc.eventType = undefined;
    acc.dataLines = [];
    acc.retry = undefined;
  }

  try {
    for (;;) {
      const { value, done } = await reader.read();

      if (done) {
        // Process any remaining data left in the buffer (a trailing line
        // without a final newline).
        if (buffer.length > 0) {
          const line = buffer;
          buffer = "";
          if (line !== "" && !line.startsWith(":")) {
            processField(line, acc);
          }
        }

        // If there is a trailing partial event (no final blank line), dispatch it.
        if (acc.dataLines.length > 0) {
          yield {
            event: acc.eventType,
            data: acc.dataLines.join("\n"),
            retry: acc.retry,
          };
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines.  Lines are terminated by \r\n, \r, or \n.
      // We split on those boundaries but keep any trailing incomplete segment
      // in `buffer` for the next chunk.
      const lines = buffer.split(/\r\n|\r|\n/);

      // The last element is either "" (if the chunk ended with a newline)
      // or a partial line that needs more data.
      buffer = lines.pop()!;

      for (const line of lines) {
        if (line === "") {
          // Blank line = event boundary.  Dispatch if we have data.
          if (acc.dataLines.length > 0) {
            yield {
              event: acc.eventType,
              data: acc.dataLines.join("\n"),
              retry: acc.retry,
            };
          }

          resetAcc();
          continue;
        }

        if (line.startsWith(":")) {
          // Comment line -- ignore.
          continue;
        }

        processField(line, acc);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
