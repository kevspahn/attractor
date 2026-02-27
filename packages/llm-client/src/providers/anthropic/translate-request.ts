/**
 * Translate a unified Request into Anthropic Messages API format.
 *
 * Per spec Section 7.3 (Anthropic Message Translation):
 * - SYSTEM/DEVELOPER -> extracted to `system` parameter
 * - Strict user/assistant alternation with merging
 * - TOOL messages -> user role with tool_result content blocks
 * - cache_control injection for agentic caching
 */

import {
  ContentKind,
  Role,
  type Request,
  type Message,
  type ContentPart,
  type Tool,
  type ToolChoice,
} from "../../types/index.js";

// ---------------------------------------------------------------------------
// Anthropic native types (request body)
// ---------------------------------------------------------------------------

/** A content block in an Anthropic message. */
export type AnthropicContentBlock =
  | { type: "text"; text: string; cache_control?: { type: string } }
  | { type: "image"; source: { type: "url"; url: string } | { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string | AnthropicContentBlock[]; is_error?: boolean }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "redacted_thinking"; data: string };

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: { type: string };
}

export interface AnthropicRequestBody {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: AnthropicContentBlock[];
  temperature?: number;
  top_p?: number;
  stop_sequences?: readonly string[];
  stream?: boolean;
  tools?: AnthropicToolDefinition[];
  tool_choice?: { type: string; name?: string };
  thinking?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Content part translation
// ---------------------------------------------------------------------------

function translateContentPart(part: ContentPart, _role: string): AnthropicContentBlock {
  switch (part.kind) {
    case ContentKind.TEXT:
      return { type: "text", text: part.text };

    case ContentKind.IMAGE: {
      const img = part.image;
      if (img.url) {
        return { type: "image", source: { type: "url", url: img.url } };
      }
      if (img.data) {
        const base64 = typeof img.data === "string"
          ? img.data
          : bufferToBase64(img.data);
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: img.media_type ?? "image/png",
            data: base64,
          },
        };
      }
      return { type: "text", text: "[unsupported image format]" };
    }

    case ContentKind.TOOL_CALL: {
      const tc = part.tool_call;
      const input = typeof tc.arguments === "string"
        ? (JSON.parse(tc.arguments) as Record<string, unknown>)
        : tc.arguments;
      return { type: "tool_use", id: tc.id, name: tc.name, input };
    }

    case ContentKind.TOOL_RESULT: {
      const tr = part.tool_result;
      const content = typeof tr.content === "string"
        ? tr.content
        : JSON.stringify(tr.content);
      return {
        type: "tool_result",
        tool_use_id: tr.tool_call_id,
        content,
        ...(tr.is_error ? { is_error: true } : {}),
      };
    }

    case ContentKind.THINKING:
      return {
        type: "thinking",
        thinking: part.thinking.text,
        ...(part.thinking.signature ? { signature: part.thinking.signature } : {}),
      };

    case ContentKind.REDACTED_THINKING:
      return {
        type: "redacted_thinking",
        data: part.thinking.text,
      };

    default:
      return { type: "text", text: `[unsupported content kind: ${part.kind}]` };
  }
}

function bufferToBase64(data: Uint8Array): string {
  // Cross-platform base64 encoding
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// System extraction
// ---------------------------------------------------------------------------

function extractSystem(messages: readonly Message[]): {
  system: AnthropicContentBlock[] | undefined;
  nonSystemMessages: Message[];
} {
  const systemBlocks: AnthropicContentBlock[] = [];
  const nonSystemMessages: Message[] = [];

  for (const msg of messages) {
    if (msg.role === Role.SYSTEM || msg.role === Role.DEVELOPER) {
      for (const part of msg.content) {
        systemBlocks.push(translateContentPart(part, "system"));
      }
    } else {
      nonSystemMessages.push(msg);
    }
  }

  // Auto-inject cache_control on last system content block for agentic caching
  if (systemBlocks.length > 0) {
    const last = systemBlocks[systemBlocks.length - 1];
    (last as Record<string, unknown>)["cache_control"] = { type: "ephemeral" };
  }

  return {
    system: systemBlocks.length > 0 ? systemBlocks : undefined,
    nonSystemMessages,
  };
}

// ---------------------------------------------------------------------------
// Message translation with alternation merging
// ---------------------------------------------------------------------------

function mapRole(role: string): "user" | "assistant" {
  if (role === Role.ASSISTANT) return "assistant";
  return "user"; // USER, TOOL, and any other role map to user
}

function translateMessages(messages: readonly Message[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    const anthropicRole = mapRole(msg.role);
    const blocks: AnthropicContentBlock[] = [];

    if (msg.role === Role.TOOL) {
      // TOOL messages become user role with tool_result content blocks
      for (const part of msg.content) {
        blocks.push(translateContentPart(part, "user"));
      }
    } else {
      for (const part of msg.content) {
        blocks.push(translateContentPart(part, anthropicRole));
      }
    }

    // Strict alternation: merge consecutive same-role messages
    const lastMsg = result[result.length - 1];
    if (result.length > 0 && lastMsg && lastMsg.role === anthropicRole) {
      lastMsg.content.push(...blocks);
    } else {
      result.push({ role: anthropicRole, content: blocks });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool definition translation
// ---------------------------------------------------------------------------

function translateTools(tools: readonly Tool[]): AnthropicToolDefinition[] {
  return tools.map((tool, index) => {
    const def: AnthropicToolDefinition = {
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    };
    // Auto-inject cache_control on tool definitions for agentic caching
    // We add it to all tool definitions so the provider can cache the full tool list
    if (index === tools.length - 1) {
      def.cache_control = { type: "ephemeral" };
    }
    return def;
  });
}

// ---------------------------------------------------------------------------
// Tool choice translation
// ---------------------------------------------------------------------------

function translateToolChoice(
  toolChoice: ToolChoice | undefined,
  hasTools: boolean,
): { toolChoiceParam?: { type: string; name?: string }; omitTools: boolean } {
  if (!toolChoice) {
    if (hasTools) {
      return { toolChoiceParam: { type: "auto" }, omitTools: false };
    }
    return { omitTools: false };
  }

  switch (toolChoice.mode) {
    case "auto":
      return { toolChoiceParam: { type: "auto" }, omitTools: false };
    case "none":
      // Anthropic: omit tools entirely for "none" mode
      return { omitTools: true };
    case "required":
      return { toolChoiceParam: { type: "any" }, omitTools: false };
    case "named":
      return {
        toolChoiceParam: { type: "tool", name: toolChoice.tool_name },
        omitTools: false,
      };
    default:
      return { omitTools: false };
  }
}

// ---------------------------------------------------------------------------
// Main translation function
// ---------------------------------------------------------------------------

export function translateRequest(request: Request): {
  body: AnthropicRequestBody;
  extraHeaders: Record<string, string>;
} {
  const { system, nonSystemMessages } = extractSystem(request.messages);
  const messages = translateMessages(nonSystemMessages);

  const hasTools = !!(request.tools && request.tools.length > 0);
  const { toolChoiceParam, omitTools } = translateToolChoice(
    request.tool_choice,
    hasTools,
  );

  const body: AnthropicRequestBody = {
    model: request.model,
    messages,
    max_tokens: request.max_tokens ?? 4096,
  };

  if (system) {
    body.system = system;
  }

  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  if (request.top_p !== undefined) {
    body.top_p = request.top_p;
  }

  if (request.stop_sequences && request.stop_sequences.length > 0) {
    body.stop_sequences = request.stop_sequences;
  }

  if (hasTools && !omitTools) {
    body.tools = translateTools(request.tools!);
    if (toolChoiceParam) {
      body.tool_choice = toolChoiceParam;
    }
  }

  // Provider options
  const extraHeaders: Record<string, string> = {};
  const anthropicOptions = request.provider_options?.["anthropic"] as
    | Record<string, unknown>
    | undefined;

  if (anthropicOptions) {
    // Beta headers
    const betaHeaders = anthropicOptions["beta_headers"] as string[] | undefined;
    if (betaHeaders && betaHeaders.length > 0) {
      extraHeaders["anthropic-beta"] = betaHeaders.join(",");
    }

    // Thinking config
    const thinking = anthropicOptions["thinking"] as
      | Record<string, unknown>
      | undefined;
    if (thinking) {
      body.thinking = thinking;
    }
  }

  if (request.metadata) {
    body.metadata = request.metadata;
  }

  return { body, extraHeaders };
}
