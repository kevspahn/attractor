/**
 * Translate a unified Request into Gemini API format.
 *
 * Per spec Section 7.3 (Gemini Message Translation):
 * - SYSTEM/DEVELOPER -> `systemInstruction`
 * - USER -> "user" role, ASSISTANT -> "model" role
 * - TOOL -> "user" role with functionResponse parts
 * - Synthetic tool call IDs: Map<syntheticId, functionName>
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
// Gemini native types (request body)
// ---------------------------------------------------------------------------

export type GeminiPart =
  | { text: string }
  | { fileData: { mimeType: string; fileUri: string } }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface GeminiToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GeminiToolConfig {
  functionCallingConfig: {
    mode: string;
    allowedFunctionNames?: string[];
  };
}

export interface GeminiRequestBody {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  tools?: Array<{ functionDeclarations: GeminiToolDeclaration[] }>;
  toolConfig?: GeminiToolConfig;
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    stopSequences?: readonly string[];
  };
}

// ---------------------------------------------------------------------------
// ID mapping: Gemini doesn't have tool call IDs
// ---------------------------------------------------------------------------

/**
 * Maintains a bidirectional mapping between synthetic IDs and function names.
 * Gemini uses function names (not IDs) to correlate calls with results.
 */
export class GeminiIdMap {
  private idToName = new Map<string, string>();

  /** Get the function name for a synthetic ID. */
  getName(id: string): string | undefined {
    return this.idToName.get(id);
  }

  /** Register a mapping from synthetic ID to function name. */
  register(id: string, name: string): void {
    this.idToName.set(id, name);
  }
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

function translateContentPart(part: ContentPart, idMap: GeminiIdMap): GeminiPart | null {
  switch (part.kind) {
    case ContentKind.TEXT:
      return { text: part.text };

    case ContentKind.IMAGE: {
      const img = part.image;
      if (img.url) {
        return {
          fileData: {
            mimeType: img.media_type ?? "image/png",
            fileUri: img.url,
          },
        };
      }
      if (img.data) {
        const base64 = typeof img.data === "string"
          ? img.data
          : bufferToBase64(img.data);
        return {
          inlineData: {
            mimeType: img.media_type ?? "image/png",
            data: base64,
          },
        };
      }
      return null;
    }

    case ContentKind.TOOL_CALL: {
      const tc = part.tool_call;
      const args = typeof tc.arguments === "string"
        ? (JSON.parse(tc.arguments) as Record<string, unknown>)
        : tc.arguments;
      // Register the ID -> name mapping
      idMap.register(tc.id, tc.name);
      return { functionCall: { name: tc.name, args } };
    }

    case ContentKind.TOOL_RESULT: {
      const tr = part.tool_result;
      // Look up the function name from the synthetic ID
      const name = idMap.getName(tr.tool_call_id) ?? "unknown";
      const content = typeof tr.content === "string"
        ? { result: tr.content }
        : (tr.content as Record<string, unknown>);
      return { functionResponse: { name, response: content } };
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// System extraction
// ---------------------------------------------------------------------------

function extractSystem(messages: readonly Message[]): {
  systemParts: GeminiPart[] | undefined;
  nonSystemMessages: Message[];
} {
  const systemParts: GeminiPart[] = [];
  const nonSystemMessages: Message[] = [];

  for (const msg of messages) {
    if (msg.role === Role.SYSTEM || msg.role === Role.DEVELOPER) {
      for (const part of msg.content) {
        if (part.kind === ContentKind.TEXT) {
          systemParts.push({ text: part.text });
        }
      }
    } else {
      nonSystemMessages.push(msg);
    }
  }

  return {
    systemParts: systemParts.length > 0 ? systemParts : undefined,
    nonSystemMessages,
  };
}

// ---------------------------------------------------------------------------
// Message translation
// ---------------------------------------------------------------------------

function mapRole(role: string): "user" | "model" {
  if (role === Role.ASSISTANT) return "model";
  return "user"; // USER, TOOL map to user
}

function translateMessages(
  messages: readonly Message[],
  idMap: GeminiIdMap,
): GeminiContent[] {
  const result: GeminiContent[] = [];

  for (const msg of messages) {
    const geminiRole = mapRole(msg.role);
    const parts: GeminiPart[] = [];

    for (const part of msg.content) {
      const translated = translateContentPart(part, idMap);
      if (translated) {
        parts.push(translated);
      }
    }

    if (parts.length === 0) continue;

    // Gemini also benefits from merging consecutive same-role messages
    const lastMsg = result[result.length - 1];
    if (result.length > 0 && lastMsg && lastMsg.role === geminiRole) {
      lastMsg.parts.push(...parts);
    } else {
      result.push({ role: geminiRole, parts });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool definition translation
// ---------------------------------------------------------------------------

function translateTools(tools: readonly Tool[]): GeminiToolDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

// ---------------------------------------------------------------------------
// Tool choice translation
// ---------------------------------------------------------------------------

function translateToolConfig(
  toolChoice: ToolChoice | undefined,
): GeminiToolConfig | undefined {
  if (!toolChoice) return undefined;

  switch (toolChoice.mode) {
    case "auto":
      return { functionCallingConfig: { mode: "AUTO" } };
    case "none":
      return { functionCallingConfig: { mode: "NONE" } };
    case "required":
      return { functionCallingConfig: { mode: "ANY" } };
    case "named":
      return {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: [toolChoice.tool_name!],
        },
      };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Main translation function
// ---------------------------------------------------------------------------

export function translateRequest(
  request: Request,
  idMap: GeminiIdMap,
): GeminiRequestBody {
  const { systemParts, nonSystemMessages } = extractSystem(request.messages);
  const contents = translateMessages(nonSystemMessages, idMap);

  const body: GeminiRequestBody = {
    contents,
  };

  if (systemParts) {
    body.systemInstruction = { parts: systemParts };
  }

  // Generation config
  const genConfig: GeminiRequestBody["generationConfig"] = {};
  let hasGenConfig = false;

  if (request.temperature !== undefined) {
    genConfig.temperature = request.temperature;
    hasGenConfig = true;
  }
  if (request.top_p !== undefined) {
    genConfig.topP = request.top_p;
    hasGenConfig = true;
  }
  if (request.max_tokens !== undefined) {
    genConfig.maxOutputTokens = request.max_tokens;
    hasGenConfig = true;
  }
  if (request.stop_sequences && request.stop_sequences.length > 0) {
    genConfig.stopSequences = request.stop_sequences;
    hasGenConfig = true;
  }

  if (hasGenConfig) {
    body.generationConfig = genConfig;
  }

  // Tools
  if (request.tools && request.tools.length > 0) {
    body.tools = [{ functionDeclarations: translateTools(request.tools) }];

    const toolConfig = translateToolConfig(request.tool_choice);
    if (toolConfig) {
      body.toolConfig = toolConfig;
    }
  }

  return body;
}
