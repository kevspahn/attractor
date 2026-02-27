/**
 * CodergenHandler — default LLM task handler.
 *
 * Reads the node's prompt, expands template variables, calls the LLM backend,
 * writes prompt/response/status to the logs directory, and returns the outcome.
 *
 * See spec Section 4.5.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Node, Graph } from "../parser/types.js";
import type { Context } from "../state/context.js";
import type { Outcome } from "../state/outcome.js";
import { StageStatus } from "../state/outcome.js";
import type { Handler } from "./handler.js";

/**
 * Backend interface for LLM calls.
 * How you implement this is up to you — the pipeline engine only
 * cares that it gets a String or Outcome back.
 */
export interface CodergenBackend {
  run(node: Node, prompt: string, context: Context): Promise<string | Outcome>;
}

/**
 * Expand template variables in a string.
 * Currently only supports $goal.
 */
export function expandVariables(
  text: string,
  graph: Graph,
  _context: Context,
): string {
  return text.replace(/\$goal/g, graph.attributes.goal);
}

/**
 * Write a status.json file for a stage outcome.
 */
function writeStatus(stageDir: string, outcome: Outcome): void {
  const statusPath = path.join(stageDir, "status.json");
  fs.writeFileSync(statusPath, JSON.stringify(outcome, null, 2), "utf-8");
}

export class CodergenHandler implements Handler {
  private backend: CodergenBackend | undefined;

  constructor(backend?: CodergenBackend) {
    this.backend = backend;
  }

  async execute(
    node: Node,
    context: Context,
    graph: Graph,
    logsRoot: string,
  ): Promise<Outcome> {
    // 1. Build prompt
    let prompt = node.prompt;
    if (!prompt) {
      prompt = node.label;
    }
    prompt = expandVariables(prompt, graph, context);

    // 2. Write prompt to logs
    const stageDir = path.join(logsRoot, node.id);
    if (!fs.existsSync(stageDir)) {
      fs.mkdirSync(stageDir, { recursive: true });
    }
    fs.writeFileSync(path.join(stageDir, "prompt.md"), prompt, "utf-8");

    // 3. Call LLM backend
    let responseText: string;

    if (this.backend) {
      try {
        const result = await this.backend.run(node, prompt, context);
        // If the backend returns an Outcome directly, write status and return it
        if (typeof result === "object" && result !== null && "status" in result) {
          writeStatus(stageDir, result as Outcome);
          return result as Outcome;
        }
        responseText = String(result);
      } catch (err) {
        const failOutcome: Outcome = {
          status: StageStatus.FAIL,
          failureReason: err instanceof Error ? err.message : String(err),
        };
        writeStatus(stageDir, failOutcome);
        return failOutcome;
      }
    } else {
      // Simulation mode
      responseText = `[Simulated] Response for stage: ${node.id}`;
    }

    // 4. Write response to logs
    fs.writeFileSync(path.join(stageDir, "response.md"), responseText, "utf-8");

    // 5. Write status and return outcome
    const outcome: Outcome = {
      status: StageStatus.SUCCESS,
      notes: `Stage completed: ${node.id}`,
      contextUpdates: {
        last_stage: node.id,
        last_response: responseText.slice(0, 200),
      },
    };
    writeStatus(stageDir, outcome);
    return outcome;
  }
}
