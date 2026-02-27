/**
 * Translate a unified Request into OpenAI Chat Completions API format.
 *
 * Per spec Section 7.10: for third-party endpoints (vLLM, Ollama, Together, Groq).
 * Uses `messages` array (not `input`) and standard chat completions format.
 */

import {
  ContentKind,
  Role,
  type Request,
  type Message,
  type ContentPart,
  type Tool,
} from "../../types/index.js";

// ---------------------------------------------------------------------------
// Chat Completions native types
// ---------------------------------------------------------------------------

export type ChatCompletionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } };

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant" | "tool" | "developer";
  content: string | ChatCompletionContentPart[] | null;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface ChatCompletionToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionRequestBody {
  model: string;
  messages: ChatCompletionMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: readonly string[];
  stream?: boolean;
  tools?: ChatCompletionToolDef[];
  tool_choice?: string | { type: string; function?: { name: string } };
  stream_options?: { include_usage: boolean };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bufferToBase64(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Message translation
// ---------------------------------------------------------------------------

function translateContentParts(parts: readonly ContentPart[]): ChatCompletionContentPart[] {
  const result: ChatCompletionContentPart[] = [];
  for (const part of parts) {
    switch (part.kind) {
      case ContentKind.TEXT:
        result.push({ type: "text", text: part.text });
        break;
      case ContentKind.IMAGE: {
        const img = part.image;
        let url: string;
        if (img.url) {
          url = img.url;
        } else if (img.data) {
          const b64 = typeof img.data === "string"
            ? img.data
            : bufferToBase64(img.data);
          url = `data:${img.media_type ?? "image/png"};base64,${b64}`;
        } else {
          break;
        }
        result.push({
          type: "image_url",
          image_url: { url, ...(img.detail ? { detail: img.detail } : {}) },
        });
        break;
      }
    }
  }
  return result;
}

function translateMessages(messages: readonly Message[]): ChatCompletionMessage[] {
  const result: ChatCompletionMessage[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case Role.SYSTEM: {
        const text = msg.content
          .filter((p): p is ContentPart & { kind: "text" } => p.kind === ContentKind.TEXT)
          .map(p => p.text)
          .join("\n");
        result.push({ role: "system", content: text });
        break;
      }

      case Role.DEVELOPER: {
        const text = msg.content
          .filter((p): p is ContentPart & { kind: "text" } => p.kind === ContentKind.TEXT)
          .map(p => p.text)
          .join("\n");
        result.push({ role: "developer", content: text });
        break;
      }

      case Role.USER: {
        const parts = translateContentParts(msg.content);
        const first = parts[0];
        if (parts.length === 1 && first && first.type === "text") {
          result.push({ role: "user", content: first.text });
        } else {
          result.push({ role: "user", content: parts });
        }
        break;
      }

      case Role.ASSISTANT: {
        const textParts: string[] = [];
        const toolCalls: Array<{
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        }> = [];

        for (const part of msg.content) {
          if (part.kind === ContentKind.TEXT) {
            textParts.push(part.text);
          } else if (part.kind === ContentKind.TOOL_CALL) {
            const tc = part.tool_call;
            const args = typeof tc.arguments === "string"
              ? tc.arguments
              : JSON.stringify(tc.arguments);
            toolCalls.push({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: args },
            });
          }
        }

        const chatMsg: ChatCompletionMessage = {
          role: "assistant",
          content: textParts.length > 0 ? textParts.join("") : null,
        };
        if (toolCalls.length > 0) {
          chatMsg.tool_calls = toolCalls;
        }
        result.push(chatMsg);
        break;
      }

      case Role.TOOL: {
        for (const part of msg.content) {
          if (part.kind === ContentKind.TOOL_RESULT) {
            const tr = part.tool_result;
            const content = typeof tr.content === "string"
              ? tr.content
              : JSON.stringify(tr.content);
            result.push({
              role: "tool",
              content,
              tool_call_id: tr.tool_call_id,
            });
          }
        }
        break;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool definition translation
// ---------------------------------------------------------------------------

function translateTools(tools: readonly Tool[]): ChatCompletionToolDef[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

// ---------------------------------------------------------------------------
// Tool choice translation
// ---------------------------------------------------------------------------

function translateToolChoice(
  toolChoice: Request["tool_choice"],
): string | { type: string; function?: { name: string } } | undefined {
  if (!toolChoice) return undefined;

  switch (toolChoice.mode) {
    case "auto":
      return "auto";
    case "none":
      return "none";
    case "required":
      return "required";
    case "named":
      return {
        type: "function",
        function: { name: toolChoice.tool_name! },
      };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Main translation function
// ---------------------------------------------------------------------------

export function translateRequest(request: Request): ChatCompletionRequestBody {
  const messages = translateMessages(request.messages);

  const body: ChatCompletionRequestBody = {
    model: request.model,
    messages,
  };

  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  if (request.top_p !== undefined) {
    body.top_p = request.top_p;
  }

  if (request.max_tokens !== undefined) {
    body.max_tokens = request.max_tokens;
  }

  if (request.stop_sequences && request.stop_sequences.length > 0) {
    body.stop = request.stop_sequences;
  }

  if (request.tools && request.tools.length > 0) {
    body.tools = translateTools(request.tools);
    const tc = translateToolChoice(request.tool_choice);
    if (tc !== undefined) {
      body.tool_choice = tc;
    }
  }

  return body;
}
