/**
 * Tool type definitions for the agent loop.
 */

/**
 * Defines a tool's name, description, and parameter schema for the LLM.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object. Root must be type "object". */
  parameters: Record<string, unknown>;
}

/**
 * A tool with its definition and executor function.
 */
export interface RegisteredTool {
  definition: ToolDefinition;
  executor: (
    args: Record<string, unknown>,
    env: ExecutionEnvironment,
  ) => Promise<string>;
}

/**
 * The result of executing a tool call.
 */
export interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

/**
 * Result of executing a shell command.
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

/**
 * A directory entry from listDirectory.
 */
export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

/**
 * Options for command execution.
 */
export interface ExecOptions {
  timeoutMs?: number;
  workingDir?: string;
  envVars?: Record<string, string>;
}

/**
 * Options for grep searches.
 */
export interface GrepOptions {
  globFilter?: string;
  caseInsensitive?: boolean;
  maxResults?: number;
}

/**
 * Abstraction for where tools run. The default is local; swap in Docker,
 * Kubernetes, WASM, SSH, etc. without changing tool logic.
 */
export interface ExecutionEnvironment {
  /** Read file with line-numbered formatting (NNN | content). */
  readFile(path: string, offset?: number, limit?: number): Promise<string>;
  /** Read raw file content (no line numbers). Used internally by edit/patch tools. */
  readFileRaw(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  listDirectory(path: string, depth?: number): Promise<DirEntry[]>;
  execCommand(command: string, options?: ExecOptions): Promise<ExecResult>;
  grep(pattern: string, path?: string, options?: GrepOptions): Promise<string>;
  glob(pattern: string, path?: string): Promise<string[]>;
  workingDirectory(): string;
  platform(): string;
}

/**
 * Configuration for tool output truncation.
 */
export interface TruncationConfig {
  maxChars?: number;
  mode?: "head_tail" | "tail";
  maxLines?: number;
}
