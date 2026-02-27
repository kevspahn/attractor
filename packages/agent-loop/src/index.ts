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
} from "./tools/index.js";
