/**
 * Request types for the unified LLM client.
 */

import type { Message } from "./message.js";
import type { Tool, ToolChoice } from "./tool.js";

// ---------------------------------------------------------------------------
// ResponseFormat (Section 3.10)
// ---------------------------------------------------------------------------

/** Controls the format of the model's response. */
export interface ResponseFormat {
  /** "text", "json", or "json_schema". */
  readonly type: string;
  /** Required when type is "json_schema". */
  readonly json_schema?: Record<string, unknown>;
  /** When true, provider enforces schema strictly. Default: false. */
  readonly strict?: boolean;
}

// ---------------------------------------------------------------------------
// Request (Section 3.6)
// ---------------------------------------------------------------------------

/**
 * The single input type for both `complete()` and `stream()`.
 */
export interface Request {
  /** Required; provider's native model ID. */
  readonly model: string;
  /** Required; the conversation. */
  readonly messages: readonly Message[];
  /** Optional; uses default provider if omitted. */
  readonly provider?: string;
  /** Optional tool definitions. */
  readonly tools?: readonly Tool[];
  /** Optional; defaults to AUTO if tools present. */
  readonly tool_choice?: ToolChoice;
  /** Optional; text, json, or json_schema. */
  readonly response_format?: ResponseFormat;
  /** Sampling temperature. */
  readonly temperature?: number;
  /** Nucleus sampling parameter. */
  readonly top_p?: number;
  /** Maximum tokens to generate. */
  readonly max_tokens?: number;
  /** Stop generation when any of these sequences appear. */
  readonly stop_sequences?: readonly string[];
  /** "none", "low", "medium", "high". */
  readonly reasoning_effort?: string;
  /** Arbitrary key-value pairs. */
  readonly metadata?: Record<string, string>;
  /** Escape hatch for provider-specific params. */
  readonly provider_options?: Record<string, unknown>;
}
