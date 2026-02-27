/**
 * generate() — the primary blocking generation function (Layer 4).
 *
 * Provides a high-level API with automatic tool execution, retry, and
 * usage aggregation on top of the low-level Client.
 *
 * See spec Sections 4.3 and 5.6.
 */

import type { Client } from "./client.js";
import { getDefaultClient } from "./index.js";
import type {
  Message,
  Tool,
  ToolCall,
  ToolResult,
  ToolChoice,
  Request,
  Response,
  ResponseFormat,
  FinishReason,
  Warning,
} from "./types/index.js";
import {
  Usage,
  ContentKind,
  Role,
  getResponseText,
  getResponseToolCalls,
  getResponseReasoning,
} from "./types/index.js";
import { retry } from "./utils/retry.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for the generate() function. */
export interface GenerateOptions {
  /** Required; provider's native model ID. */
  model: string;
  /** Simple text prompt (converted to a single user message). */
  prompt?: string;
  /** Full message history. Mutually exclusive with `prompt`. */
  messages?: Message[];
  /** System message prepended to the conversation. */
  system?: string;
  /** Tool definitions, optionally with execute handlers. */
  tools?: Tool[];
  /** Controls whether and how the model uses tools. */
  toolChoice?: ToolChoice;
  /**
   * Maximum number of tool execution rounds. Default: 1.
   *
   * Value of 0 = no automatic tool execution.
   * Value of N = initial LLM call + up to N rounds of tool execution + LLM call.
   * Total LLM calls at most maxToolRounds + 1.
   */
  maxToolRounds?: number;
  /** Callback to stop the tool loop early based on accumulated steps. */
  stopWhen?: (steps: StepResult[]) => boolean;
  /** Controls the format of the model's response. */
  responseFormat?: ResponseFormat;
  /** Sampling temperature. */
  temperature?: number;
  /** Nucleus sampling parameter. */
  topP?: number;
  /** Maximum tokens to generate. */
  maxTokens?: number;
  /** Stop generation when any of these sequences appear. */
  stopSequences?: string[];
  /** Reasoning effort: "none", "low", "medium", "high". */
  reasoningEffort?: string;
  /** Provider name to route to. */
  provider?: string;
  /** Provider-specific parameters. */
  providerOptions?: Record<string, unknown>;
  /** Number of retries for each LLM call. Default: 2. */
  maxRetries?: number;
  /** Timeout in milliseconds. */
  timeout?: number;
  /** Abort signal. */
  abortSignal?: AbortSignal;
  /** Override the default client. */
  client?: Client;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** The result of a single step (one LLM call + tool execution). */
export interface StepResult {
  /** Text from the model's response. */
  text: string;
  /** Reasoning/thinking content, if any. */
  reasoning?: string;
  /** Tool calls the model made. */
  toolCalls: ToolCall[];
  /** Results of executing those tool calls. */
  toolResults: ToolResult[];
  /** Why generation stopped. */
  finishReason: FinishReason;
  /** Token usage for this step. */
  usage: Usage;
  /** The full response from this step. */
  response: Response;
  /** Any warnings from this step. */
  warnings: Warning[];
}

/** The final result of generate(). */
export interface GenerateResult {
  /** Text from the final step. */
  text: string;
  /** Reasoning/thinking from the final step, if any. */
  reasoning?: string;
  /** Tool calls from the final step. */
  toolCalls: ToolCall[];
  /** Tool results from the final step. */
  toolResults: ToolResult[];
  /** Why generation stopped (from final step). */
  finishReason: FinishReason;
  /** Token usage for the final step. */
  usage: Usage;
  /** Aggregated token usage across ALL steps. */
  totalUsage: Usage;
  /** All steps taken during generation. */
  steps: StepResult[];
  /** The full response from the final step. */
  response: Response;
  /** Structured output (used by generateObject). */
  output?: unknown;
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

/**
 * Execute tool calls concurrently.
 *
 * Unknown tools or tools without execute handlers produce error results
 * (NOT exceptions). Tool handler errors are caught and converted to
 * error results.
 */
export async function executeTools(
  tools: Tool[],
  toolCalls: ToolCall[],
): Promise<ToolResult[]> {
  const promises = toolCalls.map(async (call): Promise<ToolResult> => {
    const tool = tools.find((t) => t.name === call.name);

    if (!tool?.execute) {
      return {
        tool_call_id: call.id,
        content: tool
          ? `Tool "${call.name}" has no execute handler`
          : `Unknown tool: ${call.name}`,
        is_error: true,
      };
    }

    try {
      const result = await tool.execute(call.arguments);
      const content =
        typeof result === "string" ? result : JSON.stringify(result);
      return { tool_call_id: call.id, content, is_error: false };
    } catch (err) {
      return {
        tool_call_id: call.id,
        content: String(err),
        is_error: true,
      };
    }
  });

  return Promise.all(promises);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a Request from GenerateOptions and the current messages.
 */
function buildRequest(
  options: GenerateOptions,
  messages: Message[],
): Request {
  return {
    model: options.model,
    messages,
    provider: options.provider,
    tools: options.tools,
    tool_choice: options.toolChoice,
    response_format: options.responseFormat,
    temperature: options.temperature,
    top_p: options.topP,
    max_tokens: options.maxTokens,
    stop_sequences: options.stopSequences,
    reasoning_effort: options.reasoningEffort,
    provider_options: options.providerOptions,
  };
}

/**
 * Standardize prompt/messages/system into a Message array.
 */
function buildMessages(options: GenerateOptions): Message[] {
  if (options.prompt !== undefined && options.messages !== undefined) {
    throw new Error(
      'Cannot specify both "prompt" and "messages". Use one or the other.',
    );
  }

  const messages: Message[] = [];

  // System message first
  if (options.system) {
    messages.push({
      role: Role.SYSTEM,
      content: [{ kind: ContentKind.TEXT, text: options.system }],
    });
  }

  // Then conversation messages
  if (options.prompt !== undefined) {
    messages.push({
      role: Role.USER,
      content: [{ kind: ContentKind.TEXT, text: options.prompt }],
    });
  } else if (options.messages) {
    messages.push(...options.messages);
  }

  return messages;
}

/**
 * Determine if the tool loop should continue.
 */
function shouldContinueToolLoop(
  response: Response,
  tools: Tool[] | undefined,
  roundsUsed: number,
  maxToolRounds: number,
  steps: StepResult[],
  stopWhen?: (steps: StepResult[]) => boolean,
): boolean {
  // No tools or no active tools → stop
  if (!tools || tools.length === 0) return false;

  const hasActiveTools = tools.some((t) => t.execute);
  if (!hasActiveTools) return false;

  // Must have tool_calls finish reason
  if (response.finish_reason.reason !== "tool_calls") return false;

  // Check tool calls in response
  const toolCalls = getResponseToolCalls(response);
  if (toolCalls.length === 0) return false;

  // Check maxToolRounds
  if (roundsUsed >= maxToolRounds) return false;

  // Check stopWhen
  if (stopWhen && stopWhen(steps)) return false;

  return true;
}

// ---------------------------------------------------------------------------
// generate()
// ---------------------------------------------------------------------------

/**
 * High-level blocking generation with automatic tool execution, retry,
 * and usage aggregation.
 */
export async function generate(
  options: GenerateOptions,
): Promise<GenerateResult> {
  const client = options.client ?? getDefaultClient();
  const maxToolRounds = options.maxToolRounds ?? 1;
  const maxRetries = options.maxRetries ?? 2;

  // Build initial messages
  const messages = buildMessages(options);

  const steps: StepResult[] = [];
  let totalUsage = new Usage({ input_tokens: 0, output_tokens: 0 });
  let roundsUsed = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Build request
    const request = buildRequest(options, messages);

    // Call LLM with retry
    const response = await retry(
      () => client.complete(request),
      { maxRetries, jitter: false },
    );

    // Extract data from response
    const text = getResponseText(response);
    const reasoning = getResponseReasoning(response);
    const toolCalls = getResponseToolCalls(response);
    const warnings: Warning[] = response.warnings
      ? [...response.warnings]
      : [];

    // Check if we should execute tools
    const shouldExecuteTools = shouldContinueToolLoop(
      response,
      options.tools,
      roundsUsed,
      maxToolRounds,
      steps,
      options.stopWhen,
    );

    if (shouldExecuteTools && options.tools) {
      // Execute tools
      const toolResults = await executeTools(options.tools, toolCalls);

      // Record step
      const step: StepResult = {
        text,
        reasoning,
        toolCalls,
        toolResults,
        finishReason: response.finish_reason,
        usage: response.usage,
        response,
        warnings,
      };
      steps.push(step);
      totalUsage = totalUsage.add(response.usage);

      // Check stopWhen after recording the step
      if (options.stopWhen && options.stopWhen(steps)) {
        // Stop early — return current state
        return buildResult(step, steps, totalUsage);
      }

      // Append assistant message to conversation
      messages.push(response.message as Message);

      // Append tool results to conversation
      for (const result of toolResults) {
        messages.push({
          role: Role.TOOL,
          content: [
            {
              kind: ContentKind.TOOL_RESULT,
              tool_result: {
                tool_call_id: result.tool_call_id,
                content:
                  typeof result.content === "string"
                    ? result.content
                    : JSON.stringify(result.content),
                is_error: result.is_error,
              },
            },
          ],
          tool_call_id: result.tool_call_id,
        });
      }

      roundsUsed++;
      // Continue the loop for the next LLM call
    } else {
      // No tools to execute — this is the final step
      const step: StepResult = {
        text,
        reasoning,
        toolCalls,
        toolResults: [],
        finishReason: response.finish_reason,
        usage: response.usage,
        response,
        warnings,
      };
      steps.push(step);
      totalUsage = totalUsage.add(response.usage);

      return buildResult(step, steps, totalUsage);
    }
  }
}

/**
 * Build the final GenerateResult from the last step and accumulated state.
 */
function buildResult(
  lastStep: StepResult,
  steps: StepResult[],
  totalUsage: Usage,
): GenerateResult {
  return {
    text: lastStep.text,
    reasoning: lastStep.reasoning,
    toolCalls: lastStep.toolCalls,
    toolResults: lastStep.toolResults,
    finishReason: lastStep.finishReason,
    usage: lastStep.usage,
    totalUsage,
    steps,
    response: lastStep.response,
  };
}
