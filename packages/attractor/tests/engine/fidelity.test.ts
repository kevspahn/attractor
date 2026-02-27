import { describe, it, expect } from "vitest";
import {
  resolveFidelity,
  resolveThreadKey,
  buildFidelityContext,
} from "../../src/engine/fidelity.js";
import { Context } from "../../src/state/context.js";
import { StageStatus } from "../../src/state/outcome.js";
import type { Outcome } from "../../src/state/outcome.js";
import {
  createDefaultNode,
  createDefaultEdge,
  createDefaultGraphAttributes,
} from "../../src/parser/types.js";
import type { Graph } from "../../src/parser/types.js";

function makeGraph(overrides?: Partial<Graph>): Graph {
  return {
    id: "test",
    attributes: createDefaultGraphAttributes(),
    nodes: new Map(),
    edges: [],
    subgraphs: [],
    ...overrides,
  };
}

describe("resolveFidelity", () => {
  it("uses edge fidelity first (highest precedence)", () => {
    const node = createDefaultNode("task");
    node.fidelity = "compact";
    const edge = createDefaultEdge("prev", "task");
    edge.fidelity = "full";
    const graph = makeGraph();
    graph.attributes.defaultFidelity = "truncate";

    expect(resolveFidelity(node, edge, graph)).toBe("full");
  });

  it("uses node fidelity when no edge fidelity", () => {
    const node = createDefaultNode("task");
    node.fidelity = "summary:high";
    const graph = makeGraph();
    graph.attributes.defaultFidelity = "truncate";

    expect(resolveFidelity(node, undefined, graph)).toBe("summary:high");
  });

  it("uses graph default when no node/edge fidelity", () => {
    const node = createDefaultNode("task");
    const graph = makeGraph();
    graph.attributes.defaultFidelity = "summary:medium";

    expect(resolveFidelity(node, undefined, graph)).toBe("summary:medium");
  });

  it("defaults to compact when nothing is set", () => {
    const node = createDefaultNode("task");
    const graph = makeGraph();

    expect(resolveFidelity(node, undefined, graph)).toBe("compact");
  });
});

describe("resolveThreadKey", () => {
  it("uses node thread_id first", () => {
    const node = createDefaultNode("task");
    node.threadId = "node-thread";
    const edge = createDefaultEdge("prev", "task");
    edge.threadId = "edge-thread";

    expect(resolveThreadKey(node, edge, makeGraph(), "prev")).toBe("node-thread");
  });

  it("uses edge thread_id when no node thread_id", () => {
    const node = createDefaultNode("task");
    const edge = createDefaultEdge("prev", "task");
    edge.threadId = "edge-thread";

    expect(resolveThreadKey(node, edge, makeGraph(), "prev")).toBe("edge-thread");
  });

  it("uses subgraph class when no thread_id set", () => {
    const node = createDefaultNode("task");
    const graph = makeGraph({
      subgraphs: [
        {
          id: "cluster_loop",
          label: "Loop A",
          nodeDefaults: {},
          edgeDefaults: {},
          nodeIds: ["task"],
        },
      ],
    });

    expect(resolveThreadKey(node, undefined, graph, "prev")).toBe("loop-a");
  });

  it("falls back to previous node ID", () => {
    const node = createDefaultNode("task");
    const graph = makeGraph();

    expect(resolveThreadKey(node, undefined, graph, "prev_node")).toBe("prev_node");
  });
});

describe("buildFidelityContext", () => {
  it("returns empty string for full mode", () => {
    const ctx = new Context();
    const graph = makeGraph();

    const result = buildFidelityContext("full", ctx, graph, [], {});
    expect(result).toBe("");
  });

  it("returns minimal context for truncate mode", () => {
    const ctx = new Context();
    const graph = makeGraph();
    graph.attributes.goal = "Build feature X";

    const result = buildFidelityContext("truncate", ctx, graph, [], {});
    expect(result).toContain("Goal: Build feature X");
  });

  it("returns structured summary for compact mode", () => {
    const ctx = new Context();
    ctx.set("outcome", "success");
    const graph = makeGraph();
    graph.attributes.goal = "Build feature X";

    const result = buildFidelityContext(
      "compact",
      ctx,
      graph,
      ["plan", "implement"],
      {},
    );
    expect(result).toContain("Goal: Build feature X");
    expect(result).toContain("Completed stages: plan, implement");
    expect(result).toContain("outcome: success");
  });

  it("returns brief summary for summary:low", () => {
    const ctx = new Context();
    const graph = makeGraph();
    graph.attributes.goal = "Test goal";
    const outcomes: Record<string, Outcome> = {
      plan: { status: StageStatus.SUCCESS },
    };

    const result = buildFidelityContext(
      "summary:low",
      ctx,
      graph,
      ["plan"],
      outcomes,
    );
    expect(result).toContain("Goal: Test goal");
    expect(result).toContain("Stages completed: 1");
    expect(result).toContain("Last stage outcome: success");
  });

  it("returns recent stages for summary:medium", () => {
    const ctx = new Context();
    ctx.set("last_stage", "implement");
    const graph = makeGraph();
    graph.attributes.goal = "Test goal";
    const outcomes: Record<string, Outcome> = {
      plan: { status: StageStatus.SUCCESS },
      implement: { status: StageStatus.SUCCESS },
    };

    const result = buildFidelityContext(
      "summary:medium",
      ctx,
      graph,
      ["plan", "implement"],
      outcomes,
    );
    expect(result).toContain("Goal: Test goal");
    expect(result).toContain("Recent stages:");
    expect(result).toContain("plan: success");
    expect(result).toContain("implement: success");
  });

  it("returns comprehensive context for summary:high", () => {
    const ctx = new Context();
    ctx.set("last_stage", "review");
    ctx.set("outcome", "success");
    const graph = makeGraph();
    graph.attributes.goal = "Full test";
    const outcomes: Record<string, Outcome> = {
      plan: { status: StageStatus.SUCCESS, notes: "Plan created" },
      implement: { status: StageStatus.SUCCESS, notes: "Code written" },
      review: { status: StageStatus.PARTIAL_SUCCESS, notes: "Some issues found" },
    };

    const result = buildFidelityContext(
      "summary:high",
      ctx,
      graph,
      ["plan", "implement", "review"],
      outcomes,
    );
    expect(result).toContain("Goal: Full test");
    expect(result).toContain("Total stages completed: 3");
    expect(result).toContain("Stage history:");
    expect(result).toContain("Plan created");
    expect(result).toContain("Full context:");
  });
});
