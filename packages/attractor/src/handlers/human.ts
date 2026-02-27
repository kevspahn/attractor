/**
 * WaitForHumanHandler — blocks until a human selects an option.
 *
 * Derives choices from outgoing edges, parses accelerator keys,
 * presents via interviewer, and returns Outcome with suggestedNextIds.
 *
 * See spec Section 4.6.
 */

import type { Node, Graph } from "../parser/types.js";
import type { Context } from "../state/context.js";
import type { Outcome } from "../state/outcome.js";
import { StageStatus } from "../state/outcome.js";
import type { Handler } from "./handler.js";
import type { Interviewer, Option, Question } from "../interviewer.js";
import { QuestionType, AnswerValue } from "../interviewer.js";

interface Choice {
  key: string;
  label: string;
  to: string;
}

/**
 * Parse accelerator key from an edge label.
 *
 * Supported patterns (spec Section 4.6):
 * - `[K] Label` -> K
 * - `K) Label` -> K
 * - `K - Label` -> K
 * - First character of label as fallback
 */
export function parseAcceleratorKey(label: string): string {
  if (!label) return "";

  // Pattern: [K] Label
  const bracketMatch = label.match(/^\[([A-Za-z0-9])\]\s*/);
  if (bracketMatch) return bracketMatch[1]!.toUpperCase();

  // Pattern: K) Label
  const parenMatch = label.match(/^([A-Za-z0-9])\)\s*/);
  if (parenMatch) return parenMatch[1]!.toUpperCase();

  // Pattern: K - Label
  const dashMatch = label.match(/^([A-Za-z0-9])\s+-\s+/);
  if (dashMatch) return dashMatch[1]!.toUpperCase();

  // Fallback: first character
  return label[0]!.toUpperCase();
}

export class WaitForHumanHandler implements Handler {
  constructor(private interviewer: Interviewer) {}

  async execute(
    node: Node,
    _context: Context,
    graph: Graph,
    _logsRoot: string,
  ): Promise<Outcome> {
    // 1. Derive choices from outgoing edges
    const edges = graph.edges.filter((e) => e.source === node.id);
    const choices: Choice[] = [];

    for (const edge of edges) {
      const label = edge.label || edge.target;
      const key = parseAcceleratorKey(label);
      choices.push({ key, label, to: edge.target });
    }

    if (choices.length === 0) {
      return {
        status: StageStatus.FAIL,
        failureReason: "No outgoing edges for human gate",
      };
    }

    // 2. Build question
    const options: Option[] = choices.map((c) => ({
      key: c.key,
      label: c.label,
    }));
    const question: Question = {
      text: node.label || "Select an option:",
      type: QuestionType.MULTIPLE_CHOICE,
      options,
      stage: node.id,
    };

    // 3. Present to interviewer
    const answer = await this.interviewer.ask(question);

    // 4. Handle timeout
    if (answer.value === AnswerValue.TIMEOUT) {
      const defaultChoice = node.raw["human.default_choice"];
      if (defaultChoice) {
        // Find choice matching default
        const defaultMatch = choices.find(
          (c) => c.to === defaultChoice || c.key === defaultChoice,
        );
        if (defaultMatch) {
          return {
            status: StageStatus.SUCCESS,
            suggestedNextIds: [defaultMatch.to],
            contextUpdates: {
              "human.gate.selected": defaultMatch.key,
              "human.gate.label": defaultMatch.label,
            },
          };
        }
      }
      return {
        status: StageStatus.RETRY,
        failureReason: "human gate timeout, no default",
      };
    }

    // 5. Handle skip
    if (answer.value === AnswerValue.SKIPPED) {
      return {
        status: StageStatus.FAIL,
        failureReason: "human skipped interaction",
      };
    }

    // 6. Find matching choice
    let selected = choices.find(
      (c) =>
        c.key.toUpperCase() === answer.value.toUpperCase() ||
        c.label === answer.value ||
        c.to === answer.value,
    );

    if (!selected) {
      return {
        status: StageStatus.FAIL,
        failureReason: `No matching choice for answer "${answer.value}"`,
      };
    }

    return {
      status: StageStatus.SUCCESS,
      suggestedNextIds: [selected.to],
      contextUpdates: {
        "human.gate.selected": selected.key,
        "human.gate.label": selected.label,
      },
    };
  }
}
