/**
 * Core enums for the unified LLM client.
 *
 * Uses `as const satisfies` pattern instead of TypeScript enums for tree-shaking
 * and better type inference.
 */

// ---------------------------------------------------------------------------
// Role
// ---------------------------------------------------------------------------

/** The five roles covering the semantics of all major providers. */
export const Role = {
  /** High-level instructions shaping model behavior. Typically first. */
  SYSTEM: "system",
  /** Human input. Text, images, audio, documents. */
  USER: "user",
  /** Model output. Text, tool calls, thinking blocks. */
  ASSISTANT: "assistant",
  /** Tool execution results, linked by tool_call_id. */
  TOOL: "tool",
  /** Privileged instructions from the application (not the end user). */
  DEVELOPER: "developer",
} as const satisfies Record<string, string>;

export type Role = (typeof Role)[keyof typeof Role];

// ---------------------------------------------------------------------------
// ContentKind
// ---------------------------------------------------------------------------

/** Discriminator tags for ContentPart. */
export const ContentKind = {
  /** Plain text. The most common kind. */
  TEXT: "text",
  /** Image as URL, base64, or file reference. */
  IMAGE: "image",
  /** Audio as URL or raw bytes with media type. */
  AUDIO: "audio",
  /** Document (PDF, etc.) as URL, base64, or file reference. */
  DOCUMENT: "document",
  /** A model-initiated tool invocation. */
  TOOL_CALL: "tool_call",
  /** The result of executing a tool call. */
  TOOL_RESULT: "tool_result",
  /** Model reasoning/thinking content. */
  THINKING: "thinking",
  /** Redacted reasoning (Anthropic). Opaque, must round-trip verbatim. */
  REDACTED_THINKING: "redacted_thinking",
} as const satisfies Record<string, string>;

export type ContentKind = (typeof ContentKind)[keyof typeof ContentKind];

// ---------------------------------------------------------------------------
// StreamEventType
// ---------------------------------------------------------------------------

/** Discriminator tags for StreamEvent. */
export const StreamEventType = {
  /** Stream has begun. May include warnings. */
  STREAM_START: "stream_start",
  /** A new text segment has begun. Includes text_id. */
  TEXT_START: "text_start",
  /** Incremental text content. Includes delta and text_id. */
  TEXT_DELTA: "text_delta",
  /** Text segment is complete. Includes text_id. */
  TEXT_END: "text_end",
  /** Model reasoning has begun. */
  REASONING_START: "reasoning_start",
  /** Incremental reasoning content. */
  REASONING_DELTA: "reasoning_delta",
  /** Reasoning is complete. */
  REASONING_END: "reasoning_end",
  /** A tool call has begun. Includes tool name and call ID. */
  TOOL_CALL_START: "tool_call_start",
  /** Incremental tool call arguments (partial JSON). */
  TOOL_CALL_DELTA: "tool_call_delta",
  /** Tool call is fully formed and ready for execution. */
  TOOL_CALL_END: "tool_call_end",
  /** Generation complete. Includes finish_reason, usage, response. */
  FINISH: "finish",
  /** An error occurred during streaming. */
  ERROR: "error",
  /** Raw provider event not mapped to the unified model. */
  PROVIDER_EVENT: "provider_event",
} as const satisfies Record<string, string>;

export type StreamEventType =
  (typeof StreamEventType)[keyof typeof StreamEventType];
