/**
 * grep tool: search file contents using regex patterns.
 */

import type { RegisteredTool } from "../types.js";

export const grepTool: RegisteredTool = {
  definition: {
    name: "grep",
    description: "Search file contents using regex patterns.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern to search for",
        },
        path: {
          type: "string",
          description:
            "Directory or file to search (default: working directory)",
        },
        glob_filter: {
          type: "string",
          description: 'File pattern filter (e.g., "*.py")',
        },
        case_insensitive: {
          type: "boolean",
          description: "Case insensitive search (default: false)",
        },
        max_results: {
          type: "integer",
          description: "Maximum number of results (default: 100)",
        },
      },
      required: ["pattern"],
    },
  },
  executor: async (args, env) => {
    const pattern = args.pattern as string;
    const searchPath = args.path as string | undefined;
    const globFilter = args.glob_filter as string | undefined;
    const caseInsensitive = args.case_insensitive as boolean | undefined;
    const maxResults = args.max_results as number | undefined;

    return env.grep(pattern, searchPath, {
      globFilter,
      caseInsensitive: caseInsensitive ?? false,
      maxResults: maxResults ?? 100,
    });
  },
};
