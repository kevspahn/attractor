/**
 * FanInHandler — consolidates results from a preceding parallel node.
 *
 * Reads `parallel.results` from context, ranks candidates, records winner.
 *
 * See spec Section 4.9.
 */

import type { Node, Graph } from "../parser/types.js";
import type { Context } from "../state/context.js";
import type { Outcome } from "../state/outcome.js";
import { StageStatus } from "../state/outcome.js";
import type { Handler } from "./handler.js";

interface CandidateResult {
  id: string;
  outcome: string;
  notes: string;
  score: number;
}

/** Outcome rank: lower is better */
const OUTCOME_RANK: Record<string, number> = {
  success: 0,
  partial_success: 1,
  retry: 2,
  fail: 3,
};

/**
 * Heuristic selection: rank by outcome status, then by score (descending),
 * then by ID (lexical tiebreak).
 */
function heuristicSelect(candidates: CandidateResult[]): CandidateResult {
  const sorted = [...candidates].sort((a, b) => {
    const rankA = OUTCOME_RANK[a.outcome] ?? 3;
    const rankB = OUTCOME_RANK[b.outcome] ?? 3;
    if (rankA !== rankB) return rankA - rankB;
    if (a.score !== b.score) return b.score - a.score; // higher score first
    return a.id.localeCompare(b.id); // lexical tiebreak
  });
  return sorted[0]!;
}

export class FanInHandler implements Handler {
  async execute(
    node: Node,
    context: Context,
    _graph: Graph,
    _logsRoot: string,
  ): Promise<Outcome> {
    // 1. Read parallel results
    const resultsRaw = context.get<string>("parallel.results");
    if (!resultsRaw) {
      return {
        status: StageStatus.FAIL,
        failureReason: "No parallel results to evaluate",
      };
    }

    let candidates: CandidateResult[];
    try {
      candidates = JSON.parse(resultsRaw);
    } catch {
      return {
        status: StageStatus.FAIL,
        failureReason: "Failed to parse parallel.results",
      };
    }

    if (!candidates || candidates.length === 0) {
      return {
        status: StageStatus.FAIL,
        failureReason: "No parallel results to evaluate",
      };
    }

    // Check if all candidates failed
    const allFailed = candidates.every(
      (c) => c.outcome === StageStatus.FAIL,
    );
    if (allFailed) {
      return {
        status: StageStatus.FAIL,
        failureReason: "All parallel candidates failed",
      };
    }

    // 2. Heuristic selection (no LLM-based evaluation for now)
    const best = heuristicSelect(candidates);

    // 3. Record winner in context
    return {
      status: StageStatus.SUCCESS,
      contextUpdates: {
        "parallel.fan_in.best_id": best.id,
        "parallel.fan_in.best_outcome": best.outcome,
      },
      notes: `Selected best candidate: ${best.id}`,
    };
  }
}
