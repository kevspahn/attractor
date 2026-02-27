/**
 * Context fidelity management — controls how much prior context is
 * carried into the next node's LLM session.
 *
 * See spec Section 5.4.
 */

import type { Node, Edge, Graph } from "../parser/types.js";
import type { Context } from "../state/context.js";
import type { Outcome } from "../state/outcome.js";

/** Valid fidelity mode values. */
export type FidelityMode =
  | "full"
  | "truncate"
  | "compact"
  | "summary:low"
  | "summary:medium"
  | "summary:high";

/** Approximate token budgets for summary modes. */
export const FIDELITY_TOKEN_BUDGETS: Record<string, number> = {
  "summary:low": 600,
  "summary:medium": 1500,
  "summary:high": 3000,
};

/**
 * Resolve the fidelity mode for a target node.
 *
 * Precedence (highest to lowest):
 * 1. Edge fidelity attribute (on the incoming edge)
 * 2. Target node fidelity attribute
 * 3. Graph default_fidelity attribute
 * 4. Default: compact
 */
export function resolveFidelity(
  targetNode: Node,
  incomingEdge: Edge | undefined,
  graph: Graph,
): FidelityMode {
  // 1. Edge fidelity
  if (incomingEdge?.fidelity) {
    return incomingEdge.fidelity as FidelityMode;
  }

  // 2. Node fidelity
  if (targetNode.fidelity) {
    return targetNode.fidelity as FidelityMode;
  }

  // 3. Graph default
  if (graph.attributes.defaultFidelity) {
    return graph.attributes.defaultFidelity as FidelityMode;
  }

  // 4. Default
  return "compact";
}

/**
 * Resolve the thread key for full fidelity mode.
 *
 * Thread resolution order:
 * 1. Target node thread_id attribute
 * 2. Edge thread_id attribute
 * 3. Graph-level default thread (not currently supported)
 * 4. Derived class from enclosing subgraph
 * 5. Fallback: previous node ID
 */
export function resolveThreadKey(
  targetNode: Node,
  incomingEdge: Edge | undefined,
  graph: Graph,
  previousNodeId: string,
): string {
  // 1. Node thread_id
  if (targetNode.threadId) {
    return targetNode.threadId;
  }

  // 2. Edge thread_id
  if (incomingEdge?.threadId) {
    return incomingEdge.threadId;
  }

  // 3. Graph-level default thread (check raw attributes)
  const graphDefaultThread = graph.attributes.raw["thread_id"];
  if (graphDefaultThread) {
    return graphDefaultThread;
  }

  // 4. Subgraph class
  for (const subgraph of graph.subgraphs) {
    if (subgraph.nodeIds.includes(targetNode.id) && subgraph.label) {
      // Derive class name from subgraph label
      const className = subgraph.label
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      if (className) return className;
    }
  }

  // 5. Fallback: previous node ID
  return previousNodeId;
}

/**
 * Build a context preamble based on fidelity mode.
 * This creates a summary of the pipeline state for injection into LLM prompts.
 */
export function buildFidelityContext(
  mode: FidelityMode,
  context: Context,
  graph: Graph,
  completedNodes: string[],
  nodeOutcomes: Record<string, Outcome>,
): string {
  switch (mode) {
    case "full":
      // Full mode means reuse the same LLM session — no preamble needed
      return "";

    case "truncate":
      // Minimal: only graph goal and run ID
      return [
        `Goal: ${graph.attributes.goal}`,
        `Run: ${context.getString("run_id", "unknown")}`,
      ].join("\n");

    case "compact": {
      // Structured bullet-point summary
      const lines: string[] = [];
      lines.push(`Goal: ${graph.attributes.goal}`);
      if (completedNodes.length > 0) {
        lines.push(`Completed stages: ${completedNodes.join(", ")}`);
      }
      // Add key context values
      const snapshot = context.snapshot();
      const contextKeys = Object.keys(snapshot).filter(
        (k) => !k.startsWith("internal."),
      );
      if (contextKeys.length > 0) {
        lines.push("Context:");
        for (const key of contextKeys.slice(0, 10)) {
          const val = String(snapshot[key] ?? "");
          lines.push(`  - ${key}: ${val.slice(0, 100)}`);
        }
      }
      return lines.join("\n");
    }

    case "summary:low": {
      const lines: string[] = [];
      lines.push(`Goal: ${graph.attributes.goal}`);
      lines.push(`Stages completed: ${completedNodes.length}`);
      const lastOutcome = completedNodes.length > 0
        ? nodeOutcomes[completedNodes[completedNodes.length - 1]!]
        : undefined;
      if (lastOutcome) {
        lines.push(`Last stage outcome: ${lastOutcome.status}`);
      }
      return lines.join("\n");
    }

    case "summary:medium": {
      const lines: string[] = [];
      lines.push(`Goal: ${graph.attributes.goal}`);
      lines.push(`Stages completed: ${completedNodes.length}`);
      // Recent stage outcomes (last 5)
      const recent = completedNodes.slice(-5);
      if (recent.length > 0) {
        lines.push("Recent stages:");
        for (const nodeId of recent) {
          const outcome = nodeOutcomes[nodeId];
          lines.push(`  - ${nodeId}: ${outcome?.status ?? "unknown"}`);
        }
      }
      // Active context values
      const snapshot = context.snapshot();
      const keys = Object.keys(snapshot).filter(
        (k) => !k.startsWith("internal."),
      );
      if (keys.length > 0) {
        lines.push("Active context:");
        for (const key of keys.slice(0, 5)) {
          lines.push(`  - ${key}: ${String(snapshot[key] ?? "").slice(0, 80)}`);
        }
      }
      return lines.join("\n");
    }

    case "summary:high": {
      const lines: string[] = [];
      lines.push(`Goal: ${graph.attributes.goal}`);
      lines.push(`Total stages completed: ${completedNodes.length}`);
      // All stage outcomes
      if (completedNodes.length > 0) {
        lines.push("Stage history:");
        for (const nodeId of completedNodes) {
          const outcome = nodeOutcomes[nodeId];
          const notes = outcome?.notes ? ` - ${outcome.notes.slice(0, 100)}` : "";
          lines.push(`  - ${nodeId}: ${outcome?.status ?? "unknown"}${notes}`);
        }
      }
      // Comprehensive context
      const snapshot = context.snapshot();
      const keys = Object.keys(snapshot).filter(
        (k) => !k.startsWith("internal."),
      );
      if (keys.length > 0) {
        lines.push("Full context:");
        for (const key of keys) {
          lines.push(`  - ${key}: ${String(snapshot[key] ?? "").slice(0, 150)}`);
        }
      }
      return lines.join("\n");
    }

    default:
      return "";
  }
}
