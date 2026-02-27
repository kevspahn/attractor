/**
 * Translate an Anthropic Messages API response into the unified Response format.
 *
 * Per spec Sections 7.5 and 3.8-3.9.
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

// ---------------------------------------------------------------------------
// Anthropic response types
// ---------------------------------------------------------------------------

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  thinking?: string;
  signature?: string;
  data?: string;
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

// ---------------------------------------------------------------------------
// Finish reason mapping
// ---------------------------------------------------------------------------

function mapFinishReason(raw: string | null): FinishReason {
  if (!raw) return { reason: "other" };

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

// ---------------------------------------------------------------------------
// Content block translation
// ---------------------------------------------------------------------------

function translateContentBlock(block: AnthropicContentBlock): ContentPart | null {
  switch (block.type) {
    case "text":
      return {
        kind: ContentKind.TEXT,
        text: block.text ?? "",
      };

    case "tool_use":
      return {
        kind: ContentKind.TOOL_CALL,
        tool_call: {
          id: block.id ?? "",
          name: block.name ?? "",
          arguments: block.input ?? {},
          type: "function",
        },
      };

    case "thinking":
      return {
        kind: ContentKind.THINKING,
        thinking: {
          text: block.thinking ?? "",
          signature: block.signature,
          redacted: false,
        },
      };

    case "redacted_thinking":
      return {
        kind: ContentKind.REDACTED_THINKING,
        thinking: {
          text: block.data ?? "",
          redacted: true,
        },
      };

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main translation function
// ---------------------------------------------------------------------------

export function translateResponse(raw: unknown): Response {
  const data = raw as AnthropicResponse;

  const contentParts: ContentPart[] = [];
  for (const block of data.content) {
    const part = translateContentBlock(block);
    if (part) {
      contentParts.push(part);
    }
  }

  const message: Message = {
    role: Role.ASSISTANT,
    content: contentParts,
  };

  const usage = new Usage({
    input_tokens: data.usage.input_tokens,
    output_tokens: data.usage.output_tokens,
    cache_read_tokens: data.usage.cache_read_input_tokens,
    cache_write_tokens: data.usage.cache_creation_input_tokens,
    raw: data.usage as unknown as Record<string, unknown>,
  });

  return {
    id: data.id,
    model: data.model,
    provider: "anthropic",
    message,
    finish_reason: mapFinishReason(data.stop_reason),
    usage,
    raw: data as unknown as Record<string, unknown>,
  };
}
