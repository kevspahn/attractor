/**
 * Anthropic provider profile (Claude Code-aligned).
 *
 * Tools: read_file, write_file, edit_file, shell, grep, glob
 * Default model: claude-sonnet-4-5
 * Default command timeout: 120000ms (120s)
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
 * Create an Anthropic provider profile.
 */
export function createAnthropicProfile(
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
    id: "anthropic",
    model: model ?? "claude-sonnet-4-5",
    toolRegistry: registry,
    supportsReasoning: true,
    supportsStreaming: true,
    supportsParallelToolCalls: true,
    contextWindowSize: 200_000,
    defaultCommandTimeoutMs: 120_000,

    buildSystemPrompt(env: EnvironmentContext, projectDocs: string): string {
      const parts: string[] = [];

      // Provider-specific base instructions (Claude Code-aligned)
      parts.push(`You are a coding agent. You help users with software engineering tasks by reading, writing, and editing code, running shell commands, and searching codebases.

## Tool Usage Guidelines

- **Prefer editing existing files** over creating new ones. Use edit_file to modify code in place.
- **Always read a file before editing it.** Use read_file first to understand the current content, then use edit_file to make changes.
- **The old_string in edit_file must be unique.** If old_string matches multiple locations, the edit will fail. Provide enough surrounding context to make the match unique. If you need to change all occurrences, set replace_all to true.
- **Use write_file only for new files** or when you need to completely replace a file's content.
- **When running shell commands**, prefer specific targeted commands over broad ones. For example, use grep to search rather than reading entire directories.

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
