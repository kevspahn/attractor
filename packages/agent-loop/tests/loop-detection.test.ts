/**
 * Tests for loop detection.
 */

import { describe, it, expect } from "vitest";
import { detectLoop } from "../src/loop-detection.js";
import type { Turn, AssistantTurn, ToolResultsTurn } from "../src/turns.js";

/** Helper to create an assistant turn with tool calls. */
function assistantWithTools(...toolNames: string[]): AssistantTurn {
  return {
    type: "assistant",
    content: "",
    toolCalls: toolNames.map((name, i) => ({
      id: `call-${i}`,
      name,
      arguments: {},
    })),
    timestamp: Date.now(),
  };
}

/** Helper to create a tool results turn. */
function toolResults(count: number): ToolResultsTurn {
  return {
    type: "tool_results",
    results: Array.from({ length: count }, (_, i) => ({
      toolCallId: `call-${i}`,
      content: "ok",
      isError: false,
    })),
    timestamp: Date.now(),
  };
}

describe("detectLoop", () => {
  it("should detect 1-cycle repetition (AAAAAAAAAA)", () => {
    // 10 calls to the same tool
    const history: Turn[] = [];
    for (let i = 0; i < 10; i++) {
      history.push(assistantWithTools("read_file"));
      history.push(toolResults(1));
    }

    expect(detectLoop(history, 10)).toBe(true);
  });

  it("should detect 2-cycle repetition (ABABABABAB)", () => {
    // Alternating pattern of 2 tools, repeated 5 times = 10 calls
    const history: Turn[] = [];
    for (let i = 0; i < 5; i++) {
      history.push(assistantWithTools("read_file"));
      history.push(toolResults(1));
      history.push(assistantWithTools("edit_file"));
      history.push(toolResults(1));
    }

    expect(detectLoop(history, 10)).toBe(true);
  });

  it("should detect 3-cycle repetition with window size 9", () => {
    // Pattern of 3 tools, repeated 3 times = 9 calls
    const history: Turn[] = [];
    for (let i = 0; i < 3; i++) {
      history.push(assistantWithTools("read_file"));
      history.push(toolResults(1));
      history.push(assistantWithTools("edit_file"));
      history.push(toolResults(1));
      history.push(assistantWithTools("shell"));
      history.push(toolResults(1));
    }

    expect(detectLoop(history, 9)).toBe(true);
  });

  it("should NOT detect loop for non-repeating patterns", () => {
    const history: Turn[] = [];
    const tools = [
      "read_file",
      "grep",
      "edit_file",
      "shell",
      "glob",
      "write_file",
      "read_file",
      "grep",
      "shell",
      "edit_file",
    ];
    for (const tool of tools) {
      history.push(assistantWithTools(tool));
      history.push(toolResults(1));
    }

    expect(detectLoop(history, 10)).toBe(false);
  });

  it("should return false when not enough calls", () => {
    const history: Turn[] = [];
    history.push(assistantWithTools("read_file"));
    history.push(toolResults(1));

    expect(detectLoop(history, 10)).toBe(false);
  });

  it("should return false for empty history", () => {
    expect(detectLoop([], 10)).toBe(false);
  });

  it("should use default window size of 10", () => {
    const history: Turn[] = [];
    for (let i = 0; i < 10; i++) {
      history.push(assistantWithTools("read_file"));
      history.push(toolResults(1));
    }

    // Default window size = 10
    expect(detectLoop(history)).toBe(true);
  });

  it("should NOT detect partial patterns that do not fill the window", () => {
    // 7 of the same tool, 3 different - not a full repeating pattern
    const history: Turn[] = [];
    for (let i = 0; i < 7; i++) {
      history.push(assistantWithTools("read_file"));
      history.push(toolResults(1));
    }
    history.push(assistantWithTools("edit_file"));
    history.push(toolResults(1));
    history.push(assistantWithTools("shell"));
    history.push(toolResults(1));
    history.push(assistantWithTools("glob"));
    history.push(toolResults(1));

    expect(detectLoop(history, 10)).toBe(false);
  });
});
