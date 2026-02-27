export const VERSION = "0.1.0";

// Core types
export type {
  ToolDefinition,
  RegisteredTool,
  ToolResult,
  ExecResult,
  DirEntry,
  ExecOptions,
  GrepOptions,
  ExecutionEnvironment,
  TruncationConfig,
} from "./types.js";

// Tool registry
export { ToolRegistry } from "./tool-registry.js";

// Execution environment
export { LocalExecutionEnvironment } from "./execution-env.js";

// Truncation
export {
  truncateOutput,
  truncateLines,
  truncateToolOutput,
} from "./truncation.js";

// Built-in tools
export {
  readFileTool,
  writeFileTool,
  editFileTool,
  shellTool,
  grepTool,
  globTool,
  applyPatchTool,
  createSubagentTools,
} from "./tools/index.js";

// Events
export type { EventKind, AgentEvent } from "./events.js";
export { EventEmitter } from "./events.js";

// Turns
export type {
  UserTurn,
  AssistantTurn,
  ToolResultsTurn,
  SystemTurn,
  SteeringTurn,
  Turn,
} from "./turns.js";

// Provider profiles
export type { ProviderProfile, EnvironmentContext } from "./profiles/index.js";
export {
  createAnthropicProfile,
  createOpenAIProfile,
  createGeminiProfile,
} from "./profiles/index.js";

// System prompt
export { buildSystemPrompt } from "./system-prompt.js";

// Loop detection
export { detectLoop } from "./loop-detection.js";

// Session
export type { SessionConfig, SessionState } from "./session.js";
export { Session } from "./session.js";

// Subagent
export type { SubAgentHandle, SubAgentResult } from "./subagent.js";
export { SubAgentManager } from "./subagent.js";
