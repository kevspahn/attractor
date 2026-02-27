import { describe, it, expect } from "vitest";
import {
  selectEdge,
  normalizeLabel,
} from "../../src/engine/edge-selection.js";
import { Context } from "../../src/state/context.js";
import { StageStatus } from "../../src/state/outcome.js";
import type { Outcome } from "../../src/state/outcome.js";
import {
  createDefaultNode,
  createDefaultEdge,
  createDefaultGraphAttributes,
} from "../../src/parser/types.js";
import type { Graph, Edge } from "../../src/parser/types.js";

function makeGraph(edges: Edge[]): Graph {
  const graph: Graph = {
    id: "test",
    attributes: createDefaultGraphAttributes(),
    nodes: new Map(),
    edges,
    subgraphs: [],
  };
  // Ensure all referenced nodes exist
  for (const edge of edges) {
    if (!graph.nodes.has(edge.source)) {
      graph.nodes.set(edge.source, createDefaultNode(edge.source));
    }
    if (!graph.nodes.has(edge.target)) {
      graph.nodes.set(edge.target, createDefaultNode(edge.target));
    }
  }
  return graph;
}

function edge(
  source: string,
  target: string,
  opts: { label?: string; condition?: string; weight?: number } = {},
): Edge {
  const e = createDefaultEdge(source, target);
  if (opts.label !== undefined) e.label = opts.label;
  if (opts.condition !== undefined) e.condition = opts.condition;
  if (opts.weight !== undefined) e.weight = opts.weight;
  return e;
}

describe("normalizeLabel", () => {
  it("lowercases and trims", () => {
    expect(normalizeLabel("  Hello World  ")).toBe("hello world");
  });

  it("strips [K] prefix", () => {
    expect(normalizeLabel("[Y] Yes, deploy")).toBe("yes, deploy");
  });

  it("strips K) prefix", () => {
    expect(normalizeLabel("Y) Yes, deploy")).toBe("yes, deploy");
  });

  it("strips K - prefix", () => {
    expect(normalizeLabel("Y - Yes, deploy")).toBe("yes, deploy");
  });

  it("does not strip non-matching patterns", () => {
    expect(normalizeLabel("Deploy now")).toBe("deploy now");
  });
});

describe("selectEdge", () => {
  const defaultOutcome: Outcome = { status: StageStatus.SUCCESS };

  describe("Step 1: Condition matching", () => {
    it("selects condition-matching edge over unconditional", () => {
      const graph = makeGraph([
        edge("A", "B", { condition: "outcome=success" }),
        edge("A", "C"), // unconditional
      ]);
      const ctx = new Context();

      const result = selectEdge("A", defaultOutcome, ctx, graph);
      expect(result?.target).toBe("B");
    });

    it("ignores non-matching conditions", () => {
      const graph = makeGraph([
        edge("A", "B", { condition: "outcome=fail" }),
        edge("A", "C"), // unconditional
      ]);
      const ctx = new Context();

      const result = selectEdge("A", defaultOutcome, ctx, graph);
      expect(result?.target).toBe("C");
    });

    it("picks best weight among condition-matched edges", () => {
      const outcome: Outcome = { status: StageStatus.SUCCESS };
      const graph = makeGraph([
        edge("A", "B", { condition: "outcome=success", weight: 1 }),
        edge("A", "C", { condition: "outcome=success", weight: 5 }),
      ]);
      const ctx = new Context();

      const result = selectEdge("A", outcome, ctx, graph);
      expect(result?.target).toBe("C");
    });
  });

  describe("Step 2: Preferred label match", () => {
    it("matches preferred label with normalization", () => {
      const outcome: Outcome = {
        status: StageStatus.SUCCESS,
        preferredLabel: "Deploy",
      };
      const graph = makeGraph([
        edge("A", "B", { label: "Deploy" }),
        edge("A", "C", { label: "Rollback" }),
      ]);
      const ctx = new Context();

      const result = selectEdge("A", outcome, ctx, graph);
      expect(result?.target).toBe("B");
    });

    it("normalizes accelerator keys in label matching", () => {
      const outcome: Outcome = {
        status: StageStatus.SUCCESS,
        preferredLabel: "[Y] Yes, deploy",
      };
      const graph = makeGraph([
        edge("A", "B", { label: "[Y] Yes, deploy" }),
        edge("A", "C", { label: "[N] No" }),
      ]);
      const ctx = new Context();

      const result = selectEdge("A", outcome, ctx, graph);
      expect(result?.target).toBe("B");
    });

    it("condition match takes precedence over preferred label", () => {
      const outcome: Outcome = {
        status: StageStatus.SUCCESS,
        preferredLabel: "B",
      };
      const graph = makeGraph([
        edge("A", "B", { label: "B" }),
        edge("A", "C", { condition: "outcome=success" }),
      ]);
      const ctx = new Context();

      const result = selectEdge("A", outcome, ctx, graph);
      expect(result?.target).toBe("C");
    });
  });

  describe("Step 3: Suggested next IDs", () => {
    it("selects edge matching suggested next ID", () => {
      const outcome: Outcome = {
        status: StageStatus.SUCCESS,
        suggestedNextIds: ["target_b"],
      };
      const graph = makeGraph([
        edge("A", "target_a"),
        edge("A", "target_b"),
      ]);
      const ctx = new Context();

      const result = selectEdge("A", outcome, ctx, graph);
      expect(result?.target).toBe("target_b");
    });

    it("tries suggested IDs in order", () => {
      const outcome: Outcome = {
        status: StageStatus.SUCCESS,
        suggestedNextIds: ["nonexistent", "target_b"],
      };
      const graph = makeGraph([
        edge("A", "target_a"),
        edge("A", "target_b"),
      ]);
      const ctx = new Context();

      const result = selectEdge("A", outcome, ctx, graph);
      expect(result?.target).toBe("target_b");
    });
  });

  describe("Step 4: Highest weight", () => {
    it("selects highest weight among unconditional edges", () => {
      const graph = makeGraph([
        edge("A", "B", { weight: 1 }),
        edge("A", "C", { weight: 10 }),
        edge("A", "D", { weight: 5 }),
      ]);
      const ctx = new Context();

      const result = selectEdge("A", defaultOutcome, ctx, graph);
      expect(result?.target).toBe("C");
    });
  });

  describe("Step 5: Lexical tiebreak", () => {
    it("breaks ties alphabetically by target node ID", () => {
      const graph = makeGraph([
        edge("A", "charlie"),
        edge("A", "alpha"),
        edge("A", "bravo"),
      ]);
      const ctx = new Context();

      const result = selectEdge("A", defaultOutcome, ctx, graph);
      expect(result?.target).toBe("alpha");
    });
  });

  describe("Edge cases", () => {
    it("returns undefined when no outgoing edges", () => {
      const graph = makeGraph([]);
      const ctx = new Context();

      const result = selectEdge("A", defaultOutcome, ctx, graph);
      expect(result).toBeUndefined();
    });

    it("returns single edge when only one exists", () => {
      const graph = makeGraph([edge("A", "B")]);
      const ctx = new Context();

      const result = selectEdge("A", defaultOutcome, ctx, graph);
      expect(result?.target).toBe("B");
    });

    it("falls back to any edge when all have non-matching conditions", () => {
      const graph = makeGraph([
        edge("A", "B", { condition: "outcome=fail" }),
        edge("A", "C", { condition: "outcome=retry" }),
      ]);
      const ctx = new Context();

      // Neither condition matches success, but fallback should return something
      const result = selectEdge("A", defaultOutcome, ctx, graph);
      // Falls back to bestByWeightThenLexical of all edges
      expect(result?.target).toBe("B");
    });
  });
});
