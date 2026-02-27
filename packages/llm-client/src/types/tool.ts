/**
 * Tool-related types for the unified LLM client.
 */

// ---------------------------------------------------------------------------
// ToolCall
// ---------------------------------------------------------------------------

/** A model-initiated tool invocation extracted from a response. */
export interface ToolCall {
  /** Unique identifier (provider-assigned). */
  readonly id: string;
  /** Tool name. */
  readonly name: string;
  /** Parsed JSON arguments. */
  readonly arguments: Record<string, unknown>;
  /** Raw argument string before parsing. */
  readonly raw_arguments?: string;
}

// ---------------------------------------------------------------------------
// ToolResult
// ---------------------------------------------------------------------------

/** The output produced by executing a tool call. */
export interface ToolResult {
  /** Correlates to ToolCall.id. */
  readonly tool_call_id: string;
  /** The tool's output (text or structured). */
  readonly content: string | Record<string, unknown> | unknown[];
  /** Whether the tool execution failed. */
  readonly is_error: boolean;
}

// ---------------------------------------------------------------------------
// ToolChoice
// ---------------------------------------------------------------------------

/** Controls whether and how the model uses tools. */
export interface ToolChoice {
  /** "auto" | "none" | "required" | "named" */
  readonly mode: "auto" | "none" | "required" | "named";
  /** Required when mode is "named". */
  readonly tool_name?: string;
}

// ---------------------------------------------------------------------------
// Tool (Definition)
// ---------------------------------------------------------------------------

/**
 * A tool definition that can be provided to the model.
 *
 * When `execute` is provided the tool is "active" and the high-level API
 * can run it automatically. Without `execute` it is "passive".
 */
export interface Tool {
  /** Unique identifier; [a-zA-Z][a-zA-Z0-9_]* max 64 chars. */
  readonly name: string;
  /** Human-readable description for the model. */
  readonly description: string;
  /** JSON Schema defining the input (root must be "object"). */
  readonly parameters: Record<string, unknown>;
  /** Optional handler function. If present, the tool is "active". */
  readonly execute?: (
    args: Record<string, unknown>,
  ) => Promise<unknown> | unknown;
}
