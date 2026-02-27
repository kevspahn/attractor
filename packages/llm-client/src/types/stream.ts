/**
 * Stream event types and accumulator for the unified LLM client.
 */

import type { StreamEventType } from "./enums.js";
import { ContentKind, Role } from "./enums.js";
import type { ContentPart, Message } from "./message.js";
import type { ToolCall } from "./tool.js";
import type { FinishReason, Response, Warning } from "./response.js";
import { Usage } from "./response.js";
import type { SDKError } from "./errors.js";

// ---------------------------------------------------------------------------
// StreamEvent (Section 3.13)
// ---------------------------------------------------------------------------

/** A single event from a streaming response. */
export interface StreamEvent {
  /** Discriminator tag. Accepts enum values and arbitrary strings. */
  readonly type: StreamEventType | string;

  // -- text events --
  /** Incremental text. */
  readonly delta?: string;
  /** Identifies which text segment this belongs to. */
  readonly text_id?: string;

  // -- reasoning events --
  /** Incremental reasoning/thinking text. */
  readonly reasoning_delta?: string;

  // -- tool call events --
  /** Partial or complete tool call. */
  readonly tool_call?: ToolCall;

  // -- finish event --
  readonly finish_reason?: FinishReason;
  readonly usage?: Usage;
  /** The full accumulated response. */
  readonly response?: Response;

  // -- error event --
  readonly error?: SDKError;

  // -- passthrough --
  /** Raw provider event for passthrough. */
  readonly raw?: Record<string, unknown>;

  // -- warnings (on STREAM_START) --
  readonly warnings?: readonly Warning[];
}

// ---------------------------------------------------------------------------
// StreamAccumulator (Section 4.4)
// ---------------------------------------------------------------------------

/** Internal state for a tool call being built from streaming deltas. */
interface ToolCallBuilder {
  id: string;
  name: string;
  argumentChunks: string[];
}

/**
 * Collects stream events into a complete Response.
 *
 * Usage:
 * ```ts
 * const acc = new StreamAccumulator();
 * for await (const event of stream) {
 *   acc.process(event);
 * }
 * const response = acc.response();
 * ```
 */
export class StreamAccumulator {
  private textChunks: string[] = [];
  private reasoningChunks: string[] = [];
  private toolCallBuilders: Map<string, ToolCallBuilder> = new Map();
  private completedToolCalls: ToolCall[] = [];
  private finishReason: FinishReason | undefined;
  private accumulatedUsage: Usage | undefined;
  private accumulatedResponse: Response | undefined;
  private accumulatedWarnings: Warning[] = [];

  /**
   * Process a single stream event.
   */
  process(event: StreamEvent): void {
    switch (event.type) {
      case "stream_start":
        if (event.warnings) {
          this.accumulatedWarnings.push(...event.warnings);
        }
        break;

      case "text_delta":
        if (event.delta !== undefined) {
          this.textChunks.push(event.delta);
        }
        break;

      case "reasoning_start":
        // Nothing to accumulate on start
        break;

      case "reasoning_delta":
        if (event.reasoning_delta !== undefined) {
          this.reasoningChunks.push(event.reasoning_delta);
        }
        break;

      case "reasoning_end":
        // Nothing to do
        break;

      case "tool_call_start":
        if (event.tool_call) {
          const builder: ToolCallBuilder = {
            id: event.tool_call.id,
            name: event.tool_call.name,
            argumentChunks: [],
          };
          this.toolCallBuilders.set(event.tool_call.id, builder);
        }
        break;

      case "tool_call_delta":
        if (event.tool_call) {
          const builder = this.toolCallBuilders.get(event.tool_call.id);
          if (builder && event.tool_call.raw_arguments) {
            builder.argumentChunks.push(event.tool_call.raw_arguments);
          }
        }
        break;

      case "tool_call_end":
        if (event.tool_call) {
          // Use the fully-formed tool call from the end event
          this.completedToolCalls.push(event.tool_call);
          this.toolCallBuilders.delete(event.tool_call.id);
        }
        break;

      case "finish":
        if (event.finish_reason) this.finishReason = event.finish_reason;
        if (event.usage) this.accumulatedUsage = event.usage;
        if (event.response) this.accumulatedResponse = event.response;
        break;

      case "error":
        // Errors are stored in the event but not accumulated here;
        // callers should handle error events directly.
        break;

      default:
        // provider_event, text_start, text_end — nothing to accumulate
        break;
    }
  }

  /**
   * Build and return the accumulated Response.
   *
   * If a full response was provided by the FINISH event, it is returned
   * directly. Otherwise, a response is synthesized from accumulated data.
   */
  response(): Response {
    if (this.accumulatedResponse) {
      return this.accumulatedResponse;
    }

    const contentParts: ContentPart[] = [];

    // Add reasoning if present
    const reasoning = this.reasoningChunks.join("");
    if (reasoning.length > 0) {
      contentParts.push({
        kind: ContentKind.THINKING,
        thinking: { text: reasoning, redacted: false },
      });
    }

    // Add text if present
    const text = this.textChunks.join("");
    if (text.length > 0) {
      contentParts.push({
        kind: ContentKind.TEXT,
        text,
      });
    }

    // Add completed tool calls
    for (const tc of this.completedToolCalls) {
      contentParts.push({
        kind: ContentKind.TOOL_CALL,
        tool_call: {
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          type: "function",
        },
      });
    }

    // Also add any in-progress tool calls (shouldn't happen if stream completed normally)
    for (const builder of this.toolCallBuilders.values()) {
      const rawArgs = builder.argumentChunks.join("");
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(rawArgs) as Record<string, unknown>;
      } catch {
        // Leave as empty dict if parsing fails
      }
      contentParts.push({
        kind: ContentKind.TOOL_CALL,
        tool_call: {
          id: builder.id,
          name: builder.name,
          arguments: parsedArgs,
          type: "function",
        },
      });
    }

    const message: Message = {
      role: Role.ASSISTANT,
      content: contentParts,
    };

    const usage =
      this.accumulatedUsage ??
      new Usage({ input_tokens: 0, output_tokens: 0 });

    return {
      id: "",
      model: "",
      provider: "",
      message,
      finish_reason: this.finishReason ?? { reason: "other" },
      usage,
      warnings:
        this.accumulatedWarnings.length > 0
          ? this.accumulatedWarnings
          : undefined,
    };
  }

  /** Get the accumulated text so far. */
  get text(): string {
    return this.textChunks.join("");
  }

  /** Get the accumulated reasoning text so far. */
  get reasoning(): string {
    return this.reasoningChunks.join("");
  }

  /** Get the completed tool calls so far. */
  get toolCalls(): readonly ToolCall[] {
    return this.completedToolCalls;
  }
}
