/**
 * edit_file tool: exact string search-and-replace in a file.
 */

import type { RegisteredTool } from "../types.js";

export const editFileTool: RegisteredTool = {
  definition: {
    name: "edit_file",
    description:
      "Replace an exact string occurrence in a file. The old_string must be unique in the file unless replace_all is true.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the file",
        },
        old_string: {
          type: "string",
          description: "Exact text to find in the file",
        },
        new_string: {
          type: "string",
          description: "Replacement text",
        },
        replace_all: {
          type: "boolean",
          description: "Replace all occurrences (default: false)",
        },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },
  executor: async (args, env) => {
    const filePath = args.file_path as string;
    const oldString = args.old_string as string;
    const newString = args.new_string as string;
    const replaceAll = (args.replace_all as boolean) ?? false;

    // Read raw file content
    const rawContent = await env.readFileRaw(filePath);

    // Check if old_string exists
    if (!rawContent.includes(oldString)) {
      throw new Error(
        `old_string not found in ${filePath}. Make sure the string matches exactly, including whitespace and indentation.`,
      );
    }

    // Count occurrences
    let count = 0;
    let pos = 0;
    while (true) {
      const idx = rawContent.indexOf(oldString, pos);
      if (idx === -1) break;
      count++;
      pos = idx + oldString.length;
    }

    if (count > 1 && !replaceAll) {
      throw new Error(
        `old_string is not unique in ${filePath} (found ${count} occurrences). Provide more context to make the match unique, or set replace_all to true.`,
      );
    }

    // Perform replacement
    let newContent: string;
    let replacements: number;
    if (replaceAll) {
      newContent = rawContent.split(oldString).join(newString);
      replacements = count;
    } else {
      // Replace only first occurrence
      const idx = rawContent.indexOf(oldString);
      newContent =
        rawContent.substring(0, idx) +
        newString +
        rawContent.substring(idx + oldString.length);
      replacements = 1;
    }

    await env.writeFile(filePath, newContent);

    return `Successfully replaced ${replacements} occurrence${replacements !== 1 ? "s" : ""} in ${filePath}`;
  },
};
