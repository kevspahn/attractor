/**
 * OpenAI Chat Completions streaming translation.
 *
 * Per spec Section 7.7 / 7.10:
 * - data: {"choices":[{"delta":{"content":"text"}, "finish_reason": null}]}
 * - data: {"choices":[{"delta":{"tool_calls":[{"index":0,...}]}}]}
 * - data: {"usage":{...}}
 * - data: [DONE]
 */

import {
  StreamEventType,
  ContentKind,
  Role,
  Usage,
  type StreamEvent,
  type Response,
  type ContentPart,
  type FinishReason,
  type Message,
} from "../../types/index.js";
import type { SSEEvent } from "../../utils/index.js";

// ---------------------------------------------------------------------------
// Streaming state
// ---------------------------------------------------------------------------

interface ToolCallBuilder {
  index: number;
  id: string;
  name: string;
  argChunks: string[];
}

/**
 * Translate Chat Completions SSE events into unified StreamEvent objects.
 */
export async function* translateStream(
  sseStream: AsyncIterableIterator<SSEEvent>,
  providerName: string,
): AsyncIterableIterator<StreamEvent> {
  let hasEmittedStreamStart = false;
  let hasEmittedTextStart = false;
  const textId = "text_0";

  // Accumulation
  const textChunks: string[] = [];
  const toolCallBuilders = new Map<number, ToolCallBuilder>();
  const contentParts: ContentPart[] = [];
  let finishReason: FinishReason = { reason: "other" };
  let usage: Usage | undefined;
  let model = "";
  let responseId = "";

  for await (const sse of sseStream) {
    if (!sse.data || sse.data.trim() === "[DONE]") {
      // Stream is done
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(sse.data) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (!hasEmittedStreamStart) {
      hasEmittedStreamStart = true;
      responseId = (parsed["id"] as string) ?? "";
      model = (parsed["model"] as string) ?? "";
      yield { type: StreamEventType.STREAM_START };
    }

    // Extract usage if present (some providers send usage in final chunk)
    const rawUsage = parsed["usage"] as Record<string, unknown> | undefined;
    if (rawUsage) {
      usage = new Usage({
        input_tokens: (rawUsage["prompt_tokens"] as number) ?? 0,
        output_tokens: (rawUsage["completion_tokens"] as number) ?? 0,
        raw: rawUsage,
      });
    }

    const choices = parsed["choices"] as Array<Record<string, unknown>> | undefined;
    if (!choices || choices.length === 0) continue;

    const choice = choices[0]!;
    const delta = choice["delta"] as Record<string, unknown> | undefined;
    const choiceFinishReason = choice["finish_reason"] as string | null | undefined;

    if (delta) {
      // Text content delta
      const content = delta["content"] as string | undefined;
      if (content !== undefined && content !== null) {
        if (!hasEmittedTextStart) {
          hasEmittedTextStart = true;
          yield { type: StreamEventType.TEXT_START, text_id: textId };
        }
        textChunks.push(content);
        yield {
          type: StreamEventType.TEXT_DELTA,
          delta: content,
          text_id: textId,
        };
      }

      // Tool call deltas
      const toolCalls = delta["tool_calls"] as Array<Record<string, unknown>> | undefined;
      if (toolCalls) {
        for (const tc of toolCalls) {
          const index = (tc["index"] as number) ?? 0;
          const fn = tc["function"] as Record<string, unknown> | undefined;

          let builder = toolCallBuilders.get(index);
          if (!builder) {
            const id = (tc["id"] as string) ?? `tool_${index}`;
            const name = fn?.["name"] as string ?? "";
            builder = { index, id, name, argChunks: [] };
            toolCallBuilders.set(index, builder);

            yield {
              type: StreamEventType.TOOL_CALL_START,
              tool_call: {
                id: builder.id,
                name: builder.name,
                arguments: {},
              },
            };
          }

          const argDelta = fn?.["arguments"] as string | undefined;
          if (argDelta) {
            builder.argChunks.push(argDelta);
            yield {
              type: StreamEventType.TOOL_CALL_DELTA,
              tool_call: {
                id: builder.id,
                name: builder.name,
                arguments: {},
                raw_arguments: argDelta,
              },
            };
          }
        }
      }
    }

    // Handle finish reason
    if (choiceFinishReason) {
      switch (choiceFinishReason) {
        case "stop":
          finishReason = { reason: "stop", raw: choiceFinishReason };
          break;
        case "length":
          finishReason = { reason: "length", raw: choiceFinishReason };
          break;
        case "tool_calls":
          finishReason = { reason: "tool_calls", raw: choiceFinishReason };
          break;
        case "content_filter":
          finishReason = { reason: "content_filter", raw: choiceFinishReason };
          break;
        default:
          finishReason = { reason: "other", raw: choiceFinishReason };
      }

      // Emit text end if we had text
      if (hasEmittedTextStart) {
        yield { type: StreamEventType.TEXT_END, text_id: textId };
      }

      // Emit tool call ends
      for (const builder of toolCallBuilders.values()) {
        const rawArgs = builder.argChunks.join("");
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(rawArgs) as Record<string, unknown>;
        } catch {
          // leave empty
        }
        contentParts.push({
          kind: ContentKind.TOOL_CALL,
          tool_call: {
            id: builder.id,
            name: builder.name,
            arguments: parsedArgs,
            type: "function",
          },
        });
        yield {
          type: StreamEventType.TOOL_CALL_END,
          tool_call: {
            id: builder.id,
            name: builder.name,
            arguments: parsedArgs,
            raw_arguments: rawArgs,
          },
        };
      }
    }
  }

  // Build final accumulated text
  const accText = textChunks.join("");
  if (accText) {
    contentParts.unshift({
      kind: ContentKind.TEXT,
      text: accText,
    });
  }

  const message: Message = {
    role: Role.ASSISTANT,
    content: contentParts,
  };

  const finalUsage = usage ?? new Usage({ input_tokens: 0, output_tokens: 0 });

  const response: Response = {
    id: responseId,
    model,
    provider: providerName,
    message,
    finish_reason: finishReason,
    usage: finalUsage,
  };

  yield {
    type: StreamEventType.FINISH,
    finish_reason: finishReason,
    usage: finalUsage,
    response,
  };
}
