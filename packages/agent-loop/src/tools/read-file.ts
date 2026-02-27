/**
 * read_file tool: reads a file's contents with line numbers.
 */

import type { RegisteredTool } from "../types.js";

export const readFileTool: RegisteredTool = {
  definition: {
    name: "read_file",
    description:
      "Read a file from the filesystem. Returns line-numbered content.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the file",
        },
        offset: {
          type: "integer",
          description: "1-based line number to start reading from",
        },
        limit: {
          type: "integer",
          description: "Maximum number of lines to read (default: 2000)",
        },
      },
      required: ["file_path"],
    },
  },
  executor: async (args, env) => {
    const filePath = args.file_path as string;
    const offset = args.offset as number | undefined;
    const limit = args.limit as number | undefined;
    return env.readFile(filePath, offset, limit);
  },
};
