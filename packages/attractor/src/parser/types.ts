/**
 * Internal representation types for parsed DOT graphs.
 */

/** Graph-level attributes from the spec Section 2.5 */
export interface GraphAttributes {
  goal: string;
  label: string;
  modelStylesheet: string;
  defaultMaxRetry: number;
  retryTarget: string;
  fallbackRetryTarget: string;
  defaultFidelity: string;
  /** Raw key-value pairs for all graph attributes (including custom ones) */
  raw: Record<string, string>;
}

/** A parsed node with all spec-defined attributes (Section 2.6) */
export interface Node {
  id: string;
  label: string;
  shape: string;
  type: string;
  prompt: string;
  maxRetries: number;
  goalGate: boolean;
  retryTarget: string;
  fallbackRetryTarget: string;
  fidelity: string;
  threadId: string;
  className: string;
  timeout: number | undefined;
  llmModel: string;
  llmProvider: string;
  reasoningEffort: string;
  autoStatus: boolean;
  allowPartial: boolean;
  /** Raw key-value pairs for all node attributes (including custom ones) */
  raw: Record<string, string>;
  /** Set of attribute keys that were explicitly set on this node (not from defaults) */
  explicitKeys: Set<string>;
}

/** A parsed edge with all spec-defined attributes (Section 2.7) */
export interface Edge {
  source: string;
  target: string;
  label: string;
  condition: string;
  weight: number;
  fidelity: string;
  threadId: string;
  loopRestart: boolean;
  /** Raw key-value pairs */
  raw: Record<string, string>;
}

/** A parsed subgraph */
export interface Subgraph {
  id: string;
  label: string;
  nodeDefaults: Record<string, string>;
  edgeDefaults: Record<string, string>;
  nodeIds: string[];
}

/** The top-level parsed graph */
export interface Graph {
  id: string;
  attributes: GraphAttributes;
  nodes: Map<string, Node>;
  edges: Edge[];
  subgraphs: Subgraph[];
}

/** Create a default node with the given ID */
export function createDefaultNode(id: string): Node {
  return {
    id,
    label: id,
    shape: "box",
    type: "",
    prompt: "",
    maxRetries: 0,
    goalGate: false,
    retryTarget: "",
    fallbackRetryTarget: "",
    fidelity: "",
    threadId: "",
    className: "",
    timeout: undefined,
    llmModel: "",
    llmProvider: "",
    reasoningEffort: "high",
    autoStatus: false,
    allowPartial: false,
    raw: {},
    explicitKeys: new Set(),
  };
}

/** Create default graph attributes */
export function createDefaultGraphAttributes(): GraphAttributes {
  return {
    goal: "",
    label: "",
    modelStylesheet: "",
    defaultMaxRetry: 50,
    retryTarget: "",
    fallbackRetryTarget: "",
    defaultFidelity: "",
    raw: {},
  };
}

/** Create a default edge */
export function createDefaultEdge(source: string, target: string): Edge {
  return {
    source,
    target,
    label: "",
    condition: "",
    weight: 0,
    fidelity: "",
    threadId: "",
    loopRestart: false,
    raw: {},
  };
}
