/**
 * Translate an OpenAI Responses API response into the unified Response format.
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
// OpenAI Responses API response types
// ---------------------------------------------------------------------------

interface OpenAIOutputItem {
  type: string;
  // For message items
  role?: string;
  content?: Array<{
    type: string;
    text?: string;
  }>;
  // For function_call items
  id?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
}

interface OpenAIResponsesUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens?: number;
  output_tokens_details?: {
    reasoning_tokens?: number;
  };
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}

interface OpenAIResponsesResponse {
  id: string;
  model: string;
  output: OpenAIOutputItem[];
  status: string;
  usage?: OpenAIResponsesUsage;
}

// ---------------------------------------------------------------------------
// Finish reason mapping
// ---------------------------------------------------------------------------

function mapFinishReason(status: string, hasToolCalls: boolean): FinishReason {
  if (hasToolCalls) {
    return { reason: "tool_calls", raw: status };
  }

  switch (status) {
    case "completed":
      return { reason: "stop", raw: status };
    case "failed":
      return { reason: "error", raw: status };
    case "incomplete":
      return { reason: "length", raw: status };
    default:
      return { reason: "other", raw: status };
  }
}

// ---------------------------------------------------------------------------
// Output item translation
// ---------------------------------------------------------------------------

function translateOutputItems(output: OpenAIOutputItem[]): {
  parts: ContentPart[];
  hasToolCalls: boolean;
} {
  const parts: ContentPart[] = [];
  let hasToolCalls = false;

  for (const item of output) {
    if (item.type === "message") {
      for (const content of item.content ?? []) {
        if (content.type === "output_text" && content.text !== undefined) {
          parts.push({
            kind: ContentKind.TEXT,
            text: content.text,
          });
        }
      }
    } else if (item.type === "function_call") {
      hasToolCalls = true;
      let parsedArgs: Record<string, unknown> = {};
      try {
        if (item.arguments) {
          parsedArgs = JSON.parse(item.arguments) as Record<string, unknown>;
        }
      } catch {
        // leave as empty
      }
      parts.push({
        kind: ContentKind.TOOL_CALL,
        tool_call: {
          id: item.call_id ?? item.id ?? "",
          name: item.name ?? "",
          arguments: parsedArgs,
          type: "function",
        },
      });
    }
  }

  return { parts, hasToolCalls };
}

// ---------------------------------------------------------------------------
// Main translation function
// ---------------------------------------------------------------------------

export function translateResponse(raw: unknown): Response {
  const data = raw as OpenAIResponsesResponse;

  const { parts, hasToolCalls } = translateOutputItems(data.output ?? []);

  const message: Message = {
    role: Role.ASSISTANT,
    content: parts,
  };

  const rawUsage = data.usage;
  const usage = new Usage({
    input_tokens: rawUsage?.input_tokens ?? 0,
    output_tokens: rawUsage?.output_tokens ?? 0,
    reasoning_tokens: rawUsage?.output_tokens_details?.reasoning_tokens,
    cache_read_tokens: rawUsage?.prompt_tokens_details?.cached_tokens,
    raw: rawUsage as unknown as Record<string, unknown>,
  });

  return {
    id: data.id ?? "",
    model: data.model ?? "",
    provider: "openai",
    message,
    finish_reason: mapFinishReason(data.status ?? "completed", hasToolCalls),
    usage,
    raw: data as unknown as Record<string, unknown>,
  };
}
