/**
 * stream() — the streaming generation function (Layer 4).
 *
 * Provides a high-level streaming API with automatic tool execution
 * on top of the low-level Client.
 *
 * See spec Section 4.4.
 */

import type { Client } from "./client.js";
import { getDefaultClient } from "./index.js";
import type {
  Message,
  StreamEvent,
  Response,
} from "./types/index.js";
import {
  ContentKind,
  Role,
  StreamEventType,
  StreamAccumulator,
  getResponseToolCalls,
} from "./types/index.js";
import { executeTools } from "./generate.js";
import type { GenerateOptions } from "./generate.js";

// ---------------------------------------------------------------------------
// StreamResult
// ---------------------------------------------------------------------------

/** The result of the stream() function. */
export interface StreamResult {
  /** Async iteration over all stream events. */
  [Symbol.asyncIterator](): AsyncIterableIterator<StreamEvent>;
  /** Returns the accumulated Response after the stream ends. */
  response(): Promise<Response>;
  /** Convenience: yields only text deltas. */
  textStream: AsyncIterableIterator<string>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Standardize prompt/messages/system into a Message array.
 * (Duplicated from generate.ts to avoid circular-import issues with
 *  getDefaultClient.)
 */
function buildMessages(options: GenerateOptions): Message[] {
  if (options.prompt !== undefined && options.messages !== undefined) {
    throw new Error(
      'Cannot specify both "prompt" and "messages". Use one or the other.',
    );
  }

  const messages: Message[] = [];

  if (options.system) {
    messages.push({
      role: Role.SYSTEM,
      content: [{ kind: ContentKind.TEXT, text: options.system }],
    });
  }

  if (options.prompt !== undefined) {
    messages.push({
      role: Role.USER,
      content: [{ kind: ContentKind.TEXT, text: options.prompt }],
    });
  } else if (options.messages) {
    messages.push(...options.messages);
  }

  return messages;
}

/**
 * Build a low-level Request from GenerateOptions and the current messages.
 */
function buildRequest(
  options: GenerateOptions,
  messages: Message[],
) {
  return {
    model: options.model,
    messages,
    provider: options.provider,
    tools: options.tools,
    tool_choice: options.toolChoice,
    response_format: options.responseFormat,
    temperature: options.temperature,
    top_p: options.topP,
    max_tokens: options.maxTokens,
    stop_sequences: options.stopSequences,
    reasoning_effort: options.reasoningEffort,
    provider_options: options.providerOptions,
  };
}

// ---------------------------------------------------------------------------
// stream()
// ---------------------------------------------------------------------------

/**
 * High-level streaming generation with automatic tool execution.
 *
 * Returns a StreamResult that can be iterated for events, consumed
 * for text-only deltas, or awaited for the final response.
 */
export function stream(options: GenerateOptions): StreamResult {
  const client = options.client ?? getDefaultClient();
  const maxToolRounds = options.maxToolRounds ?? 1;

  const messages = buildMessages(options);

  // The accumulated final response, resolved when stream ends.
  let resolveResponse: (r: Response) => void;
  let rejectResponse: (err: Error) => void;
  const responsePromise = new Promise<Response>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });

  /**
   * The main event generator. Handles tool loops internally:
   * 1. Stream events from the LLM
   * 2. If tool calls are present and we have rounds left, execute tools
   * 3. Stream the next LLM call
   */
  async function* generateEvents(): AsyncIterableIterator<StreamEvent> {
    let roundsUsed = 0;

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const request = buildRequest(options, messages);
        const eventStream = client.stream(request);
        const accumulator = new StreamAccumulator();

        // Yield events from this LLM call
        for await (const event of eventStream) {
          accumulator.process(event);
          yield event;
        }

        const response = accumulator.response();
        const toolCalls = getResponseToolCalls(response);

        // Check if we should do tool execution
        const hasActiveTools =
          options.tools && options.tools.some((t) => t.execute);
        const shouldExecuteTools =
          hasActiveTools &&
          response.finish_reason.reason === "tool_calls" &&
          toolCalls.length > 0 &&
          roundsUsed < maxToolRounds;

        if (shouldExecuteTools && options.tools) {
          // Execute tools
          const toolResults = await executeTools(options.tools, toolCalls);

          // Append assistant message + tool results to conversation
          messages.push(response.message as Message);
          for (const result of toolResults) {
            messages.push({
              role: Role.TOOL,
              content: [
                {
                  kind: ContentKind.TOOL_RESULT,
                  tool_result: {
                    tool_call_id: result.tool_call_id,
                    content:
                      typeof result.content === "string"
                        ? result.content
                        : JSON.stringify(result.content),
                    is_error: result.is_error,
                  },
                },
              ],
              tool_call_id: result.tool_call_id,
            });
          }

          roundsUsed++;
          // Continue to next iteration for the follow-up LLM call
        } else {
          // No more tools — resolve the response and return
          resolveResponse!(response);
          return;
        }
      }
    } catch (err) {
      rejectResponse!(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  // Create the event iterator (lazily started)
  let eventIterator: AsyncIterableIterator<StreamEvent> | undefined;

  function getEventIterator(): AsyncIterableIterator<StreamEvent> {
    if (!eventIterator) {
      eventIterator = generateEvents();
    }
    return eventIterator;
  }

  /**
   * A text-only stream that yields only text deltas.
   */
  async function* createTextStream(): AsyncIterableIterator<string> {
    for await (const event of getEventIterator()) {
      if (
        event.type === StreamEventType.TEXT_DELTA &&
        event.delta !== undefined
      ) {
        yield event.delta;
      }
    }
  }

  const textStream = createTextStream();

  const result: StreamResult = {
    [Symbol.asyncIterator](): AsyncIterableIterator<StreamEvent> {
      return getEventIterator();
    },
    response(): Promise<Response> {
      return responsePromise;
    },
    textStream,
  };

  return result;
}
