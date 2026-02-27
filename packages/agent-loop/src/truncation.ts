/**
 * Tool output truncation.
 *
 * Truncation pipeline: character-based first (handles pathological cases),
 * then line-based (readability pass).
 */

import type { TruncationConfig } from "./types.js";

/**
 * Default character limits per tool.
 */
const DEFAULT_CHAR_LIMITS: Record<string, number> = {
  read_file: 50_000,
  shell: 30_000,
  grep: 20_000,
  glob: 20_000,
  edit_file: 10_000,
  apply_patch: 10_000,
  write_file: 1_000,
  spawn_agent: 20_000,
};

/**
 * Default truncation mode per tool.
 */
const DEFAULT_TRUNCATION_MODES: Record<string, "head_tail" | "tail"> = {
  read_file: "head_tail",
  shell: "head_tail",
  grep: "tail",
  glob: "tail",
  edit_file: "tail",
  apply_patch: "tail",
  write_file: "tail",
  spawn_agent: "head_tail",
};

/**
 * Default line limits per tool (null = no line limit).
 */
const DEFAULT_LINE_LIMITS: Record<string, number | null> = {
  read_file: null,
  shell: 256,
  grep: 200,
  glob: 500,
  edit_file: null,
  apply_patch: null,
  write_file: null,
  spawn_agent: null,
};

/**
 * Character-based truncation.
 *
 * @param output The text to truncate
 * @param maxChars Maximum characters to keep
 * @param mode 'head_tail' keeps first/last halves; 'tail' keeps last portion
 */
export function truncateOutput(
  output: string,
  maxChars: number,
  mode: "head_tail" | "tail",
): string {
  if (output.length <= maxChars) {
    return output;
  }

  const removed = output.length - maxChars;

  if (mode === "head_tail") {
    const half = Math.floor(maxChars / 2);
    const head = output.substring(0, half);
    const tail = output.substring(output.length - half);
    const warning =
      `\n\n[WARNING: Tool output was truncated. ${removed} characters were removed from the middle. ` +
      `The full output is available in the event stream. ` +
      `If you need to see specific parts, re-run the tool with more targeted parameters.]\n\n`;
    return head + warning + tail;
  }

  // mode === "tail"
  const warning =
    `[WARNING: Tool output was truncated. First ${removed} characters were removed. ` +
    `The full output is available in the event stream.]\n\n`;
  return warning + output.substring(output.length - maxChars);
}

/**
 * Line-based truncation. Head/tail split with omission marker.
 *
 * @param output The text to truncate (already character-truncated)
 * @param maxLines Maximum lines to keep
 */
export function truncateLines(output: string, maxLines: number): string {
  const lines = output.split("\n");
  if (lines.length <= maxLines) {
    return output;
  }

  const headCount = Math.floor(maxLines / 2);
  const tailCount = maxLines - headCount;
  const omitted = lines.length - headCount - tailCount;

  const head = lines.slice(0, headCount).join("\n");
  const tail = lines.slice(lines.length - tailCount).join("\n");

  return head + `\n[... ${omitted} lines omitted ...]\n` + tail;
}

/**
 * Full truncation pipeline for a tool's output.
 *
 * Step 1: Character-based truncation (primary safeguard).
 * Step 2: Line-based truncation (readability).
 *
 * @param output Raw tool output
 * @param toolName Name of the tool (for looking up defaults)
 * @param config Optional overrides
 */
export function truncateToolOutput(
  output: string,
  toolName: string,
  config?: TruncationConfig,
): string {
  // Step 1: Character-based truncation
  const maxChars = config?.maxChars ?? DEFAULT_CHAR_LIMITS[toolName] ?? 30_000;
  const mode = config?.mode ?? DEFAULT_TRUNCATION_MODES[toolName] ?? "head_tail";
  let result = truncateOutput(output, maxChars, mode);

  // Step 2: Line-based truncation
  const maxLines = config?.maxLines ?? DEFAULT_LINE_LIMITS[toolName] ?? null;
  if (maxLines !== null) {
    result = truncateLines(result, maxLines);
  }

  return result;
}
