/**
 * Translate a unified Request into OpenAI Responses API format.
 *
 * Per spec Section 7.3 (OpenAI Responses API):
 * - SYSTEM/DEVELOPER -> `instructions` parameter
 * - Messages go in `input` array (NOT `messages`)
 * - Tool calls/results are top-level input items
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
// OpenAI Responses API native types
// ---------------------------------------------------------------------------

export type OpenAIInputItem =
  | { type: "message"; role: "user" | "assistant" | "developer"; content: OpenAIContentBlock[] }
  | { type: "function_call"; id: string; name: string; arguments: string; call_id: string }
  | { type: "function_call_output"; call_id: string; output: string };

export type OpenAIContentBlock =
  | { type: "input_text"; text: string }
  | { type: "output_text"; text: string }
  | { type: "input_image"; image_url: string };

export interface OpenAIToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: boolean;
}

export interface OpenAIRequestBody {
  model: string;
  input: OpenAIInputItem[];
  instructions?: string;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  tools?: OpenAIToolDefinition[];
  tool_choice?: string | { type: string; function?: { name: string } };
  reasoning?: { effort: string };
  stream?: boolean;
  metadata?: Record<string, string>;
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
// Content part translation
// ---------------------------------------------------------------------------

function translateUserContentPart(part: ContentPart): OpenAIContentBlock | null {
  switch (part.kind) {
    case ContentKind.TEXT:
      return { type: "input_text", text: part.text };

    case ContentKind.IMAGE: {
      const img = part.image;
      if (img.url) {
        return { type: "input_image", image_url: img.url };
      }
      if (img.data) {
        const base64 = typeof img.data === "string"
          ? img.data
          : bufferToBase64(img.data);
        const mime = img.media_type ?? "image/png";
        return { type: "input_image", image_url: `data:${mime};base64,${base64}` };
      }
      return null;
    }

    default:
      return null;
  }
}

function translateAssistantContentPart(part: ContentPart): OpenAIContentBlock | null {
  switch (part.kind) {
    case ContentKind.TEXT:
      return { type: "output_text", text: part.text };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// System/instructions extraction
// ---------------------------------------------------------------------------

function extractInstructions(messages: readonly Message[]): {
  instructions: string | undefined;
  nonSystemMessages: Message[];
} {
  const systemTexts: string[] = [];
  const nonSystemMessages: Message[] = [];

  for (const msg of messages) {
    if (msg.role === Role.SYSTEM || msg.role === Role.DEVELOPER) {
      for (const part of msg.content) {
        if (part.kind === ContentKind.TEXT) {
          systemTexts.push(part.text);
        }
      }
    } else {
      nonSystemMessages.push(msg);
    }
  }

  return {
    instructions: systemTexts.length > 0 ? systemTexts.join("\n") : undefined,
    nonSystemMessages,
  };
}

// ---------------------------------------------------------------------------
// Message translation
// ---------------------------------------------------------------------------

function translateMessages(messages: readonly Message[]): OpenAIInputItem[] {
  const items: OpenAIInputItem[] = [];

  for (const msg of messages) {
    if (msg.role === Role.USER) {
      const content: OpenAIContentBlock[] = [];
      const toolCallItems: OpenAIInputItem[] = [];

      for (const part of msg.content) {
        const translated = translateUserContentPart(part);
        if (translated) content.push(translated);
      }

      if (content.length > 0) {
        items.push({ type: "message", role: "user", content });
      }
      items.push(...toolCallItems);
    } else if (msg.role === Role.ASSISTANT) {
      const content: OpenAIContentBlock[] = [];
      const toolCallItems: OpenAIInputItem[] = [];

      for (const part of msg.content) {
        if (part.kind === ContentKind.TOOL_CALL) {
          const tc = part.tool_call;
          const args = typeof tc.arguments === "string"
            ? tc.arguments
            : JSON.stringify(tc.arguments);
          toolCallItems.push({
            type: "function_call",
            id: tc.id,
            name: tc.name,
            arguments: args,
            call_id: tc.id,
          });
        } else {
          const translated = translateAssistantContentPart(part);
          if (translated) content.push(translated);
        }
      }

      if (content.length > 0) {
        items.push({ type: "message", role: "assistant", content });
      }
      items.push(...toolCallItems);
    } else if (msg.role === Role.TOOL) {
      for (const part of msg.content) {
        if (part.kind === ContentKind.TOOL_RESULT) {
          const tr = part.tool_result;
          const output = typeof tr.content === "string"
            ? tr.content
            : JSON.stringify(tr.content);
          items.push({
            type: "function_call_output",
            call_id: tr.tool_call_id,
            output,
          });
        }
      }
    }
    // DEVELOPER messages already extracted to instructions
  }

  return items;
}

// ---------------------------------------------------------------------------
// Tool definition translation
// ---------------------------------------------------------------------------

function translateTools(tools: readonly Tool[]): OpenAIToolDefinition[] {
  return tools.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true,
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

export function translateRequest(request: Request): OpenAIRequestBody {
  const { instructions, nonSystemMessages } = extractInstructions(request.messages);
  const input = translateMessages(nonSystemMessages);

  const body: OpenAIRequestBody = {
    model: request.model,
    input,
  };

  if (instructions) {
    body.instructions = instructions;
  }

  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  if (request.top_p !== undefined) {
    body.top_p = request.top_p;
  }

  if (request.max_tokens !== undefined) {
    body.max_output_tokens = request.max_tokens;
  }

  if (request.tools && request.tools.length > 0) {
    body.tools = translateTools(request.tools);
    const tc = translateToolChoice(request.tool_choice);
    if (tc !== undefined) {
      body.tool_choice = tc;
    }
  }

  if (request.reasoning_effort) {
    body.reasoning = { effort: request.reasoning_effort };
  }

  if (request.metadata) {
    body.metadata = request.metadata;
  }

  return body;
}
