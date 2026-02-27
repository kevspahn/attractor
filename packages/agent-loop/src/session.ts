/**
 * Session — the core agentic loop.
 *
 * The Session orchestrates the conversation between the user, the LLM, and
 * the tool execution environment. It implements the loop described in
 * spec Section 2.5:
 *
 *   User input -> LLM call -> tool execution -> LLM call -> ... -> text response
 */

import type {
  Client,
  Request,
  Response,
  Message,
  ToolCall,
} from "@attractor/llm-client";
import {
  ContentKind,
  Role,
  createSystemMessage,
  createUserMessage,
  createToolResultMessage,
  getResponseText,
  getResponseToolCalls,
  getResponseReasoning,
} from "@attractor/llm-client";

import type { ExecutionEnvironment, ToolResult } from "./types.js";
import type { ProviderProfile, EnvironmentContext } from "./profiles/types.js";
import type {
  Turn,
  AssistantTurn,
  UserTurn,
  ToolResultsTurn,
  SteeringTurn,
} from "./turns.js";
import { EventEmitter } from "./events.js";
import type { AgentEvent } from "./events.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { detectLoop } from "./loop-detection.js";
import { truncateToolOutput } from "./truncation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Session configuration.
 */
export interface SessionConfig {
  /** The provider profile (tools, system prompt, model). */
  profile: ProviderProfile;
  /** Where tools execute (local, Docker, etc.). */
  executionEnv: ExecutionEnvironment;
  /** The LLM client for making API calls. */
  client: Client;
  /** Max tool rounds per user input (0 = unlimited). */
  maxToolRoundsPerInput?: number;
  /** Max turns across the entire session (0 = unlimited). */
  maxTurns?: number;
  /** User system prompt override. */
  systemPrompt?: string;
  /** Project documentation content (AGENTS.md, etc.). */
  projectDocs?: string;
  /** Per-tool character output limits. */
  toolOutputLimits?: Record<string, number>;
  /** Per-tool line output limits. */
  toolLineLimits?: Record<string, number>;
  /** Max subagent nesting depth (default 1). */
  maxSubagentDepth?: number;
  /** Reasoning effort: "low", "medium", "high", or undefined. */
  reasoningEffort?: string;
  /** Current subagent depth (used internally). */
  currentDepth?: number;
}

/**
 * Session lifecycle states.
 */
export type SessionState = "idle" | "processing" | "awaiting_input" | "closed";

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * The Session manages a single agent conversation. It holds the conversation
 * history, dispatches tool calls, manages the event stream, and enforces limits.
 */
export class Session {
  readonly events: EventEmitter;
  state: SessionState;
  history: Turn[];

  private _config: SessionConfig;
  private _steeringQueue: string[] = [];
  private _followUpQueue: string[] = [];
  private _abortSignaled = false;
  private _currentDepth: number;

  constructor(config: SessionConfig) {
    this._config = config;
    this.events = new EventEmitter();
    this.state = "idle";
    this.history = [];
    this._currentDepth = config.currentDepth ?? 0;

    // Emit SESSION_START
    this.events.emit({
      kind: "SESSION_START",
      timestamp: Date.now(),
    });
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Submit user input and run the agentic loop until natural completion,
   * a limit is hit, or an abort signal fires.
   */
  async processInput(input: string): Promise<void> {
    this.state = "processing";
    this._abortSignaled = false;

    // Append user turn
    const userTurn: UserTurn = {
      type: "user",
      content: input,
      timestamp: Date.now(),
    };
    this.history.push(userTurn);
    this.events.emit({
      kind: "USER_INPUT",
      timestamp: Date.now(),
      data: { content: input },
    });

    // Drain any pending steering before the first LLM call
    this._drainSteering();

    let roundCount = 0;
    const maxRounds = this._config.maxToolRoundsPerInput ?? 0;
    const maxTurns = this._config.maxTurns ?? 0;

    // Main agentic loop
    while (true) {
      // 1. Check limits
      if (maxRounds > 0 && roundCount >= maxRounds) {
        this.events.emit({
          kind: "TURN_LIMIT",
          timestamp: Date.now(),
          data: { round: roundCount },
        });
        break;
      }

      if (maxTurns > 0 && this._countTurns() >= maxTurns) {
        this.events.emit({
          kind: "TURN_LIMIT",
          timestamp: Date.now(),
          data: { totalTurns: this._countTurns() },
        });
        break;
      }

      if (this._abortSignaled) {
        break;
      }

      // 2. Build the environment context
      const env = this._buildEnvironmentContext();

      // 3. Build system prompt
      const systemPromptText = buildSystemPrompt(
        this._config.profile,
        env,
        this._config.projectDocs ?? "",
        this._config.systemPrompt,
      );

      // 4. Convert history to messages
      const messages = this._convertHistoryToMessages();

      // 5. Build the request
      const request: Request = {
        model: this._config.profile.model,
        messages: [createSystemMessage(systemPromptText), ...messages],
        tools: this._config.profile.tools().map((td) => ({
          name: td.name,
          description: td.description,
          parameters: td.parameters,
        })),
        tool_choice: { mode: "auto" as const },
        reasoning_effort: this._config.reasoningEffort,
        provider: this._config.profile.id,
        provider_options: this._config.profile.providerOptions(),
      };

      // 6. Call LLM
      let response: Response;
      try {
        response = await this._config.client.complete(request);
      } catch (error) {
        this.events.emit({
          kind: "ERROR",
          timestamp: Date.now(),
          data: { error: error instanceof Error ? error.message : String(error) },
        });
        this.state = "closed";
        return;
      }

      if (this._abortSignaled) break;

      // 7. Record assistant turn
      const text = getResponseText(response);
      const toolCalls = getResponseToolCalls(response);
      const reasoning = getResponseReasoning(response);

      const assistantTurn: AssistantTurn = {
        type: "assistant",
        content: text,
        toolCalls,
        reasoning: reasoning ?? undefined,
        usage: response.usage,
        responseId: response.id,
        timestamp: Date.now(),
      };
      this.history.push(assistantTurn);

      this.events.emit({
        kind: "ASSISTANT_TEXT_START",
        timestamp: Date.now(),
      });
      this.events.emit({
        kind: "ASSISTANT_TEXT_END",
        timestamp: Date.now(),
        data: { text, reasoning },
      });

      // 8. If no tool calls, natural completion
      if (toolCalls.length === 0) {
        break;
      }

      // 9. Execute tool calls
      roundCount += 1;
      const results = await this._executeToolCalls(toolCalls);

      // 10. Append tool results turn
      const toolResultsTurn: ToolResultsTurn = {
        type: "tool_results",
        results,
        timestamp: Date.now(),
      };
      this.history.push(toolResultsTurn);

      // 11. Drain steering
      this._drainSteering();

      // 12. Loop detection
      if (detectLoop(this.history)) {
        const warning =
          "Loop detected: the last 10 tool calls follow a repeating pattern. Try a different approach.";
        const steeringTurn: SteeringTurn = {
          type: "steering",
          content: warning,
          timestamp: Date.now(),
        };
        this.history.push(steeringTurn);
        this.events.emit({
          kind: "LOOP_DETECTION",
          timestamp: Date.now(),
          data: { message: warning },
        });
      }
    }

    // Process follow-up messages if any are queued
    if (this._followUpQueue.length > 0) {
      const nextInput = this._followUpQueue.shift()!;
      await this.processInput(nextInput);
      return;
    }

    if (!this._abortSignaled) {
      this.state = "idle";
      this.events.emit({
        kind: "SESSION_END",
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Queue a steering message to be injected after the current tool round.
   */
  steer(message: string): void {
    this._steeringQueue.push(message);
  }

  /**
   * Queue a message to be processed after the current input completes.
   */
  followUp(message: string): void {
    this._followUpQueue.push(message);
  }

  /**
   * Abort the current processing. Cancels in-progress LLM calls and kills
   * any running processes.
   */
  abort(): void {
    this._abortSignaled = true;
    this.state = "closed";
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Build the environment context for the system prompt.
   */
  private _buildEnvironmentContext(): EnvironmentContext {
    return {
      workingDirectory: this._config.executionEnv.workingDirectory(),
      isGitRepo: false, // Could be detected, but for now default false
      platform: this._config.executionEnv.platform(),
      osVersion: process.version ?? "unknown",
      date: new Date().toISOString().split("T")[0] ?? new Date().toISOString(),
      model: this._config.profile.model,
    };
  }

  /**
   * Count the total number of turns (user + assistant) in the history.
   */
  private _countTurns(): number {
    return this.history.filter(
      (t) => t.type === "user" || t.type === "assistant",
    ).length;
  }

  /**
   * Drain steering queue, injecting messages as SteeringTurns.
   */
  private _drainSteering(): void {
    while (this._steeringQueue.length > 0) {
      const msg = this._steeringQueue.shift()!;
      const steeringTurn: SteeringTurn = {
        type: "steering",
        content: msg,
        timestamp: Date.now(),
      };
      this.history.push(steeringTurn);
      this.events.emit({
        kind: "STEERING_INJECTED",
        timestamp: Date.now(),
        data: { content: msg },
      });
    }
  }

  /**
   * Convert the conversation history to LLM messages.
   */
  private _convertHistoryToMessages(): Message[] {
    const messages: Message[] = [];

    for (const turn of this.history) {
      switch (turn.type) {
        case "user":
          messages.push(createUserMessage(turn.content));
          break;

        case "assistant": {
          // Build content parts for the assistant message
          const contentParts: Message["content"][number][] = [];

          if (turn.content) {
            contentParts.push({
              kind: ContentKind.TEXT,
              text: turn.content,
            });
          }

          // Add tool call content parts
          for (const tc of turn.toolCalls) {
            contentParts.push({
              kind: ContentKind.TOOL_CALL,
              tool_call: {
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
              },
            });
          }

          messages.push({
            role: Role.ASSISTANT,
            content: contentParts,
          });
          break;
        }

        case "tool_results":
          // Each tool result becomes a separate tool message
          for (const result of turn.results) {
            messages.push(
              createToolResultMessage(
                result.toolCallId,
                result.content,
                result.isError,
              ),
            );
          }
          break;

        case "system":
          messages.push(createSystemMessage(turn.content));
          break;

        case "steering":
          // Steering turns are converted to user-role messages
          messages.push(createUserMessage(turn.content));
          break;
      }
    }

    return messages;
  }

  /**
   * Execute tool calls, supporting parallel execution if the profile allows.
   */
  private async _executeToolCalls(
    toolCalls: ToolCall[],
  ): Promise<ToolResult[]> {
    if (
      this._config.profile.supportsParallelToolCalls &&
      toolCalls.length > 1
    ) {
      // Execute in parallel
      return Promise.all(
        toolCalls.map((tc) => this._executeSingleTool(tc)),
      );
    }

    // Execute sequentially
    const results: ToolResult[] = [];
    for (const tc of toolCalls) {
      const result = await this._executeSingleTool(tc);
      results.push(result);
    }
    return results;
  }

  /**
   * Execute a single tool call.
   */
  private async _executeSingleTool(toolCall: ToolCall): Promise<ToolResult> {
    this.events.emit({
      kind: "TOOL_CALL_START",
      timestamp: Date.now(),
      data: { toolName: toolCall.name, callId: toolCall.id },
    });

    // Look up tool in registry
    const registered = this._config.profile.toolRegistry.get(toolCall.name);
    if (!registered) {
      const errorMsg = `Unknown tool: ${toolCall.name}`;
      this.events.emit({
        kind: "TOOL_CALL_END",
        timestamp: Date.now(),
        data: { callId: toolCall.id, error: errorMsg },
      });
      return {
        toolCallId: toolCall.id,
        content: errorMsg,
        isError: true,
      };
    }

    // Execute via execution environment
    try {
      const rawOutput = await registered.executor(
        toolCall.arguments,
        this._config.executionEnv,
      );

      // Truncate output before sending to LLM
      const truncatedOutput = truncateToolOutput(rawOutput, toolCall.name);

      // Emit full output via event stream (not truncated)
      this.events.emit({
        kind: "TOOL_CALL_END",
        timestamp: Date.now(),
        data: { callId: toolCall.id, output: rawOutput },
      });

      return {
        toolCallId: toolCall.id,
        content: truncatedOutput,
        isError: false,
      };
    } catch (error) {
      const errorMsg = `Tool error (${toolCall.name}): ${error instanceof Error ? error.message : String(error)}`;
      this.events.emit({
        kind: "TOOL_CALL_END",
        timestamp: Date.now(),
        data: { callId: toolCall.id, error: errorMsg },
      });
      return {
        toolCallId: toolCall.id,
        content: errorMsg,
        isError: true,
      };
    }
  }
}
