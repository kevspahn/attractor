/**
 * Handler interface — the contract all node handlers implement.
 *
 * See spec Section 4.1.
 */

import type { Node, Graph } from "../parser/types.js";
import type { Context } from "../state/context.js";
import type { Outcome } from "../state/outcome.js";

/**
 * Every node handler implements this interface.
 * The execution engine dispatches to the appropriate handler
 * based on the node's type attribute or shape-based resolution.
 */
export interface Handler {
  /**
   * Execute the handler for the given node.
   *
   * @param node - The parsed Node with all its attributes
   * @param context - The shared key-value Context for the pipeline run
   * @param graph - The full parsed Graph (for reading outgoing edges, etc.)
   * @param logsRoot - Filesystem path for this run's log/artifact directory
   * @returns The result of execution
   */
  execute(
    node: Node,
    context: Context,
    graph: Graph,
    logsRoot: string,
  ): Promise<Outcome>;
}
