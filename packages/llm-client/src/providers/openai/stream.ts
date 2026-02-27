/**
 * OpenAI Responses API streaming translation.
 *
 * Per spec Section 7.7 (OpenAI Streaming - Responses API):
 * - response.output_text.delta -> TEXT_DELTA
 * - response.function_call_arguments.delta -> TOOL_CALL_DELTA
 * - response.output_item.done -> TEXT_END or TOOL_CALL_END
 * - response.completed -> FINISH with usage
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

/**
 * Translate OpenAI Responses API SSE events into unified StreamEvent objects.
 */
export async function* translateStream(
  sseStream: AsyncIterableIterator<SSEEvent>,
): AsyncIterableIterator<StreamEvent> {
  let responseId = "";
  let model = "";
  let hasEmittedStreamStart = false;
  let hasEmittedTextStart = false;
  let textId = "text_0";

  // Accumulation
  const textChunks: string[] = [];
  const contentParts: ContentPart[] = [];
  const toolCalls = new Map<
    string,
    { id: string; name: string; argChunks: string[]; callId: string }
  >();
  let finishReason: FinishReason = { reason: "other" };
  let usage: Usage | undefined;

  for await (const sse of sseStream) {
    if (!sse.data || sse.data === "[DONE]") continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(sse.data) as Record<string, unknown>;
    } catch {
      continue;
    }

    const eventType = sse.event as string;

    switch (eventType) {
      case "response.created": {
        const response = parsed as Record<string, unknown>;
        responseId = (response["id"] as string) ?? "";
        model = (response["model"] as string) ?? "";
        break;
      }

      case "response.in_progress": {
        if (!hasEmittedStreamStart) {
          hasEmittedStreamStart = true;
          yield { type: StreamEventType.STREAM_START };
        }
        break;
      }

      case "response.output_text.delta": {
        const delta = (parsed["delta"] as string) ?? "";
        textChunks.push(delta);

        if (!hasEmittedTextStart) {
          hasEmittedTextStart = true;
          yield { type: StreamEventType.TEXT_START, text_id: textId };
        }

        yield {
          type: StreamEventType.TEXT_DELTA,
          delta,
          text_id: textId,
        };
        break;
      }

      case "response.function_call_arguments.delta": {
        const itemId = (parsed["item_id"] as string) ?? "";
        const delta = (parsed["delta"] as string) ?? "";

        let tc = toolCalls.get(itemId);
        if (!tc) {
          tc = { id: itemId, name: "", argChunks: [], callId: itemId };
          toolCalls.set(itemId, tc);
        }
        tc.argChunks.push(delta);

        yield {
          type: StreamEventType.TOOL_CALL_DELTA,
          tool_call: {
            id: tc.callId,
            name: tc.name,
            arguments: {},
            raw_arguments: delta,
          },
        };
        break;
      }

      case "response.output_item.added": {
        const item = parsed["item"] as Record<string, unknown> | undefined;
        if (item) {
          const itemType = item["type"] as string;
          const itemId = (item["id"] as string) ?? "";
          if (itemType === "function_call") {
            const name = (item["name"] as string) ?? "";
            const callId = (item["call_id"] as string) ?? itemId;
            toolCalls.set(itemId, { id: itemId, name, argChunks: [], callId });
            yield {
              type: StreamEventType.TOOL_CALL_START,
              tool_call: {
                id: callId,
                name,
                arguments: {},
              },
            };
          }
        }
        break;
      }

      case "response.output_item.done": {
        const item = parsed["item"] as Record<string, unknown> | undefined;
        if (!item) break;
        const itemType = item["type"] as string;

        if (itemType === "message") {
          // Text content complete
          if (hasEmittedTextStart) {
            yield { type: StreamEventType.TEXT_END, text_id: textId };
          }
          // Extract text from the message content
          const msgContent = item["content"] as Array<Record<string, unknown>> | undefined;
          if (msgContent) {
            for (const c of msgContent) {
              if (c["type"] === "output_text" && c["text"] !== undefined) {
                contentParts.push({
                  kind: ContentKind.TEXT,
                  text: c["text"] as string,
                });
              }
            }
          }
        } else if (itemType === "function_call") {
          const itemId = (item["id"] as string) ?? "";
          const name = (item["name"] as string) ?? "";
          const rawArgs = (item["arguments"] as string) ?? "";
          const callId = (item["call_id"] as string) ?? itemId;

          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(rawArgs) as Record<string, unknown>;
          } catch {
            // leave empty
          }

          contentParts.push({
            kind: ContentKind.TOOL_CALL,
            tool_call: {
              id: callId,
              name,
              arguments: parsedArgs,
              type: "function",
            },
          });

          yield {
            type: StreamEventType.TOOL_CALL_END,
            tool_call: {
              id: callId,
              name,
              arguments: parsedArgs,
              raw_arguments: rawArgs,
            },
          };
        }
        break;
      }

      case "response.completed": {
        const response = parsed["response"] as Record<string, unknown> | undefined;
        if (response) {
          responseId = (response["id"] as string) ?? responseId;
          model = (response["model"] as string) ?? model;
          const status = (response["status"] as string) ?? "completed";
          const hasToolCalls = contentParts.some(p => p.kind === ContentKind.TOOL_CALL);

          if (hasToolCalls) {
            finishReason = { reason: "tool_calls", raw: status };
          } else {
            switch (status) {
              case "completed":
                finishReason = { reason: "stop", raw: status };
                break;
              case "incomplete":
                finishReason = { reason: "length", raw: status };
                break;
              default:
                finishReason = { reason: "other", raw: status };
            }
          }

          const rawUsage = response["usage"] as Record<string, unknown> | undefined;
          if (rawUsage) {
            const outputDetails = rawUsage["output_tokens_details"] as Record<string, unknown> | undefined;
            const promptDetails = rawUsage["prompt_tokens_details"] as Record<string, unknown> | undefined;
            usage = new Usage({
              input_tokens: (rawUsage["input_tokens"] as number) ?? 0,
              output_tokens: (rawUsage["output_tokens"] as number) ?? 0,
              reasoning_tokens: outputDetails?.["reasoning_tokens"] as number | undefined,
              cache_read_tokens: promptDetails?.["cached_tokens"] as number | undefined,
              raw: rawUsage,
            });
          }
        }

        // Build accumulated text from chunks if contentParts don't have text yet
        const accText = textChunks.join("");
        if (accText && !contentParts.some(p => p.kind === ContentKind.TEXT)) {
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

        const finalResponse: Response = {
          id: responseId,
          model,
          provider: "openai",
          message,
          finish_reason: finishReason,
          usage: finalUsage,
        };

        yield {
          type: StreamEventType.FINISH,
          finish_reason: finishReason,
          usage: finalUsage,
          response: finalResponse,
        };
        break;
      }

      default:
        // Other events are ignored
        break;
    }
  }
}
