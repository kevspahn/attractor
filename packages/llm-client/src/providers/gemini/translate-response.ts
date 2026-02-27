/**
 * Translate a Gemini API response into the unified Response format.
 *
 * Per spec Sections 7.5 and 3.8-3.9.
 * - candidates[0].content.parts: text -> TEXT, functionCall -> TOOL_CALL
 * - Finish reason: STOP -> stop, MAX_TOKENS -> length, SAFETY/RECITATION -> content_filter
 * - Infer tool_calls from presence of functionCall parts
 * - Synthetic tool call IDs generated via crypto.randomUUID()
 */

import {
  ContentKind,
  Role,
  Usage,
  type ContentPart,
  type FinishReason,
  type Message,
  type Response,
} from "../../types/index.js";
import { GeminiIdMap } from "./translate-request.js";

// ---------------------------------------------------------------------------
// Gemini response types
// ---------------------------------------------------------------------------

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  thought?: boolean;
}

interface GeminiCandidate {
  content?: {
    parts: GeminiPart[];
    role: string;
  };
  finishReason?: string;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
}

// ---------------------------------------------------------------------------
// Finish reason mapping
// ---------------------------------------------------------------------------

function mapFinishReason(raw: string | undefined, hasToolCalls: boolean): FinishReason {
  // Infer tool_calls from presence of functionCall parts
  if (hasToolCalls) {
    return { reason: "tool_calls", raw: raw ?? "TOOL_CALLS" };
  }

  if (!raw) return { reason: "other" };

  switch (raw) {
    case "STOP":
      return { reason: "stop", raw };
    case "MAX_TOKENS":
      return { reason: "length", raw };
    case "SAFETY":
      return { reason: "content_filter", raw };
    case "RECITATION":
      return { reason: "content_filter", raw };
    default:
      return { reason: "other", raw };
  }
}

// ---------------------------------------------------------------------------
// Generate synthetic IDs
// ---------------------------------------------------------------------------

function generateSyntheticId(): string {
  // Use crypto.randomUUID if available, otherwise fallback
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `call_${crypto.randomUUID()}`;
  }
  // Fallback: generate a simple random ID
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "call_";
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// ---------------------------------------------------------------------------
// Part translation
// ---------------------------------------------------------------------------

function translateParts(
  parts: GeminiPart[],
  idMap: GeminiIdMap,
): { contentParts: ContentPart[]; hasToolCalls: boolean } {
  const contentParts: ContentPart[] = [];
  let hasToolCalls = false;

  for (const part of parts) {
    if (part.text !== undefined) {
      if (part.thought) {
        contentParts.push({
          kind: ContentKind.THINKING,
          thinking: {
            text: part.text,
            redacted: false,
          },
        });
      } else {
        contentParts.push({
          kind: ContentKind.TEXT,
          text: part.text,
        });
      }
    } else if (part.functionCall) {
      hasToolCalls = true;
      const syntheticId = generateSyntheticId();
      idMap.register(syntheticId, part.functionCall.name);
      contentParts.push({
        kind: ContentKind.TOOL_CALL,
        tool_call: {
          id: syntheticId,
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {},
          type: "function",
        },
      });
    }
  }

  return { contentParts, hasToolCalls };
}

// ---------------------------------------------------------------------------
// Main translation function
// ---------------------------------------------------------------------------

export function translateResponse(raw: unknown, idMap: GeminiIdMap): Response {
  const data = raw as GeminiResponse;
  const candidate = data.candidates?.[0];

  let contentParts: ContentPart[] = [];
  let hasToolCalls = false;

  if (candidate?.content?.parts) {
    const result = translateParts(candidate.content.parts, idMap);
    contentParts = result.contentParts;
    hasToolCalls = result.hasToolCalls;
  }

  const message: Message = {
    role: Role.ASSISTANT,
    content: contentParts,
  };

  const usageMeta = data.usageMetadata;
  const usage = new Usage({
    input_tokens: usageMeta?.promptTokenCount ?? 0,
    output_tokens: usageMeta?.candidatesTokenCount ?? 0,
    reasoning_tokens: usageMeta?.thoughtsTokenCount,
    cache_read_tokens: usageMeta?.cachedContentTokenCount,
    raw: usageMeta as unknown as Record<string, unknown>,
  });

  return {
    id: "",
    model: data.modelVersion ?? "",
    provider: "gemini",
    message,
    finish_reason: mapFinishReason(candidate?.finishReason, hasToolCalls),
    usage,
    raw: data as unknown as Record<string, unknown>,
  };
}
