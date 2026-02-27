/**
 * write_file tool: writes content to a file, creating it and parent dirs if needed.
 */

import type { RegisteredTool } from "../types.js";

export const writeFileTool: RegisteredTool = {
  definition: {
    name: "write_file",
    description:
      "Write content to a file. Creates the file and parent directories if needed.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the file",
        },
        content: {
          type: "string",
          description: "The full file content to write",
        },
      },
      required: ["file_path", "content"],
    },
  },
  executor: async (args, env) => {
    const filePath = args.file_path as string;
    const content = args.content as string;
    await env.writeFile(filePath, content);
    const bytes = Buffer.byteLength(content, "utf-8");
    return `Successfully wrote ${bytes} bytes to ${filePath}`;
  },
};
