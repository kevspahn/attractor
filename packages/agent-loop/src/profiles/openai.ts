/**
 * OpenAI provider profile (codex-rs-aligned).
 *
 * Tools: read_file, apply_patch, write_file, shell, grep, glob
 * Default model: gpt-5.2-codex
 * Default command timeout: 10000ms (10s)
 */

import { ToolRegistry } from "../tool-registry.js";
import {
  readFileTool,
  writeFileTool,
  applyPatchTool,
  shellTool,
  grepTool,
  globTool,
} from "../tools/index.js";
import type { ToolDefinition } from "../types.js";
import type { ProviderProfile, EnvironmentContext } from "./types.js";

/**
 * Create an OpenAI provider profile.
 */
export function createOpenAIProfile(
  model?: string,
): ProviderProfile {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(applyPatchTool);
  registry.register(writeFileTool);
  registry.register(shellTool);
  registry.register(grepTool);
  registry.register(globTool);

  return {
    id: "openai",
    model: model ?? "gpt-5.2-codex",
    toolRegistry: registry,
    supportsReasoning: true,
    supportsStreaming: true,
    supportsParallelToolCalls: true,
    contextWindowSize: 1_047_576,
    defaultCommandTimeoutMs: 10_000,

    buildSystemPrompt(env: EnvironmentContext, projectDocs: string): string {
      const parts: string[] = [];

      // Provider-specific base instructions (codex-rs-aligned)
      parts.push(`You are a coding agent. You help users with software engineering tasks by reading, writing, and editing code, running shell commands, and searching codebases.

## Tool Usage Guidelines

- **Use apply_patch for file modifications.** The apply_patch tool uses the v4a diff format optimized for code changes. It supports creating, deleting, and modifying files in a single operation.
- **Use write_file for creating new files** when you need to create a file without patch overhead.
- **Always read a file before modifying it.** Use read_file to understand the current content before applying patches.
- **When running shell commands**, the default timeout is 10 seconds. Use the timeout_ms parameter for commands that need more time.

## apply_patch Format

The patch format uses unified diff style with --- and +++ headers followed by @@ hunks. Each hunk specifies the line range and the changes (lines prefixed with - for removal, + for addition, and space for context).

## Coding Best Practices

- Write clean, readable code with appropriate comments.
- Follow the existing code style and conventions in the project.
- Handle errors appropriately.
- Write tests when adding new functionality.
- Make minimal, focused changes rather than large rewrites.
- Verify changes work by running relevant tests or commands.`);

      return parts.join("\n\n");
    },

    tools(): ToolDefinition[] {
      return registry.definitions();
    },

    providerOptions(): Record<string, unknown> | undefined {
      return undefined;
    },
  };
}
