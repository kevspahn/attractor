/**
 * glob tool: find files matching a glob pattern.
 */

import type { RegisteredTool } from "../types.js";

export const globTool: RegisteredTool = {
  definition: {
    name: "glob",
    description:
      "Find files matching a glob pattern. Returns paths sorted by modification time (newest first).",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: 'Glob pattern (e.g., "**/*.ts")',
        },
        path: {
          type: "string",
          description: "Base directory (default: working directory)",
        },
      },
      required: ["pattern"],
    },
  },
  executor: async (args, env) => {
    const pattern = args.pattern as string;
    const basePath = args.path as string | undefined;

    const matches = await env.glob(pattern, basePath);

    if (matches.length === 0) {
      return "No files found matching the pattern.";
    }

    return matches.join("\n");
  },
};
