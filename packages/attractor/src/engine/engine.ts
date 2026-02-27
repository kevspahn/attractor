/**
 * PipelineEngine — the core execution loop.
 *
 * Implements the 5-phase lifecycle from spec Section 3.1:
 * 1. Parse (already done)
 * 2. Validate
 * 3. Initialize
 * 4. Execute
 * 5. Finalize
 *
 * See spec Section 3.2 for the core execution loop pseudocode.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Graph, Node } from "../parser/types.js";
import { Context } from "../state/context.js";
import { StageStatus } from "../state/outcome.js";
import type { Outcome } from "../state/outcome.js";
import { createCheckpoint, saveCheckpoint, loadCheckpoint } from "../state/checkpoint.js";
import type { Checkpoint } from "../state/checkpoint.js";
import { HandlerRegistry } from "../handlers/registry.js";
import { selectEdge } from "./edge-selection.js";
import { buildRetryPolicy, delayForAttempt, sleep } from "./retry.js";
import type { RetryPolicy } from "./retry.js";
import { PipelineEventEmitter } from "./events.js";
import type { PipelineEvent } from "./events.js";

// ---------- Types ----------

export interface EngineConfig {
  /** Handler registry for resolving node handlers. */
  registry: HandlerRegistry;
  /** Event listener callback. */
  onEvent?: (event: PipelineEvent) => void;
  /** Whether to actually sleep during retries. Default true. */
  enableSleep?: boolean;
}

export interface ExecuteOptions {
  /** Root directory for logs and artifacts. */
  logsRoot: string;
  /** Resume from existing checkpoint if present. */
  resume?: boolean;
  /** Initial context values. */
  initialContext?: Record<string, unknown>;
}

export interface PipelineResult {
  /** Overall pipeline outcome status. */
  status: string;
  /** The final outcome of the last node executed. */
  lastOutcome: Outcome;
  /** IDs of completed nodes in order. */
  completedNodes: string[];
  /** The context at the end of execution. */
  context: Context;
  /** All node outcomes keyed by node ID. */
  nodeOutcomes: Record<string, Outcome>;
}

// ---------- Helper Functions ----------

function findStartNode(graph: Graph): Node {
  // 1. Shape-based: Mdiamond
  for (const [, node] of graph.nodes) {
    if (node.shape === "Mdiamond") return node;
  }
  // 2. ID-based: start or Start
  for (const id of ["start", "Start"]) {
    const node = graph.nodes.get(id);
    if (node) return node;
  }
  throw new Error("No start node found (shape=Mdiamond or id=start/Start)");
}

function isTerminal(node: Node): boolean {
  if (node.shape === "Msquare") return true;
  if (
    node.id === "exit" ||
    node.id === "end" ||
    node.id === "Exit" ||
    node.id === "End"
  ) {
    return true;
  }
  return false;
}

function checkGoalGates(
  graph: Graph,
  nodeOutcomes: Record<string, Outcome>,
): { ok: boolean; failedGate: Node | undefined } {
  for (const [nodeId, outcome] of Object.entries(nodeOutcomes)) {
    const node = graph.nodes.get(nodeId);
    if (node?.goalGate) {
      if (
        outcome.status !== StageStatus.SUCCESS &&
        outcome.status !== StageStatus.PARTIAL_SUCCESS
      ) {
        return { ok: false, failedGate: node };
      }
    }
  }
  return { ok: true, failedGate: undefined };
}

function getRetryTarget(
  node: Node,
  graph: Graph,
): string | undefined {
  if (node.retryTarget && graph.nodes.has(node.retryTarget)) {
    return node.retryTarget;
  }
  if (node.fallbackRetryTarget && graph.nodes.has(node.fallbackRetryTarget)) {
    return node.fallbackRetryTarget;
  }
  if (graph.attributes.retryTarget && graph.nodes.has(graph.attributes.retryTarget)) {
    return graph.attributes.retryTarget;
  }
  if (
    graph.attributes.fallbackRetryTarget &&
    graph.nodes.has(graph.attributes.fallbackRetryTarget)
  ) {
    return graph.attributes.fallbackRetryTarget;
  }
  return undefined;
}

// ---------- Engine ----------

export class PipelineEngine {
  private config: EngineConfig;
  private events: PipelineEventEmitter;

  constructor(config: EngineConfig) {
    this.config = config;
    this.events = new PipelineEventEmitter();
    if (config.onEvent) {
      this.events.on(config.onEvent);
    }
  }

  /**
   * Execute a parsed and validated graph.
   */
  async execute(
    graph: Graph,
    options: ExecuteOptions,
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    const logsRoot = options.logsRoot;

    // Ensure logs directory exists
    if (!fs.existsSync(logsRoot)) {
      fs.mkdirSync(logsRoot, { recursive: true });
    }

    // Initialize context
    const context = new Context();
    if (options.initialContext) {
      context.applyUpdates(options.initialContext);
    }
    // Mirror graph attributes into context
    context.set("graph.goal", graph.attributes.goal);

    let completedNodes: string[] = [];
    let nodeOutcomes: Record<string, Outcome> = {};
    let nodeRetries: Record<string, number> = {};
    let stageIndex = 0;

    // Resume from checkpoint if requested
    if (options.resume) {
      const checkpointPath = path.join(logsRoot, "checkpoint.json");
      if (fs.existsSync(checkpointPath)) {
        const checkpoint = loadCheckpoint(checkpointPath);
        context.applyUpdates(checkpoint.contextValues);
        completedNodes = checkpoint.completedNodes;
        nodeRetries = checkpoint.nodeRetries;
        for (const log of checkpoint.logs) {
          context.appendLog(log);
        }
        stageIndex = completedNodes.length;

        // Rebuild nodeOutcomes for completed nodes from their status files
        for (const nodeId of completedNodes) {
          const statusPath = path.join(logsRoot, nodeId, "status.json");
          if (fs.existsSync(statusPath)) {
            try {
              const statusData = JSON.parse(
                fs.readFileSync(statusPath, "utf-8"),
              );
              nodeOutcomes[nodeId] = statusData as Outcome;
            } catch {
              nodeOutcomes[nodeId] = { status: StageStatus.SUCCESS };
            }
          } else {
            nodeOutcomes[nodeId] = { status: StageStatus.SUCCESS };
          }
        }
      }
    }

    // Emit pipeline started
    this.events.emitPipelineStarted(graph.id, logsRoot);

    // Find start node or resume point
    let currentNode: Node;
    if (completedNodes.length > 0 && options.resume) {
      // Resume: find the next node after the last completed one
      const lastCompletedId = completedNodes[completedNodes.length - 1]!;
      const lastOutcome = nodeOutcomes[lastCompletedId] ?? {
        status: StageStatus.SUCCESS,
      };
      const nextEdge = selectEdge(lastCompletedId, lastOutcome, context, graph);
      if (!nextEdge) {
        return this.finalize(
          graph,
          context,
          completedNodes,
          nodeOutcomes,
          lastOutcome,
          startTime,
        );
      }
      const nextNode = graph.nodes.get(nextEdge.target);
      if (!nextNode) {
        throw new Error(`Next node "${nextEdge.target}" not found after resume`);
      }
      currentNode = nextNode;
    } else {
      currentNode = findStartNode(graph);
    }

    let lastOutcome: Outcome = { status: StageStatus.SUCCESS };

    // Main execution loop
    while (true) {
      // Step 1: Check for terminal node
      if (isTerminal(currentNode)) {
        const { ok, failedGate } = checkGoalGates(graph, nodeOutcomes);
        if (!ok && failedGate) {
          const retryTarget = getRetryTarget(failedGate, graph);
          if (retryTarget) {
            const targetNode = graph.nodes.get(retryTarget);
            if (targetNode) {
              currentNode = targetNode;
              continue;
            }
          }
          // No retry target — fail
          const duration = Date.now() - startTime;
          this.events.emitPipelineFailed(
            `Goal gate "${failedGate.id}" unsatisfied and no retry target`,
            duration,
          );
          return {
            status: "fail",
            lastOutcome: {
              status: StageStatus.FAIL,
              failureReason: `Goal gate "${failedGate.id}" unsatisfied and no retry target`,
            },
            completedNodes,
            context,
            nodeOutcomes,
          };
        }
        break; // Pipeline complete
      }

      // Step 2: Execute node handler with retry policy
      context.set("current_node", currentNode.id);
      this.events.emitStageStarted(currentNode.id, stageIndex);
      const stageStart = Date.now();

      const retryPolicy = buildRetryPolicy(
        currentNode.maxRetries,
        graph.attributes.defaultMaxRetry,
      );
      const outcome = await this.executeWithRetry(
        currentNode,
        context,
        graph,
        options.logsRoot,
        retryPolicy,
        nodeRetries,
        stageIndex,
      );

      const stageDuration = Date.now() - stageStart;

      // Step 3: Record completion
      completedNodes.push(currentNode.id);
      nodeOutcomes[currentNode.id] = outcome;
      stageIndex++;

      if (
        outcome.status === StageStatus.SUCCESS ||
        outcome.status === StageStatus.PARTIAL_SUCCESS
      ) {
        this.events.emitStageCompleted(currentNode.id, stageIndex - 1, stageDuration);
      } else {
        this.events.emitStageFailed(
          currentNode.id,
          stageIndex - 1,
          outcome.failureReason ?? "unknown",
          false,
        );
      }

      // Step 4: Apply context updates from outcome
      if (outcome.contextUpdates) {
        context.applyUpdates(outcome.contextUpdates);
      }
      context.set("outcome", outcome.status);
      if (outcome.preferredLabel) {
        context.set("preferred_label", outcome.preferredLabel);
      }

      lastOutcome = outcome;

      // Step 5: Save checkpoint
      const checkpoint = createCheckpoint(
        currentNode.id,
        completedNodes,
        nodeRetries,
        context.snapshot(),
        context.getLogs(),
      );
      saveCheckpoint(checkpoint, path.join(logsRoot, "checkpoint.json"));
      this.events.emitCheckpointSaved(currentNode.id);

      // Step 6: Select next edge
      const nextEdge = selectEdge(currentNode.id, outcome, context, graph);
      if (!nextEdge) {
        if (outcome.status === StageStatus.FAIL) {
          // Try failure routing
          const failureTarget = this.findFailureRoute(currentNode, graph);
          if (failureTarget) {
            const targetNode = graph.nodes.get(failureTarget);
            if (targetNode) {
              currentNode = targetNode;
              continue;
            }
          }
          break; // No failure route — pipeline ends
        }
        break; // No outgoing edge — pipeline ends
      }

      // Step 7: Handle loop_restart
      if (nextEdge.loopRestart) {
        // In a real implementation this would restart the run.
        // For now, just continue to the target node.
        context.appendLog(`loop_restart triggered via edge to ${nextEdge.target}`);
      }

      // Step 8: Advance to next node
      const nextNode = graph.nodes.get(nextEdge.target);
      if (!nextNode) {
        throw new Error(`Next node "${nextEdge.target}" not found in graph`);
      }
      currentNode = nextNode;
    }

    return this.finalize(
      graph,
      context,
      completedNodes,
      nodeOutcomes,
      lastOutcome,
      startTime,
    );
  }

  /**
   * Execute a node handler with retry policy.
   */
  private async executeWithRetry(
    node: Node,
    context: Context,
    graph: Graph,
    logsRoot: string,
    retryPolicy: RetryPolicy,
    nodeRetries: Record<string, number>,
    stageIndex: number,
  ): Promise<Outcome> {
    const handler = this.config.registry.resolve(node);

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
      try {
        const outcome = await handler.execute(node, context, graph, logsRoot);

        // SUCCESS or PARTIAL_SUCCESS: reset retry counter and return
        if (
          outcome.status === StageStatus.SUCCESS ||
          outcome.status === StageStatus.PARTIAL_SUCCESS
        ) {
          delete nodeRetries[node.id];
          return outcome;
        }

        // RETRY: increment counter and retry if within limits
        if (outcome.status === StageStatus.RETRY) {
          if (attempt < retryPolicy.maxAttempts) {
            nodeRetries[node.id] = (nodeRetries[node.id] ?? 0) + 1;
            const delay = delayForAttempt(attempt, retryPolicy.backoff);
            this.events.emitStageRetrying(node.id, stageIndex, attempt, delay);
            if (this.config.enableSleep !== false) {
              await sleep(delay);
            }
            continue;
          }
          // Retries exhausted
          if (node.allowPartial) {
            return {
              status: StageStatus.PARTIAL_SUCCESS,
              notes: "retries exhausted, partial accepted",
            };
          }
          return {
            status: StageStatus.FAIL,
            failureReason: "max retries exceeded",
          };
        }

        // FAIL: return immediately
        if (outcome.status === StageStatus.FAIL) {
          return outcome;
        }

        // SKIPPED or anything else: return as-is
        return outcome;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (
          retryPolicy.shouldRetry(error) &&
          attempt < retryPolicy.maxAttempts
        ) {
          nodeRetries[node.id] = (nodeRetries[node.id] ?? 0) + 1;
          const delay = delayForAttempt(attempt, retryPolicy.backoff);
          this.events.emitStageRetrying(node.id, stageIndex, attempt, delay);
          if (this.config.enableSleep !== false) {
            await sleep(delay);
          }
          continue;
        }
        return {
          status: StageStatus.FAIL,
          failureReason: error.message,
        };
      }
    }

    return {
      status: StageStatus.FAIL,
      failureReason: "max retries exceeded",
    };
  }

  /**
   * Find a failure route for a failed node.
   * 1. Fail edge (condition="outcome=fail")
   * 2. retry_target attribute
   * 3. fallback_retry_target attribute
   */
  private findFailureRoute(node: Node, graph: Graph): string | undefined {
    // Already handled by edge selection with fail conditions
    if (node.retryTarget && graph.nodes.has(node.retryTarget)) {
      return node.retryTarget;
    }
    if (node.fallbackRetryTarget && graph.nodes.has(node.fallbackRetryTarget)) {
      return node.fallbackRetryTarget;
    }
    return undefined;
  }

  /**
   * Finalize the pipeline execution.
   */
  private finalize(
    graph: Graph,
    context: Context,
    completedNodes: string[],
    nodeOutcomes: Record<string, Outcome>,
    lastOutcome: Outcome,
    startTime: number,
  ): PipelineResult {
    const duration = Date.now() - startTime;

    // Check goal gates for final status
    const { ok } = checkGoalGates(graph, nodeOutcomes);

    const finalStatus =
      ok &&
      (lastOutcome.status === StageStatus.SUCCESS ||
        lastOutcome.status === StageStatus.PARTIAL_SUCCESS)
        ? "success"
        : "fail";

    if (finalStatus === "success") {
      this.events.emitPipelineCompleted(duration, 0);
    } else {
      this.events.emitPipelineFailed(
        lastOutcome.failureReason ?? "pipeline failed",
        duration,
      );
    }

    return {
      status: finalStatus,
      lastOutcome,
      completedNodes,
      context,
      nodeOutcomes,
    };
  }
}
