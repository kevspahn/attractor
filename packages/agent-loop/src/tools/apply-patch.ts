/**
 * apply_patch tool: OpenAI v4a patch format parser and applier.
 *
 * Patch format:
 *   *** Begin Patch
 *   *** Add File: <path>
 *   +<added lines>
 *   *** Delete File: <path>
 *   *** Update File: <path>
 *   [*** Move to: <new_path>]
 *   @@ <context_hint>
 *    <context line>  (space prefix)
 *   -<removed line>  (minus prefix)
 *   +<added line>    (plus prefix)
 *   *** End Patch
 */

import type { ExecutionEnvironment, RegisteredTool } from "../types.js";

// ---------------------------------------------------------------------------
// Patch data structures
// ---------------------------------------------------------------------------

interface AddFileOp {
  kind: "add";
  path: string;
  content: string;
}

interface DeleteFileOp {
  kind: "delete";
  path: string;
}

interface Hunk {
  contextHint: string;
  lines: HunkLine[];
}

interface HunkLine {
  type: "context" | "delete" | "add";
  content: string;
}

interface UpdateFileOp {
  kind: "update";
  path: string;
  moveTo?: string;
  hunks: Hunk[];
}

type PatchOp = AddFileOp | DeleteFileOp | UpdateFileOp;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parsePatch(patchText: string): PatchOp[] {
  const lines = patchText.split("\n");
  const ops: PatchOp[] = [];
  let i = 0;

  // Find "*** Begin Patch"
  while (i < lines.length && lines[i]?.trim() !== "*** Begin Patch") {
    i++;
  }
  if (i >= lines.length) {
    throw new Error("Patch does not contain '*** Begin Patch'");
  }
  i++; // skip "*** Begin Patch"

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === "*** End Patch") {
      break;
    }

    // *** Add File: <path>
    const addMatch = line.match(/^\*\*\* Add File: (.+)$/);
    if (addMatch) {
      i++;
      const contentLines: string[] = [];
      while (i < lines.length) {
        const cl = lines[i]!;
        if (cl.startsWith("***") || cl.trim() === "*** End Patch") break;
        if (cl.startsWith("+")) {
          contentLines.push(cl.substring(1));
        }
        i++;
      }
      ops.push({
        kind: "add",
        path: addMatch[1]!,
        content: contentLines.join("\n"),
      });
      continue;
    }

    // *** Delete File: <path>
    const deleteMatch = line.match(/^\*\*\* Delete File: (.+)$/);
    if (deleteMatch) {
      ops.push({
        kind: "delete",
        path: deleteMatch[1]!,
      });
      i++;
      continue;
    }

    // *** Update File: <path>
    const updateMatch = line.match(/^\*\*\* Update File: (.+)$/);
    if (updateMatch) {
      i++;
      let moveTo: string | undefined;

      // Check for *** Move to:
      if (i < lines.length) {
        const moveMatch = lines[i]!.match(/^\*\*\* Move to: (.+)$/);
        if (moveMatch) {
          moveTo = moveMatch[1]!;
          i++;
        }
      }

      // Parse hunks
      const hunks: Hunk[] = [];
      while (i < lines.length) {
        const hl = lines[i]!;
        if (hl.startsWith("***")) break; // next operation or end

        const hunkMatch = hl.match(/^@@ ?(.*)$/);
        if (hunkMatch) {
          const contextHint = hunkMatch[1]!.trim();
          i++;
          const hunkLines: HunkLine[] = [];
          while (i < lines.length) {
            const hll = lines[i]!;
            if (hll.startsWith("@@") || hll.startsWith("***")) break;
            if (hll.startsWith(" ")) {
              hunkLines.push({ type: "context", content: hll.substring(1) });
            } else if (hll.startsWith("-")) {
              hunkLines.push({ type: "delete", content: hll.substring(1) });
            } else if (hll.startsWith("+")) {
              hunkLines.push({ type: "add", content: hll.substring(1) });
            }
            // else skip unrecognized lines
            i++;
          }
          hunks.push({ contextHint, lines: hunkLines });
        } else {
          i++;
        }
      }

      ops.push({
        kind: "update",
        path: updateMatch[1]!,
        moveTo,
        hunks,
      });
      continue;
    }

    // Skip unrecognized lines
    i++;
  }

  return ops;
}

// ---------------------------------------------------------------------------
// Hunk application
// ---------------------------------------------------------------------------

/**
 * Find the position in fileLines where a hunk's context and delete lines match.
 * Uses the context hint as a starting search point, then verifies with
 * context/delete lines.
 */
function findHunkPosition(
  fileLines: string[],
  hunk: Hunk,
  searchStart: number,
): number {
  // Collect the expected lines (context + delete, in order)
  const expectedLines: string[] = [];
  for (const hl of hunk.lines) {
    if (hl.type === "context" || hl.type === "delete") {
      expectedLines.push(hl.content);
    }
  }

  if (expectedLines.length === 0) {
    // No context/delete lines means insert at current position
    return searchStart;
  }

  // Try to find a match starting from searchStart
  for (let pos = searchStart; pos <= fileLines.length - expectedLines.length; pos++) {
    let match = true;
    for (let j = 0; j < expectedLines.length; j++) {
      if (fileLines[pos + j] !== expectedLines[j]) {
        match = false;
        break;
      }
    }
    if (match) return pos;
  }

  // Try fuzzy matching (whitespace normalization)
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  for (let pos = searchStart; pos <= fileLines.length - expectedLines.length; pos++) {
    let match = true;
    for (let j = 0; j < expectedLines.length; j++) {
      if (normalize(fileLines[pos + j]!) !== normalize(expectedLines[j]!)) {
        match = false;
        break;
      }
    }
    if (match) return pos;
  }

  // Also try searching from the beginning if searchStart > 0
  if (searchStart > 0) {
    for (let pos = 0; pos < searchStart; pos++) {
      let match = true;
      for (let j = 0; j < expectedLines.length; j++) {
        if (fileLines[pos + j] !== expectedLines[j]) {
          match = false;
          break;
        }
      }
      if (match) return pos;
    }
  }

  throw new Error(
    `Could not find hunk location. Context hint: "${hunk.contextHint}". ` +
      `Expected lines starting with: "${expectedLines[0]}"`,
  );
}

function applyHunk(
  fileLines: string[],
  hunk: Hunk,
  searchStart: number,
): { result: string[]; nextSearchStart: number } {
  const pos = findHunkPosition(fileLines, hunk, searchStart);
  const result: string[] = [];

  // Copy lines before the hunk
  for (let i = 0; i < pos; i++) {
    result.push(fileLines[i]!);
  }

  // Apply the hunk
  let fileIdx = pos;
  for (const hl of hunk.lines) {
    switch (hl.type) {
      case "context":
        result.push(fileLines[fileIdx]!);
        fileIdx++;
        break;
      case "delete":
        fileIdx++; // skip the deleted line
        break;
      case "add":
        result.push(hl.content);
        break;
    }
  }

  // Copy remaining lines
  for (let i = fileIdx; i < fileLines.length; i++) {
    result.push(fileLines[i]!);
  }

  return { result, nextSearchStart: pos + result.length - fileLines.length + fileIdx - pos };
}

// ---------------------------------------------------------------------------
// Operation execution
// ---------------------------------------------------------------------------

async function executeOp(
  op: PatchOp,
  env: ExecutionEnvironment,
): Promise<string> {
  switch (op.kind) {
    case "add": {
      await env.writeFile(op.path, op.content + (op.content.length > 0 ? "\n" : ""));
      return `Added file: ${op.path}`;
    }
    case "delete": {
      // Delete by writing empty then using shell
      const result = await env.execCommand(`rm -f '${op.path.replace(/'/g, "'\\''")}'`, {
        timeoutMs: 5000,
      });
      if (result.exitCode !== 0) {
        throw new Error(`Failed to delete ${op.path}: ${result.stderr}`);
      }
      return `Deleted file: ${op.path}`;
    }
    case "update": {
      // Read existing file
      const rawContent = await env.readFileRaw(op.path);
      let fileLines = rawContent.split("\n");
      // Remove trailing empty line if file ends with newline
      if (fileLines.length > 0 && fileLines[fileLines.length - 1] === "") {
        fileLines.pop();
      }

      // Apply hunks in order
      let searchStart = 0;
      for (const hunk of op.hunks) {
        const applied = applyHunk(fileLines, hunk, searchStart);
        fileLines = applied.result;
        // Next search starts after the applied hunk region
        searchStart = Math.max(0, applied.nextSearchStart);
      }

      const newContent = fileLines.join("\n") + "\n";

      if (op.moveTo) {
        // Rename: write to new path, delete old
        await env.writeFile(op.moveTo, newContent);
        await env.execCommand(`rm -f '${op.path.replace(/'/g, "'\\''")}'`, {
          timeoutMs: 5000,
        });
        return `Updated and renamed: ${op.path} -> ${op.moveTo}`;
      } else {
        await env.writeFile(op.path, newContent);
        return `Updated file: ${op.path}`;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const applyPatchTool: RegisteredTool = {
  definition: {
    name: "apply_patch",
    description:
      "Apply code changes using the v4a patch format. Supports creating, deleting, and modifying files in a single operation.",
    parameters: {
      type: "object",
      properties: {
        patch: {
          type: "string",
          description: "The patch content in v4a format",
        },
      },
      required: ["patch"],
    },
  },
  executor: async (args, env) => {
    const patchText = args.patch as string;
    const ops = parsePatch(patchText);

    if (ops.length === 0) {
      throw new Error("Patch contains no operations");
    }

    const results: string[] = [];
    for (const op of ops) {
      const result = await executeOp(op, env);
      results.push(result);
    }

    return results.join("\n");
  },
};
