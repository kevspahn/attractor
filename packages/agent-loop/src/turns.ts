/**
 * Turn types for the agent loop conversation history.
 *
 * A Turn is a single entry in the conversation history. The Session maintains
 * an ordered list of turns that represent the full conversation.
 */

import type { ToolCall, Usage } from "@attractor/llm-client";
import type { ToolResult } from "./types.js";

/**
 * A user message submitted to the agent.
 */
export interface UserTurn {
  type: "user";
  content: string;
  timestamp: number;
}

/**
 * The assistant's response from the LLM.
 */
export interface AssistantTurn {
  type: "assistant";
  content: string;
  toolCalls: ToolCall[];
  reasoning?: string;
  usage?: Usage;
  responseId?: string;
  timestamp: number;
}

/**
 * Results from executing tool calls.
 */
export interface ToolResultsTurn {
  type: "tool_results";
  results: ToolResult[];
  timestamp: number;
}

/**
 * A system-level message (e.g., initial instructions).
 */
export interface SystemTurn {
  type: "system";
  content: string;
  timestamp: number;
}

/**
 * A steering message injected by the host application.
 * Converted to a user-role message for the LLM.
 */
export interface SteeringTurn {
  type: "steering";
  content: string;
  timestamp: number;
}

/**
 * Discriminated union of all turn types.
 */
export type Turn =
  | UserTurn
  | AssistantTurn
  | ToolResultsTurn
  | SystemTurn
  | SteeringTurn;
