/**
 * Edge selection algorithm — 5-step priority from spec Section 3.3.
 *
 * After a node completes, the engine selects the next edge:
 * 1. Condition-matching edges
 * 2. Preferred label match (normalized comparison)
 * 3. Suggested next IDs
 * 4. Highest weight among unconditional
 * 5. Lexical tiebreak (alphabetical target node ID)
 */

import type { Edge, Graph } from "../parser/types.js";
import type { Outcome } from "../state/outcome.js";
import type { Context } from "../state/context.js";
import { evaluateCondition } from "../conditions.js";

/**
 * Normalize a label for comparison.
 * Lowercase, trim whitespace, strip accelerator prefixes.
 */
export function normalizeLabel(label: string): string {
  let normalized = label.trim().toLowerCase();

  // Strip accelerator prefixes:
  // [K] Label -> Label
  normalized = normalized.replace(/^\[[a-z0-9]\]\s*/, "");
  // K) Label -> Label
  normalized = normalized.replace(/^[a-z0-9]\)\s*/, "");
  // K - Label -> Label
  normalized = normalized.replace(/^[a-z0-9]\s+-\s+/, "");

  return normalized.trim();
}

/**
 * Sort edges by weight (descending) then by target node ID (ascending/lexical).
 * Returns the best edge.
 */
function bestByWeightThenLexical(edges: Edge[]): Edge | undefined {
  if (edges.length === 0) return undefined;

  const sorted = [...edges].sort((a, b) => {
    // Higher weight first
    if (a.weight !== b.weight) return b.weight - a.weight;
    // Lexical tiebreak on target node ID
    return a.target.localeCompare(b.target);
  });

  return sorted[0];
}

/**
 * Select the next edge from a node's outgoing edges.
 *
 * @param nodeId - The current node ID
 * @param outcome - The outcome of the current node's execution
 * @param context - The pipeline context
 * @param graph - The full graph
 * @returns The selected edge, or undefined if no edge is available
 */
export function selectEdge(
  nodeId: string,
  outcome: Outcome,
  context: Context,
  graph: Graph,
): Edge | undefined {
  const edges = graph.edges.filter((e) => e.source === nodeId);
  if (edges.length === 0) return undefined;

  // Step 1: Condition matching
  const conditionMatched: Edge[] = [];
  for (const edge of edges) {
    if (edge.condition) {
      if (evaluateCondition(edge.condition, outcome, context)) {
        conditionMatched.push(edge);
      }
    }
  }
  if (conditionMatched.length > 0) {
    return bestByWeightThenLexical(conditionMatched);
  }

  // Step 2: Preferred label match
  if (outcome.preferredLabel) {
    const normalizedPreferred = normalizeLabel(outcome.preferredLabel);
    for (const edge of edges) {
      if (edge.label && normalizeLabel(edge.label) === normalizedPreferred) {
        return edge;
      }
    }
  }

  // Step 3: Suggested next IDs
  if (outcome.suggestedNextIds && outcome.suggestedNextIds.length > 0) {
    for (const suggestedId of outcome.suggestedNextIds) {
      for (const edge of edges) {
        if (edge.target === suggestedId) {
          return edge;
        }
      }
    }
  }

  // Step 4 & 5: Weight with lexical tiebreak (unconditional edges only)
  const unconditional = edges.filter((e) => !e.condition);
  if (unconditional.length > 0) {
    return bestByWeightThenLexical(unconditional);
  }

  // Fallback: any edge
  return bestByWeightThenLexical(edges);
}
