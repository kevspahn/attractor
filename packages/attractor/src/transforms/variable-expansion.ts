/**
 * Variable Expansion Transform.
 *
 * Expands $goal in node prompt attributes to the graph-level goal attribute.
 *
 * See spec Section 9.2.
 */

import type { Graph } from "../parser/types.js";
import type { Transform } from "./index.js";

export class VariableExpansionTransform implements Transform {
  name = "variable-expansion";

  apply(graph: Graph): Graph {
    const goal = graph.attributes.goal;

    for (const [, node] of graph.nodes) {
      if (node.prompt && node.prompt.includes("$goal")) {
        node.prompt = node.prompt.replace(/\$goal/g, goal);
      }
    }

    return graph;
  }
}
