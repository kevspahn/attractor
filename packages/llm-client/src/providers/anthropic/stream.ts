/**
 * Anthropic streaming translation.
 *
 * Translates Anthropic SSE events into unified StreamEvent objects.
 * Per spec Section 7.7 (Anthropic Streaming).
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

interface BlockInfo {
  index: number;
  type: string;
  id?: string;
  name?: string;
}

/**
 * Translate Anthropic SSE events into unified StreamEvent objects.
 */
export async function* translateStream(
  sseStream: AsyncIterableIterator<SSEEvent>,
): AsyncIterableIterator<StreamEvent> {
  // Accumulation state
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens: number | undefined;
  let cacheWriteTokens: number | undefined;
  let responseId = "";
  let model = "";
  let finishReason: FinishReason = { reason: "other" };
  const contentParts: ContentPart[] = [];
  const currentBlocks = new Map<number, BlockInfo>();
  const toolArgChunks = new Map<number, string[]>();
  const textChunks = new Map<number, string[]>();
  const thinkingChunks = new Map<number, string[]>();

  for await (const sse of sseStream) {
    if (!sse.data || sse.data === "[DONE]") continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(sse.data) as Record<string, unknown>;
    } catch {
      continue;
    }

    const eventType = (sse.event ?? parsed["type"]) as string;

    switch (eventType) {
      case "message_start": {
        const message = parsed["message"] as Record<string, unknown> | undefined;
        if (message) {
          responseId = (message["id"] as string) ?? "";
          model = (message["model"] as string) ?? "";
          const usage = message["usage"] as Record<string, unknown> | undefined;
          if (usage) {
            inputTokens = (usage["input_tokens"] as number) ?? 0;
            if (usage["cache_read_input_tokens"] !== undefined) {
              cacheReadTokens = usage["cache_read_input_tokens"] as number;
            }
            if (usage["cache_creation_input_tokens"] !== undefined) {
              cacheWriteTokens = usage["cache_creation_input_tokens"] as number;
            }
          }
        }
        yield {
          type: StreamEventType.STREAM_START,
          usage: new Usage({
            input_tokens: inputTokens,
            output_tokens: 0,
            cache_read_tokens: cacheReadTokens,
            cache_write_tokens: cacheWriteTokens,
          }),
        };
        break;
      }

      case "content_block_start": {
        const index = parsed["index"] as number;
        const block = parsed["content_block"] as Record<string, unknown>;
        const blockType = block["type"] as string;

        const info: BlockInfo = { index, type: blockType };
        if (blockType === "tool_use") {
          info.id = block["id"] as string;
          info.name = block["name"] as string;
          toolArgChunks.set(index, []);
        }
        if (blockType === "text") {
          textChunks.set(index, []);
        }
        if (blockType === "thinking") {
          thinkingChunks.set(index, []);
        }
        currentBlocks.set(index, info);

        if (blockType === "text") {
          yield {
            type: StreamEventType.TEXT_START,
            text_id: `text_${index}`,
          };
        } else if (blockType === "tool_use") {
          yield {
            type: StreamEventType.TOOL_CALL_START,
            tool_call: {
              id: info.id ?? "",
              name: info.name ?? "",
              arguments: {},
            },
          };
        } else if (blockType === "thinking") {
          yield { type: StreamEventType.REASONING_START };
        }
        break;
      }

      case "content_block_delta": {
        const index = parsed["index"] as number;
        const delta = parsed["delta"] as Record<string, unknown>;
        const deltaType = delta["type"] as string;
        const blockInfo = currentBlocks.get(index);

        if (deltaType === "text_delta") {
          const text = delta["text"] as string;
          const chunks = textChunks.get(index);
          if (chunks) chunks.push(text);
          yield {
            type: StreamEventType.TEXT_DELTA,
            delta: text,
            text_id: `text_${index}`,
          };
        } else if (deltaType === "input_json_delta") {
          const partialJson = delta["partial_json"] as string;
          const chunks = toolArgChunks.get(index);
          if (chunks) chunks.push(partialJson);
          yield {
            type: StreamEventType.TOOL_CALL_DELTA,
            tool_call: {
              id: blockInfo?.id ?? "",
              name: blockInfo?.name ?? "",
              arguments: {},
              raw_arguments: partialJson,
            },
          };
        } else if (deltaType === "thinking_delta") {
          const thinking = delta["thinking"] as string;
          const chunks = thinkingChunks.get(index);
          if (chunks) chunks.push(thinking);
          yield {
            type: StreamEventType.REASONING_DELTA,
            reasoning_delta: thinking,
          };
        }
        break;
      }

      case "content_block_stop": {
        const index = parsed["index"] as number;
        const blockInfo = currentBlocks.get(index);

        if (blockInfo?.type === "text") {
          const chunks = textChunks.get(index) ?? [];
          const fullText = chunks.join("");
          contentParts.push({
            kind: ContentKind.TEXT,
            text: fullText,
          });
          yield {
            type: StreamEventType.TEXT_END,
            text_id: `text_${index}`,
          };
        } else if (blockInfo?.type === "tool_use") {
          const chunks = toolArgChunks.get(index) ?? [];
          const rawArgs = chunks.join("");
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(rawArgs) as Record<string, unknown>;
          } catch {
            // leave empty
          }
          contentParts.push({
            kind: ContentKind.TOOL_CALL,
            tool_call: {
              id: blockInfo.id ?? "",
              name: blockInfo.name ?? "",
              arguments: parsedArgs,
              type: "function",
            },
          });
          yield {
            type: StreamEventType.TOOL_CALL_END,
            tool_call: {
              id: blockInfo.id ?? "",
              name: blockInfo.name ?? "",
              arguments: parsedArgs,
              raw_arguments: rawArgs,
            },
          };
        } else if (blockInfo?.type === "thinking") {
          const chunks = thinkingChunks.get(index) ?? [];
          const fullThinking = chunks.join("");
          contentParts.push({
            kind: ContentKind.THINKING,
            thinking: {
              text: fullThinking,
              redacted: false,
            },
          });
          yield { type: StreamEventType.REASONING_END };
        }

        currentBlocks.delete(index);
        break;
      }

      case "message_delta": {
        const delta = parsed["delta"] as Record<string, unknown> | undefined;
        if (delta) {
          const stopReason = delta["stop_reason"] as string | undefined;
          if (stopReason) {
            finishReason = mapFinishReason(stopReason);
          }
        }
        const usage = parsed["usage"] as Record<string, unknown> | undefined;
        if (usage) {
          outputTokens = (usage["output_tokens"] as number) ?? 0;
        }
        break;
      }

      case "message_stop": {
        const message: Message = {
          role: Role.ASSISTANT,
          content: contentParts,
        };
        const usage = new Usage({
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: cacheReadTokens,
          cache_write_tokens: cacheWriteTokens,
        });
        const response: Response = {
          id: responseId,
          model,
          provider: "anthropic",
          message,
          finish_reason: finishReason,
          usage,
        };
        yield {
          type: StreamEventType.FINISH,
          finish_reason: finishReason,
          usage,
          response,
        };
        break;
      }

      case "error": {
        yield {
          type: StreamEventType.ERROR,
          raw: parsed,
        };
        break;
      }

      default:
        // Unknown events are passed through
        break;
    }
  }
}

function mapFinishReason(raw: string): FinishReason {
  switch (raw) {
    case "end_turn":
      return { reason: "stop", raw };
    case "stop_sequence":
      return { reason: "stop", raw };
    case "max_tokens":
      return { reason: "length", raw };
    case "tool_use":
      return { reason: "tool_calls", raw };
    default:
      return { reason: "other", raw };
  }
}
