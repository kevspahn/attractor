/**
 * ParallelHandler — fans out execution to multiple branches concurrently.
 *
 * Each parallel branch receives an isolated clone of the parent context.
 * The handler waits for all branches (or applies a join policy) before returning.
 *
 * See spec Section 4.8.
 */

import type { Node, Graph, Edge } from "../parser/types.js";
import type { Context } from "../state/context.js";
import type { Outcome } from "../state/outcome.js";
import { StageStatus } from "../state/outcome.js";
import type { Handler } from "./handler.js";

/** The result of a single parallel branch execution. */
export interface BranchResult {
  branchId: string;
  targetNodeId: string;
  outcome: Outcome;
}

/**
 * A function that executes a single branch node and returns its outcome.
 * This allows the parallel handler to delegate actual node execution
 * to the engine, avoiding circular dependencies.
 */
export type BranchExecutor = (
  nodeId: string,
  context: Context,
  graph: Graph,
  logsRoot: string,
) => Promise<Outcome>;

export class ParallelHandler implements Handler {
  private branchExecutor: BranchExecutor | undefined;

  constructor(branchExecutor?: BranchExecutor) {
    this.branchExecutor = branchExecutor;
  }

  /** Set the branch executor (used by the engine after construction). */
  setBranchExecutor(executor: BranchExecutor): void {
    this.branchExecutor = executor;
  }

  async execute(
    node: Node,
    context: Context,
    graph: Graph,
    logsRoot: string,
  ): Promise<Outcome> {
    // 1. Identify fan-out edges
    const branches: Edge[] = graph.edges.filter((e) => e.source === node.id);

    if (branches.length === 0) {
      return {
        status: StageStatus.FAIL,
        failureReason: "No outgoing edges for parallel node",
      };
    }

    // 2. Determine policies from node attributes
    const joinPolicy = node.raw["join_policy"] ?? "wait_all";
    const errorPolicy = node.raw["error_policy"] ?? "continue";
    const maxParallel = parseInt(node.raw["max_parallel"] ?? "4", 10);

    // 3. Execute branches with bounded parallelism
    const results: BranchResult[] = [];

    if (this.branchExecutor) {
      // Execute in batches of maxParallel
      for (let i = 0; i < branches.length; i += maxParallel) {
        const batch = branches.slice(i, i + maxParallel);
        const batchPromises = batch.map(async (edge) => {
          const branchContext = context.clone();
          const outcome = await this.branchExecutor!(
            edge.target,
            branchContext,
            graph,
            logsRoot,
          );
          return {
            branchId: edge.target,
            targetNodeId: edge.target,
            outcome,
          } as BranchResult;
        });

        const batchResults = await Promise.all(batchPromises);

        for (const result of batchResults) {
          results.push(result);

          // Handle fail_fast error policy
          if (
            errorPolicy === "fail_fast" &&
            result.outcome.status === StageStatus.FAIL
          ) {
            break;
          }
        }

        // Check if we should stop (fail_fast triggered)
        if (
          errorPolicy === "fail_fast" &&
          results.some((r) => r.outcome.status === StageStatus.FAIL)
        ) {
          break;
        }
      }
    } else {
      // No executor: simulate success for all branches
      for (const edge of branches) {
        results.push({
          branchId: edge.target,
          targetNodeId: edge.target,
          outcome: { status: StageStatus.SUCCESS, notes: `Simulated: ${edge.target}` },
        });
      }
    }

    // 4. Store results in context for downstream fan-in
    const serializedResults = results.map((r) => ({
      id: r.branchId,
      outcome: r.outcome.status,
      notes: r.outcome.notes ?? "",
      score: 0,
    }));
    context.set("parallel.results", JSON.stringify(serializedResults));

    // 5. Evaluate join policy
    const successCount = results.filter(
      (r) => r.outcome.status === StageStatus.SUCCESS,
    ).length;
    const failCount = results.filter(
      (r) => r.outcome.status === StageStatus.FAIL,
    ).length;

    if (joinPolicy === "wait_all") {
      if (failCount === 0) {
        return {
          status: StageStatus.SUCCESS,
          notes: `All ${results.length} branches succeeded`,
          contextUpdates: {
            "parallel.branch_count": results.length,
            "parallel.success_count": successCount,
          },
        };
      }
      return {
        status: StageStatus.PARTIAL_SUCCESS,
        notes: `${successCount}/${results.length} branches succeeded`,
        contextUpdates: {
          "parallel.branch_count": results.length,
          "parallel.success_count": successCount,
          "parallel.fail_count": failCount,
        },
      };
    }

    if (joinPolicy === "first_success") {
      if (successCount > 0) {
        return {
          status: StageStatus.SUCCESS,
          notes: `First success found among ${results.length} branches`,
          contextUpdates: {
            "parallel.branch_count": results.length,
            "parallel.success_count": successCount,
          },
        };
      }
      return {
        status: StageStatus.FAIL,
        failureReason: "No branches succeeded",
        contextUpdates: {
          "parallel.branch_count": results.length,
          "parallel.fail_count": failCount,
        },
      };
    }

    // Default: success
    return {
      status: StageStatus.SUCCESS,
      notes: `Parallel complete: ${successCount}/${results.length} succeeded`,
      contextUpdates: {
        "parallel.branch_count": results.length,
        "parallel.success_count": successCount,
      },
    };
  }
}
