/**
 * ToolHandler — executes shell commands from `tool_command` attribute.
 *
 * The tool_command comes from the DOT pipeline definition (not user input),
 * so it's a trusted command string.
 *
 * See spec Section 4.10.
 */

import { execFileSync } from "node:child_process";
import type { Node } from "../parser/types.js";
import type { Handler } from "./handler.js";
import { StageStatus } from "../state/outcome.js";
import type { Outcome } from "../state/outcome.js";

export class ToolHandler implements Handler {
  async execute(node: Node): Promise<Outcome> {
    const command = node.raw["tool_command"] ?? "";
    if (!command) {
      return {
        status: StageStatus.FAIL,
        failureReason: "No tool_command specified",
      };
    }

    try {
      const timeoutMs = node.timeout ?? 30_000;
      // Use shell: true to support pipeline-defined commands with pipes, etc.
      // The command comes from the DOT file definition, not user input.
      const stdout = execFileSync("/bin/sh", ["-c", command], {
        timeout: timeoutMs,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      return {
        status: StageStatus.SUCCESS,
        contextUpdates: { "tool.output": stdout },
        notes: `Tool completed: ${command}`,
      };
    } catch (err) {
      return {
        status: StageStatus.FAIL,
        failureReason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
