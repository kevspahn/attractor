/**
 * Message and ContentPart types for the unified LLM client.
 */

import type { Role } from "./enums.js";
import { ContentKind } from "./enums.js";
import { Role as RoleValues } from "./enums.js";
import type { ToolCall as ToolCallType } from "./tool.js";

// ---------------------------------------------------------------------------
// Content data structures (Section 3.5)
// ---------------------------------------------------------------------------

/** Image as URL, base64, or file reference. */
export interface ImageData {
  /** URL pointing to the image. */
  readonly url?: string;
  /** Raw image bytes (base64-encoded string in JSON transport). */
  readonly data?: Uint8Array;
  /** MIME type, e.g. "image/png", "image/jpeg". */
  readonly media_type?: string;
  /** Processing fidelity hint: "auto", "low", "high". */
  readonly detail?: string;
}

/** Audio as URL or raw bytes with media type. */
export interface AudioData {
  readonly url?: string;
  readonly data?: Uint8Array;
  /** e.g. "audio/wav", "audio/mp3". */
  readonly media_type?: string;
}

/** Document (PDF, etc.) as URL, base64, or file reference. */
export interface DocumentData {
  readonly url?: string;
  readonly data?: Uint8Array;
  /** e.g. "application/pdf". */
  readonly media_type?: string;
  /** Optional display name. */
  readonly file_name?: string;
}

/** Data for a tool call content part. */
export interface ToolCallData {
  /** Unique identifier for this call (provider-assigned). */
  readonly id: string;
  /** Tool name. */
  readonly name: string;
  /** Parsed JSON arguments or raw argument string. */
  readonly arguments: Record<string, unknown> | string;
  /** "function" (default) or "custom". */
  readonly type?: string;
}

/** Data for a tool result content part. */
export interface ToolResultData {
  /** The ToolCallData.id this result answers. */
  readonly tool_call_id: string;
  /** The tool's output (text or structured). */
  readonly content: string | Record<string, unknown>;
  /** Whether the tool execution failed. */
  readonly is_error: boolean;
  /** Optional image result. */
  readonly image_data?: Uint8Array;
  /** MIME type for the image result. */
  readonly image_media_type?: string;
}

/** Model reasoning/thinking content. */
export interface ThinkingData {
  /** The thinking/reasoning content. */
  readonly text: string;
  /** Provider-specific signature for round-tripping. */
  readonly signature?: string;
  /** True if this is redacted thinking (opaque content). */
  readonly redacted: boolean;
}

// ---------------------------------------------------------------------------
// ContentPart — discriminated union on `kind`
// ---------------------------------------------------------------------------

export interface TextContentPart {
  readonly kind: typeof ContentKind.TEXT;
  readonly text: string;
}

export interface ImageContentPart {
  readonly kind: typeof ContentKind.IMAGE;
  readonly image: ImageData;
}

export interface AudioContentPart {
  readonly kind: typeof ContentKind.AUDIO;
  readonly audio: AudioData;
}

export interface DocumentContentPart {
  readonly kind: typeof ContentKind.DOCUMENT;
  readonly document: DocumentData;
}

export interface ToolCallContentPart {
  readonly kind: typeof ContentKind.TOOL_CALL;
  readonly tool_call: ToolCallData;
}

export interface ToolResultContentPart {
  readonly kind: typeof ContentKind.TOOL_RESULT;
  readonly tool_result: ToolResultData;
}

export interface ThinkingContentPart {
  readonly kind: typeof ContentKind.THINKING;
  readonly thinking: ThinkingData;
}

export interface RedactedThinkingContentPart {
  readonly kind: typeof ContentKind.REDACTED_THINKING;
  readonly thinking: ThinkingData;
}

/**
 * A discriminated union of all content part types.
 *
 * The `kind` field is the discriminator tag. Each variant carries its own
 * data field (text, image, audio, etc.).
 */
export type ContentPart =
  | TextContentPart
  | ImageContentPart
  | AudioContentPart
  | DocumentContentPart
  | ToolCallContentPart
  | ToolResultContentPart
  | ThinkingContentPart
  | RedactedThinkingContentPart;

// ---------------------------------------------------------------------------
// Message (Section 3.1)
// ---------------------------------------------------------------------------

/** The fundamental unit of conversation. */
export interface Message {
  /** Who produced this message. */
  readonly role: Role;
  /** The message body (multimodal). */
  readonly content: readonly ContentPart[];
  /** For tool messages and developer attribution. */
  readonly name?: string;
  /** Links a tool-result message to its tool call. */
  readonly tool_call_id?: string;
}

// ---------------------------------------------------------------------------
// Convenience factory functions
// ---------------------------------------------------------------------------

/** Create a system message from plain text. */
export function createSystemMessage(text: string): Message {
  return {
    role: RoleValues.SYSTEM,
    content: [{ kind: ContentKind.TEXT, text }],
  };
}

/** Create a user message from plain text. */
export function createUserMessage(text: string): Message {
  return {
    role: RoleValues.USER,
    content: [{ kind: ContentKind.TEXT, text }],
  };
}

/** Create an assistant message from plain text. */
export function createAssistantMessage(text: string): Message {
  return {
    role: RoleValues.ASSISTANT,
    content: [{ kind: ContentKind.TEXT, text }],
  };
}

/** Create a tool-result message. */
export function createToolResultMessage(
  tool_call_id: string,
  content: string | Record<string, unknown>,
  is_error = false,
): Message {
  return {
    role: RoleValues.TOOL,
    content: [
      {
        kind: ContentKind.TOOL_RESULT,
        tool_result: { tool_call_id, content, is_error },
      },
    ],
    tool_call_id,
  };
}

// ---------------------------------------------------------------------------
// Helper: getMessageText
// ---------------------------------------------------------------------------

/**
 * Concatenate text from all TEXT content parts of a message.
 * Returns empty string if no text parts exist.
 */
export function getMessageText(message: Message): string {
  return message.content
    .filter((part): part is TextContentPart => part.kind === ContentKind.TEXT)
    .map((part) => part.text)
    .join("");
}

/**
 * Extract all tool calls from a message's content parts.
 */
export function getMessageToolCalls(message: Message): ToolCallType[] {
  return message.content
    .filter(
      (part): part is ToolCallContentPart =>
        part.kind === ContentKind.TOOL_CALL,
    )
    .map((part) => ({
      id: part.tool_call.id,
      name: part.tool_call.name,
      arguments:
        typeof part.tool_call.arguments === "string"
          ? (JSON.parse(part.tool_call.arguments) as Record<string, unknown>)
          : part.tool_call.arguments,
      raw_arguments:
        typeof part.tool_call.arguments === "string"
          ? part.tool_call.arguments
          : undefined,
    }));
}
