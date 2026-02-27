/**
 * shell tool: executes a command in the system shell.
 */

import type { RegisteredTool } from "../types.js";

export const shellTool: RegisteredTool = {
  definition: {
    name: "shell",
    description:
      "Execute a shell command. Returns stdout, stderr, and exit code.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The command to run",
        },
        timeout_ms: {
          type: "integer",
          description: "Override default timeout in milliseconds",
        },
        description: {
          type: "string",
          description: "Human-readable description of what this command does",
        },
      },
      required: ["command"],
    },
  },
  executor: async (args, env) => {
    const command = args.command as string;
    const timeoutMs = args.timeout_ms as number | undefined;

    const result = await env.execCommand(command, {
      timeoutMs,
    });

    const parts: string[] = [];

    if (result.stdout) {
      parts.push(result.stdout);
    }
    if (result.stderr) {
      parts.push(`[stderr]\n${result.stderr}`);
    }

    parts.push(`[exit_code: ${result.exitCode}, duration: ${result.durationMs}ms]`);

    if (result.timedOut) {
      parts.push(
        `\n[ERROR: Command timed out after ${timeoutMs ?? 10000}ms. Partial output is shown above.\nYou can retry with a longer timeout by setting the timeout_ms parameter.]`,
      );
    }

    return parts.join("\n");
  },
};
