/**
 * Provider profile types.
 *
 * Each profile registers its native tools and builds its system prompt,
 * aligning with the provider's reference agent (codex-rs, Claude Code, gemini-cli).
 */

import type { ToolRegistry } from "../tool-registry.js";
import type { ToolDefinition } from "../types.js";

/**
 * Runtime environment context for system prompt assembly.
 */
export interface EnvironmentContext {
  workingDirectory: string;
  isGitRepo: boolean;
  gitBranch?: string;
  platform: string;
  osVersion: string;
  date: string;
  model: string;
}

/**
 * A provider-aligned profile that configures tools and system prompts
 * for a specific LLM provider/model family.
 */
export interface ProviderProfile {
  /** Provider identifier: "openai", "anthropic", "gemini". */
  id: string;
  /** Default model for this profile. */
  model: string;
  /** The tool registry with all tools for this profile. */
  toolRegistry: ToolRegistry;

  /** Build the provider-specific base system prompt. */
  buildSystemPrompt(env: EnvironmentContext, projectDocs: string): string;
  /** Return all tool definitions for the LLM. */
  tools(): ToolDefinition[];
  /** Return provider-specific options for the request. */
  providerOptions(): Record<string, unknown> | undefined;

  /** Whether this profile's model supports reasoning/thinking. */
  supportsReasoning: boolean;
  /** Whether this profile's model supports streaming responses. */
  supportsStreaming: boolean;
  /** Whether this profile's model supports parallel tool calls. */
  supportsParallelToolCalls: boolean;
  /** The context window size in tokens. */
  contextWindowSize: number;
  /** Default command timeout in milliseconds. */
  defaultCommandTimeoutMs: number;
}
