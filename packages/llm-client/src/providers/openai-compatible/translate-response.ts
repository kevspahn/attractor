/**
 * Translate an OpenAI Chat Completions API response into the unified Response format.
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
// Chat Completions response types
// ---------------------------------------------------------------------------

interface ChatCompletionChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
  };
  finish_reason: string | null;
}

interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
}

interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
}

// ---------------------------------------------------------------------------
// Finish reason mapping
// ---------------------------------------------------------------------------

function mapFinishReason(raw: string | null): FinishReason {
  if (!raw) return { reason: "other" };

  switch (raw) {
    case "stop":
      return { reason: "stop", raw };
    case "length":
      return { reason: "length", raw };
    case "tool_calls":
      return { reason: "tool_calls", raw };
    case "content_filter":
      return { reason: "content_filter", raw };
    default:
      return { reason: "other", raw };
  }
}

// ---------------------------------------------------------------------------
// Main translation function
// ---------------------------------------------------------------------------

export function translateResponse(raw: unknown, providerName: string): Response {
  const data = raw as ChatCompletionResponse;
  const choice = data.choices?.[0];

  const contentParts: ContentPart[] = [];

  if (choice?.message?.content) {
    contentParts.push({
      kind: ContentKind.TEXT,
      text: choice.message.content,
    });
  }

  if (choice?.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        // leave empty
      }
      contentParts.push({
        kind: ContentKind.TOOL_CALL,
        tool_call: {
          id: tc.id,
          name: tc.function.name,
          arguments: parsedArgs,
          type: "function",
        },
      });
    }
  }

  const message: Message = {
    role: Role.ASSISTANT,
    content: contentParts,
  };

  const rawUsage = data.usage;
  const usage = new Usage({
    input_tokens: rawUsage?.prompt_tokens ?? 0,
    output_tokens: rawUsage?.completion_tokens ?? 0,
    raw: rawUsage as unknown as Record<string, unknown>,
  });

  return {
    id: data.id ?? "",
    model: data.model ?? "",
    provider: providerName,
    message,
    finish_reason: mapFinishReason(choice?.finish_reason ?? null),
    usage,
    raw: data as unknown as Record<string, unknown>,
  };
}
