/**
 * Graph validator — validates parsed graphs against lint rules.
 *
 * See spec Section 7 for full details.
 */

import type { Graph, Node, Edge } from "./parser/types.js";
import { validateConditionSyntax } from "./conditions.js";
import { validateStylesheetSyntax } from "./stylesheet.js";

export const Severity = {
  ERROR: "error",
  WARNING: "warning",
  INFO: "info",
} as const;

export type Severity = (typeof Severity)[keyof typeof Severity];

export interface Diagnostic {
  rule: string;
  severity: Severity;
  message: string;
  nodeId?: string;
  edge?: [string, string];
  fix?: string;
}

export interface LintRule {
  name: string;
  apply(graph: Graph): Diagnostic[];
}

/** Shape-to-handler-type mapping */
const SHAPE_TO_TYPE: Record<string, string> = {
  Mdiamond: "start",
  Msquare: "exit",
  box: "codergen",
  hexagon: "wait.human",
  diamond: "conditional",
  component: "parallel",
  tripleoctagon: "parallel.fan_in",
  parallelogram: "tool",
  house: "stack.manager_loop",
};

/** Known handler types */
const KNOWN_TYPES = new Set([...Object.values(SHAPE_TO_TYPE), "coding_agent"]);

/** Valid fidelity modes */
const VALID_FIDELITY_MODES = new Set([
  "full",
  "truncate",
  "compact",
  "summary:low",
  "summary:medium",
  "summary:high",
]);

// Helper functions

function findStartNodes(graph: Graph): Node[] {
  const startNodes: Node[] = [];
  for (const [, node] of graph.nodes) {
    if (node.shape === "Mdiamond" || node.id === "start" || node.id === "Start") {
      startNodes.push(node);
    }
  }
  return startNodes;
}

function findTerminalNodes(graph: Graph): Node[] {
  const terminalNodes: Node[] = [];
  for (const [, node] of graph.nodes) {
    if (
      node.shape === "Msquare" ||
      node.id === "exit" ||
      node.id === "end" ||
      node.id === "Exit" ||
      node.id === "End"
    ) {
      terminalNodes.push(node);
    }
  }
  return terminalNodes;
}

function getIncomingEdges(graph: Graph, nodeId: string): Edge[] {
  return graph.edges.filter((e) => e.target === nodeId);
}

function getOutgoingEdges(graph: Graph, nodeId: string): Edge[] {
  return graph.edges.filter((e) => e.source === nodeId);
}

function getReachableNodes(graph: Graph, startId: string): Set<string> {
  const visited = new Set<string>();
  const queue = [startId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const edge of graph.edges) {
      if (edge.source === current && !visited.has(edge.target)) {
        queue.push(edge.target);
      }
    }
  }

  return visited;
}

function resolveNodeType(node: Node): string {
  if (node.type) return node.type;
  return SHAPE_TO_TYPE[node.shape] ?? "codergen";
}

// ---------- Built-in lint rules ----------

const startNodeRule: LintRule = {
  name: "start_node",
  apply(graph: Graph): Diagnostic[] {
    const startNodes = findStartNodes(graph);
    if (startNodes.length === 0) {
      return [
        {
          rule: "start_node",
          severity: Severity.ERROR,
          message: "Pipeline must have exactly one start node (shape=Mdiamond)",
          fix: "Add a node with shape=Mdiamond",
        },
      ];
    }
    if (startNodes.length > 1) {
      return [
        {
          rule: "start_node",
          severity: Severity.ERROR,
          message: `Pipeline must have exactly one start node, found ${startNodes.length}: ${startNodes.map((n) => n.id).join(", ")}`,
          fix: "Remove extra start nodes so only one has shape=Mdiamond",
        },
      ];
    }
    return [];
  },
};

const terminalNodeRule: LintRule = {
  name: "terminal_node",
  apply(graph: Graph): Diagnostic[] {
    const terminalNodes = findTerminalNodes(graph);
    if (terminalNodes.length === 0) {
      return [
        {
          rule: "terminal_node",
          severity: Severity.ERROR,
          message: "Pipeline must have at least one terminal node (shape=Msquare)",
          fix: "Add a node with shape=Msquare",
        },
      ];
    }
    return [];
  },
};

const reachabilityRule: LintRule = {
  name: "reachability",
  apply(graph: Graph): Diagnostic[] {
    const startNodes = findStartNodes(graph);
    if (startNodes.length !== 1) return []; // start_node rule handles this

    const reachable = getReachableNodes(graph, startNodes[0]!.id);
    const diagnostics: Diagnostic[] = [];

    for (const [nodeId] of graph.nodes) {
      if (!reachable.has(nodeId)) {
        diagnostics.push({
          rule: "reachability",
          severity: Severity.ERROR,
          message: `Node "${nodeId}" is not reachable from the start node`,
          nodeId,
          fix: "Add an edge path from the start node to this node, or remove it",
        });
      }
    }

    return diagnostics;
  },
};

const edgeTargetExistsRule: LintRule = {
  name: "edge_target_exists",
  apply(graph: Graph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const edge of graph.edges) {
      if (!graph.nodes.has(edge.source)) {
        diagnostics.push({
          rule: "edge_target_exists",
          severity: Severity.ERROR,
          message: `Edge source "${edge.source}" does not reference an existing node`,
          edge: [edge.source, edge.target],
        });
      }
      if (!graph.nodes.has(edge.target)) {
        diagnostics.push({
          rule: "edge_target_exists",
          severity: Severity.ERROR,
          message: `Edge target "${edge.target}" does not reference an existing node`,
          edge: [edge.source, edge.target],
        });
      }
    }
    return diagnostics;
  },
};

const startNoIncomingRule: LintRule = {
  name: "start_no_incoming",
  apply(graph: Graph): Diagnostic[] {
    const startNodes = findStartNodes(graph);
    if (startNodes.length !== 1) return [];
    const startId = startNodes[0]!.id;

    const incoming = getIncomingEdges(graph, startId);
    if (incoming.length > 0) {
      return [
        {
          rule: "start_no_incoming",
          severity: Severity.ERROR,
          message: `Start node "${startId}" must have no incoming edges, but has ${incoming.length}`,
          nodeId: startId,
          fix: "Remove all edges targeting the start node",
        },
      ];
    }
    return [];
  },
};

const exitNoOutgoingRule: LintRule = {
  name: "exit_no_outgoing",
  apply(graph: Graph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const node of findTerminalNodes(graph)) {
      const outgoing = getOutgoingEdges(graph, node.id);
      if (outgoing.length > 0) {
        diagnostics.push({
          rule: "exit_no_outgoing",
          severity: Severity.ERROR,
          message: `Exit node "${node.id}" must have no outgoing edges, but has ${outgoing.length}`,
          nodeId: node.id,
          fix: "Remove all edges originating from the exit node",
        });
      }
    }
    return diagnostics;
  },
};

const conditionSyntaxRule: LintRule = {
  name: "condition_syntax",
  apply(graph: Graph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const edge of graph.edges) {
      if (edge.condition) {
        const error = validateConditionSyntax(edge.condition);
        if (error) {
          diagnostics.push({
            rule: "condition_syntax",
            severity: Severity.ERROR,
            message: `Invalid condition on edge ${edge.source} -> ${edge.target}: ${error}`,
            edge: [edge.source, edge.target],
            fix: "Fix the condition expression syntax",
          });
        }
      }
    }
    return diagnostics;
  },
};

const stylesheetSyntaxRule: LintRule = {
  name: "stylesheet_syntax",
  apply(graph: Graph): Diagnostic[] {
    const stylesheet = graph.attributes.modelStylesheet;
    if (!stylesheet) return [];

    const error = validateStylesheetSyntax(stylesheet);
    if (error) {
      return [
        {
          rule: "stylesheet_syntax",
          severity: Severity.ERROR,
          message: `Invalid model_stylesheet: ${error}`,
          fix: "Fix the stylesheet syntax",
        },
      ];
    }
    return [];
  },
};

const typeKnownRule: LintRule = {
  name: "type_known",
  apply(graph: Graph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const [, node] of graph.nodes) {
      if (node.type && !KNOWN_TYPES.has(node.type)) {
        diagnostics.push({
          rule: "type_known",
          severity: Severity.WARNING,
          message: `Node "${node.id}" has unrecognized type "${node.type}"`,
          nodeId: node.id,
          fix: `Use one of: ${Array.from(KNOWN_TYPES).join(", ")}`,
        });
      }
    }
    return diagnostics;
  },
};

const fidelityValidRule: LintRule = {
  name: "fidelity_valid",
  apply(graph: Graph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Check node fidelity
    for (const [, node] of graph.nodes) {
      if (node.fidelity && !VALID_FIDELITY_MODES.has(node.fidelity)) {
        diagnostics.push({
          rule: "fidelity_valid",
          severity: Severity.WARNING,
          message: `Node "${node.id}" has invalid fidelity mode "${node.fidelity}"`,
          nodeId: node.id,
          fix: `Use one of: ${Array.from(VALID_FIDELITY_MODES).join(", ")}`,
        });
      }
    }

    // Check edge fidelity
    for (const edge of graph.edges) {
      if (edge.fidelity && !VALID_FIDELITY_MODES.has(edge.fidelity)) {
        diagnostics.push({
          rule: "fidelity_valid",
          severity: Severity.WARNING,
          message: `Edge ${edge.source} -> ${edge.target} has invalid fidelity mode "${edge.fidelity}"`,
          edge: [edge.source, edge.target],
          fix: `Use one of: ${Array.from(VALID_FIDELITY_MODES).join(", ")}`,
        });
      }
    }

    // Check graph default fidelity
    if (
      graph.attributes.defaultFidelity &&
      !VALID_FIDELITY_MODES.has(graph.attributes.defaultFidelity)
    ) {
      diagnostics.push({
        rule: "fidelity_valid",
        severity: Severity.WARNING,
        message: `Graph default_fidelity "${graph.attributes.defaultFidelity}" is not a valid fidelity mode`,
        fix: `Use one of: ${Array.from(VALID_FIDELITY_MODES).join(", ")}`,
      });
    }

    return diagnostics;
  },
};

const retryTargetExistsRule: LintRule = {
  name: "retry_target_exists",
  apply(graph: Graph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const [, node] of graph.nodes) {
      if (node.retryTarget && !graph.nodes.has(node.retryTarget)) {
        diagnostics.push({
          rule: "retry_target_exists",
          severity: Severity.WARNING,
          message: `Node "${node.id}" has retry_target "${node.retryTarget}" which does not exist`,
          nodeId: node.id,
          fix: "Reference an existing node ID for retry_target",
        });
      }
      if (node.fallbackRetryTarget && !graph.nodes.has(node.fallbackRetryTarget)) {
        diagnostics.push({
          rule: "retry_target_exists",
          severity: Severity.WARNING,
          message: `Node "${node.id}" has fallback_retry_target "${node.fallbackRetryTarget}" which does not exist`,
          nodeId: node.id,
          fix: "Reference an existing node ID for fallback_retry_target",
        });
      }
    }

    // Check graph-level retry targets
    if (graph.attributes.retryTarget && !graph.nodes.has(graph.attributes.retryTarget)) {
      diagnostics.push({
        rule: "retry_target_exists",
        severity: Severity.WARNING,
        message: `Graph retry_target "${graph.attributes.retryTarget}" does not exist`,
        fix: "Reference an existing node ID for graph retry_target",
      });
    }
    if (
      graph.attributes.fallbackRetryTarget &&
      !graph.nodes.has(graph.attributes.fallbackRetryTarget)
    ) {
      diagnostics.push({
        rule: "retry_target_exists",
        severity: Severity.WARNING,
        message: `Graph fallback_retry_target "${graph.attributes.fallbackRetryTarget}" does not exist`,
        fix: "Reference an existing node ID for graph fallback_retry_target",
      });
    }

    return diagnostics;
  },
};

const goalGateHasRetryRule: LintRule = {
  name: "goal_gate_has_retry",
  apply(graph: Graph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const [, node] of graph.nodes) {
      if (node.goalGate) {
        const hasNodeRetry = node.retryTarget || node.fallbackRetryTarget;
        const hasGraphRetry =
          graph.attributes.retryTarget || graph.attributes.fallbackRetryTarget;

        if (!hasNodeRetry && !hasGraphRetry) {
          diagnostics.push({
            rule: "goal_gate_has_retry",
            severity: Severity.WARNING,
            message: `Goal gate node "${node.id}" has no retry_target or fallback_retry_target (and no graph-level targets)`,
            nodeId: node.id,
            fix: "Add retry_target or fallback_retry_target to the node or graph",
          });
        }
      }
    }
    return diagnostics;
  },
};

const promptOnLlmNodesRule: LintRule = {
  name: "prompt_on_llm_nodes",
  apply(graph: Graph): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const [, node] of graph.nodes) {
      const handlerType = resolveNodeType(node);
      if (handlerType === "codergen") {
        // Check if the node has a prompt or a non-default label
        if (!node.prompt && node.label === node.id) {
          diagnostics.push({
            rule: "prompt_on_llm_nodes",
            severity: Severity.WARNING,
            message: `LLM node "${node.id}" has no prompt or label attribute`,
            nodeId: node.id,
            fix: "Add a prompt or label attribute to guide the LLM",
          });
        }
      }
    }
    return diagnostics;
  },
};

// ---------- Built-in rules collection ----------

const BUILT_IN_RULES: LintRule[] = [
  startNodeRule,
  terminalNodeRule,
  reachabilityRule,
  edgeTargetExistsRule,
  startNoIncomingRule,
  exitNoOutgoingRule,
  conditionSyntaxRule,
  stylesheetSyntaxRule,
  typeKnownRule,
  fidelityValidRule,
  retryTargetExistsRule,
  goalGateHasRetryRule,
  promptOnLlmNodesRule,
];

/**
 * Validate a graph against all lint rules.
 * Returns a list of diagnostics (errors, warnings, info).
 */
export function validate(graph: Graph, extraRules?: LintRule[]): Diagnostic[] {
  const rules = extraRules ? [...BUILT_IN_RULES, ...extraRules] : BUILT_IN_RULES;
  const diagnostics: Diagnostic[] = [];

  for (const rule of rules) {
    diagnostics.push(...rule.apply(graph));
  }

  return diagnostics;
}

/**
 * Validate a graph and throw if any error-severity diagnostics are found.
 * Returns warnings and info diagnostics.
 */
export class ValidationError extends Error {
  constructor(
    public readonly diagnostics: Diagnostic[],
  ) {
    const messages = diagnostics.map((d) => `[${d.rule}] ${d.message}`).join("\n");
    super(`Validation failed:\n${messages}`);
    this.name = "ValidationError";
  }
}

export function validateOrRaise(graph: Graph, extraRules?: LintRule[]): Diagnostic[] {
  const diagnostics = validate(graph, extraRules);
  const errors = diagnostics.filter((d) => d.severity === Severity.ERROR);

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }

  return diagnostics;
}
