/**
 * Gemini streaming translation.
 *
 * Per spec Section 7.7 (Gemini Streaming):
 * - SSE with ?alt=sse query parameter
 * - text parts -> TEXT_DELTA (emit TEXT_START on first)
 * - functionCall parts -> TOOL_CALL_START + TOOL_CALL_END (complete in one chunk)
 * - finishReason in candidate -> TEXT_END
 * - Final chunk -> FINISH with accumulated response
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
import { GeminiIdMap } from "./translate-request.js";

// ---------------------------------------------------------------------------
// Generate synthetic IDs
// ---------------------------------------------------------------------------

function generateSyntheticId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `call_${crypto.randomUUID()}`;
  }
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "call_";
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// ---------------------------------------------------------------------------
// Streaming state
// ---------------------------------------------------------------------------

/**
 * Translate Gemini SSE events into unified StreamEvent objects.
 */
export async function* translateStream(
  sseStream: AsyncIterableIterator<SSEEvent>,
  idMap: GeminiIdMap,
): AsyncIterableIterator<StreamEvent> {
  let hasEmittedStreamStart = false;
  let hasEmittedTextStart = false;
  const textId = "text_0";

  // Accumulation
  const textChunks: string[] = [];
  const contentParts: ContentPart[] = [];
  let finishReason: FinishReason = { reason: "other" };
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens: number | undefined;
  let cacheReadTokens: number | undefined;
  let hasToolCalls = false;
  let model = "";

  for await (const sse of sseStream) {
    if (!sse.data) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(sse.data) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (!hasEmittedStreamStart) {
      hasEmittedStreamStart = true;
      yield { type: StreamEventType.STREAM_START };
    }

    // Extract model version
    if (parsed["modelVersion"]) {
      model = parsed["modelVersion"] as string;
    }

    // Process usage metadata
    const usageMeta = parsed["usageMetadata"] as Record<string, unknown> | undefined;
    if (usageMeta) {
      inputTokens = (usageMeta["promptTokenCount"] as number) ?? inputTokens;
      outputTokens = (usageMeta["candidatesTokenCount"] as number) ?? outputTokens;
      if (usageMeta["thoughtsTokenCount"] !== undefined) {
        reasoningTokens = usageMeta["thoughtsTokenCount"] as number;
      }
      if (usageMeta["cachedContentTokenCount"] !== undefined) {
        cacheReadTokens = usageMeta["cachedContentTokenCount"] as number;
      }
    }

    // Process candidates
    const candidates = parsed["candidates"] as Array<Record<string, unknown>> | undefined;
    if (!candidates || candidates.length === 0) continue;

    const candidate = candidates[0]!;
    const content = candidate["content"] as Record<string, unknown> | undefined;
    const candidateFinishReason = candidate["finishReason"] as string | undefined;

    if (content) {
      const parts = content["parts"] as Array<Record<string, unknown>> | undefined;
      if (parts) {
        for (const part of parts) {
          if (part["text"] !== undefined) {
            const text = part["text"] as string;

            if (part["thought"]) {
              // Thinking/reasoning text
              yield { type: StreamEventType.REASONING_START };
              yield {
                type: StreamEventType.REASONING_DELTA,
                reasoning_delta: text,
              };
              yield { type: StreamEventType.REASONING_END };
              contentParts.push({
                kind: ContentKind.THINKING,
                thinking: { text, redacted: false },
              });
            } else {
              // Regular text
              if (!hasEmittedTextStart) {
                hasEmittedTextStart = true;
                yield { type: StreamEventType.TEXT_START, text_id: textId };
              }
              textChunks.push(text);
              yield {
                type: StreamEventType.TEXT_DELTA,
                delta: text,
                text_id: textId,
              };
            }
          } else if (part["functionCall"]) {
            const fc = part["functionCall"] as Record<string, unknown>;
            const name = fc["name"] as string;
            const args = (fc["args"] as Record<string, unknown>) ?? {};
            const syntheticId = generateSyntheticId();
            idMap.register(syntheticId, name);
            hasToolCalls = true;

            contentParts.push({
              kind: ContentKind.TOOL_CALL,
              tool_call: {
                id: syntheticId,
                name,
                arguments: args,
                type: "function",
              },
            });

            // Gemini delivers function calls complete in one chunk
            yield {
              type: StreamEventType.TOOL_CALL_START,
              tool_call: {
                id: syntheticId,
                name,
                arguments: args,
              },
            };
            yield {
              type: StreamEventType.TOOL_CALL_END,
              tool_call: {
                id: syntheticId,
                name,
                arguments: args,
              },
            };
          }
        }
      }
    }

    // Handle finish reason
    if (candidateFinishReason) {
      if (hasEmittedTextStart) {
        yield { type: StreamEventType.TEXT_END, text_id: textId };
        hasEmittedTextStart = false; // Reset so we don't emit again
      }

      if (hasToolCalls) {
        finishReason = { reason: "tool_calls", raw: candidateFinishReason };
      } else {
        switch (candidateFinishReason) {
          case "STOP":
            finishReason = { reason: "stop", raw: candidateFinishReason };
            break;
          case "MAX_TOKENS":
            finishReason = { reason: "length", raw: candidateFinishReason };
            break;
          case "SAFETY":
          case "RECITATION":
            finishReason = { reason: "content_filter", raw: candidateFinishReason };
            break;
          default:
            finishReason = { reason: "other", raw: candidateFinishReason };
        }
      }
    }
  }

  // Build final response
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

  const usage = new Usage({
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    reasoning_tokens: reasoningTokens,
    cache_read_tokens: cacheReadTokens,
  });

  const response: Response = {
    id: "",
    model,
    provider: "gemini",
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
}
