/**
 * Gemini provider profile (gemini-cli-aligned).
 *
 * Tools: read_file, write_file, edit_file, shell, grep, glob
 * Default model: gemini-3-flash-preview
 * Default command timeout: 10000ms (10s)
 */

import { ToolRegistry } from "../tool-registry.js";
import {
  readFileTool,
  writeFileTool,
  editFileTool,
  shellTool,
  grepTool,
  globTool,
} from "../tools/index.js";
import type { ToolDefinition } from "../types.js";
import type { ProviderProfile, EnvironmentContext } from "./types.js";

/**
 * Create a Gemini provider profile.
 */
export function createGeminiProfile(
  model?: string,
): ProviderProfile {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(shellTool);
  registry.register(grepTool);
  registry.register(globTool);

  return {
    id: "gemini",
    model: model ?? "gemini-3-flash-preview",
    toolRegistry: registry,
    supportsReasoning: true,
    supportsStreaming: true,
    supportsParallelToolCalls: true,
    contextWindowSize: 1_048_576,
    defaultCommandTimeoutMs: 10_000,

    buildSystemPrompt(env: EnvironmentContext, projectDocs: string): string {
      const parts: string[] = [];

      // Provider-specific base instructions (gemini-cli-aligned)
      parts.push(`You are a coding agent. You help users with software engineering tasks by reading, writing, and editing code, running shell commands, and searching codebases.

## Tool Usage Guidelines

- **Prefer editing existing files** over creating new ones. Use edit_file to modify code in place.
- **Always read a file before editing it.** Use read_file first to understand the current content, then use edit_file to make changes.
- **The old_string in edit_file must be unique.** Provide enough surrounding context to make the match unique. Use replace_all for global replacements.
- **Use write_file for creating new files** or complete file rewrites.
- **When running shell commands**, the default timeout is 10 seconds. Use the timeout_ms parameter for longer-running commands.
- **Use grep and glob** for searching and finding files efficiently before reading them.

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
