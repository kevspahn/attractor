/**
 * Loop detection for the agentic loop.
 *
 * Checks for repeating tool call patterns in the conversation history.
 * Detects 1-cycle (AAAA), 2-cycle (ABAB), and 3-cycle (ABCABC) patterns
 * over the last N tool calls.
 */

import type { Turn, AssistantTurn } from "./turns.js";

/**
 * Extract tool call names from recent assistant turns.
 */
function extractToolCallNames(history: Turn[], count: number): string[] {
  const names: string[] = [];

  // Walk history backwards to collect tool call names
  for (let i = history.length - 1; i >= 0 && names.length < count; i--) {
    const turn = history[i]!;
    if (turn.type === "assistant") {
      const assistantTurn = turn as AssistantTurn;
      // Add tool call names in reverse order (we'll reverse at the end)
      for (
        let j = assistantTurn.toolCalls.length - 1;
        j >= 0 && names.length < count;
        j--
      ) {
        names.push(assistantTurn.toolCalls[j]!.name);
      }
    }
  }

  // Reverse to get chronological order
  names.reverse();
  return names;
}

/**
 * Detect repeating patterns in recent tool calls.
 *
 * Checks the last `windowSize` tool call names for 1-cycle (AAAA),
 * 2-cycle (ABAB), and 3-cycle (ABCABC) repetition patterns.
 *
 * @param history The conversation history
 * @param windowSize Number of recent tool calls to check (default: 10)
 * @returns true if a repeating pattern is detected
 */
export function detectLoop(
  history: Turn[],
  windowSize: number = 10,
): boolean {
  const recentCalls = extractToolCallNames(history, windowSize);

  // Not enough calls to detect a pattern
  if (recentCalls.length < windowSize) {
    return false;
  }

  // Check for repeating patterns of length 1, 2, and 3
  for (const patternLen of [1, 2, 3]) {
    if (windowSize % patternLen !== 0) continue;

    const pattern = recentCalls.slice(0, patternLen);
    let allMatch = true;

    for (let i = patternLen; i < windowSize; i += patternLen) {
      const segment = recentCalls.slice(i, i + patternLen);
      for (let j = 0; j < patternLen; j++) {
        if (segment[j] !== pattern[j]) {
          allMatch = false;
          break;
        }
      }
      if (!allMatch) break;
    }

    if (allMatch) return true;
  }

  return false;
}
