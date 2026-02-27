/**
 * Checkpoint — serializable execution state for crash recovery and resume.
 *
 * See spec Section 5.3.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface Checkpoint {
  /** ISO timestamp when this checkpoint was created */
  timestamp: string;
  /** ID of the last completed node */
  currentNode: string;
  /** IDs of all completed nodes in order */
  completedNodes: string[];
  /** Retry counters per node */
  nodeRetries: Record<string, number>;
  /** Serialized snapshot of context values */
  contextValues: Record<string, unknown>;
  /** Run log entries */
  logs: string[];
}

/** Serializable JSON shape (matches what's written to disk) */
interface CheckpointJSON {
  timestamp: string;
  current_node: string;
  completed_nodes: string[];
  node_retries: Record<string, number>;
  context: Record<string, unknown>;
  logs: string[];
}

/**
 * Create a new checkpoint from current state.
 */
export function createCheckpoint(
  currentNode: string,
  completedNodes: string[],
  nodeRetries: Record<string, number>,
  contextValues: Record<string, unknown>,
  logs: string[],
): Checkpoint {
  return {
    timestamp: new Date().toISOString(),
    currentNode,
    completedNodes: [...completedNodes],
    nodeRetries: { ...nodeRetries },
    contextValues: { ...contextValues },
    logs: [...logs],
  };
}

/**
 * Save checkpoint to a JSON file.
 */
export function saveCheckpoint(checkpoint: Checkpoint, filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const json: CheckpointJSON = {
    timestamp: checkpoint.timestamp,
    current_node: checkpoint.currentNode,
    completed_nodes: checkpoint.completedNodes,
    node_retries: checkpoint.nodeRetries,
    context: checkpoint.contextValues,
    logs: checkpoint.logs,
  };

  fs.writeFileSync(filePath, JSON.stringify(json, null, 2), "utf-8");
}

/**
 * Load checkpoint from a JSON file.
 */
export function loadCheckpoint(filePath: string): Checkpoint {
  const raw = fs.readFileSync(filePath, "utf-8");
  const json = JSON.parse(raw);

  if (!json || typeof json !== "object") {
    throw new Error(`Invalid checkpoint file: ${filePath}`);
  }
  if (
    typeof json.current_node !== "string" ||
    !Array.isArray(json.completed_nodes) ||
    !Array.isArray(json.logs)
  ) {
    throw new Error(`Checkpoint file is missing required fields: ${filePath}`);
  }

  return {
    timestamp: json.timestamp,
    currentNode: json.current_node,
    completedNodes: json.completed_nodes,
    nodeRetries: json.node_retries,
    contextValues: json.context,
    logs: json.logs,
  };
}
