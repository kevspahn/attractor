import { describe, it, expect } from "vitest";
import { ParallelHandler } from "../../src/handlers/parallel.js";
import { FanInHandler } from "../../src/handlers/fan-in.js";
import { Context } from "../../src/state/context.js";
import { StageStatus } from "../../src/state/outcome.js";
import type { Outcome } from "../../src/state/outcome.js";
import {
  createDefaultNode,
  createDefaultEdge,
  createDefaultGraphAttributes,
} from "../../src/parser/types.js";
import type { Graph } from "../../src/parser/types.js";

function makeGraph(
  nodeIds: string[],
  edges: Array<[string, string]>,
): Graph {
  const graph: Graph = {
    id: "test",
    attributes: createDefaultGraphAttributes(),
    nodes: new Map(),
    edges: [],
    subgraphs: [],
  };
  for (const id of nodeIds) {
    graph.nodes.set(id, createDefaultNode(id));
  }
  for (const [s, t] of edges) {
    graph.edges.push(createDefaultEdge(s, t));
  }
  return graph;
}

describe("ParallelHandler", () => {
  it("simulates success for all branches when no executor provided", async () => {
    const graph = makeGraph(
      ["parallel_node", "branch_a", "branch_b"],
      [
        ["parallel_node", "branch_a"],
        ["parallel_node", "branch_b"],
      ],
    );

    const handler = new ParallelHandler();
    const node = graph.nodes.get("parallel_node")!;
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.status).toBe(StageStatus.SUCCESS);
    expect(outcome.contextUpdates?.["parallel.branch_count"]).toBe(2);
    expect(outcome.contextUpdates?.["parallel.success_count"]).toBe(2);

    // Results should be stored in context
    const results = JSON.parse(ctx.getString("parallel.results"));
    expect(results).toHaveLength(2);
  });

  it("executes branches with mock executor", async () => {
    const graph = makeGraph(
      ["pnode", "b1", "b2"],
      [
        ["pnode", "b1"],
        ["pnode", "b2"],
      ],
    );

    const executor = async (
      nodeId: string,
    ): Promise<Outcome> => {
      return { status: StageStatus.SUCCESS, notes: `Done: ${nodeId}` };
    };

    const handler = new ParallelHandler(executor);
    const node = graph.nodes.get("pnode")!;
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.status).toBe(StageStatus.SUCCESS);
  });

  it("returns PARTIAL_SUCCESS when some branches fail (wait_all)", async () => {
    const graph = makeGraph(
      ["pnode", "b1", "b2"],
      [
        ["pnode", "b1"],
        ["pnode", "b2"],
      ],
    );

    let callCount = 0;
    const executor = async (): Promise<Outcome> => {
      callCount++;
      if (callCount === 1) {
        return { status: StageStatus.SUCCESS };
      }
      return { status: StageStatus.FAIL, failureReason: "branch failed" };
    };

    const handler = new ParallelHandler(executor);
    const node = graph.nodes.get("pnode")!;
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.status).toBe(StageStatus.PARTIAL_SUCCESS);
  });

  it("returns SUCCESS for first_success when at least one branch succeeds", async () => {
    const graph = makeGraph(
      ["pnode", "b1", "b2"],
      [
        ["pnode", "b1"],
        ["pnode", "b2"],
      ],
    );

    let callCount = 0;
    const executor = async (): Promise<Outcome> => {
      callCount++;
      if (callCount === 1) {
        return { status: StageStatus.FAIL };
      }
      return { status: StageStatus.SUCCESS };
    };

    const handler = new ParallelHandler(executor);
    const node = graph.nodes.get("pnode")!;
    node.raw["join_policy"] = "first_success";
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.status).toBe(StageStatus.SUCCESS);
  });

  it("returns FAIL for first_success when all branches fail", async () => {
    const graph = makeGraph(
      ["pnode", "b1", "b2"],
      [
        ["pnode", "b1"],
        ["pnode", "b2"],
      ],
    );

    const executor = async (): Promise<Outcome> => {
      return { status: StageStatus.FAIL };
    };

    const handler = new ParallelHandler(executor);
    const node = graph.nodes.get("pnode")!;
    node.raw["join_policy"] = "first_success";
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.status).toBe(StageStatus.FAIL);
  });

  it("fails when no outgoing edges", async () => {
    const graph = makeGraph(["pnode"], []);

    const handler = new ParallelHandler();
    const node = graph.nodes.get("pnode")!;
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("No outgoing edges");
  });
});

describe("FanInHandler", () => {
  it("selects best candidate by outcome rank", async () => {
    const graph = makeGraph(["fan_in"], []);
    const handler = new FanInHandler();
    const node = graph.nodes.get("fan_in")!;
    const ctx = new Context();

    const results = [
      { id: "b1", outcome: "fail", notes: "", score: 0 },
      { id: "b2", outcome: "success", notes: "", score: 0 },
      { id: "b3", outcome: "partial_success", notes: "", score: 0 },
    ];
    ctx.set("parallel.results", JSON.stringify(results));

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.status).toBe(StageStatus.SUCCESS);
    expect(outcome.contextUpdates?.["parallel.fan_in.best_id"]).toBe("b2");
    expect(outcome.contextUpdates?.["parallel.fan_in.best_outcome"]).toBe(
      "success",
    );
  });

  it("uses score as tiebreaker for equal outcomes", async () => {
    const graph = makeGraph(["fan_in"], []);
    const handler = new FanInHandler();
    const node = graph.nodes.get("fan_in")!;
    const ctx = new Context();

    const results = [
      { id: "b1", outcome: "success", notes: "", score: 5 },
      { id: "b2", outcome: "success", notes: "", score: 10 },
    ];
    ctx.set("parallel.results", JSON.stringify(results));

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.contextUpdates?.["parallel.fan_in.best_id"]).toBe("b2");
  });

  it("uses lexical tiebreak when outcomes and scores are equal", async () => {
    const graph = makeGraph(["fan_in"], []);
    const handler = new FanInHandler();
    const node = graph.nodes.get("fan_in")!;
    const ctx = new Context();

    const results = [
      { id: "b_beta", outcome: "success", notes: "", score: 0 },
      { id: "b_alpha", outcome: "success", notes: "", score: 0 },
    ];
    ctx.set("parallel.results", JSON.stringify(results));

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.contextUpdates?.["parallel.fan_in.best_id"]).toBe("b_alpha");
  });

  it("fails when no parallel results in context", async () => {
    const graph = makeGraph(["fan_in"], []);
    const handler = new FanInHandler();
    const node = graph.nodes.get("fan_in")!;
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("No parallel results");
  });

  it("fails when all candidates failed", async () => {
    const graph = makeGraph(["fan_in"], []);
    const handler = new FanInHandler();
    const node = graph.nodes.get("fan_in")!;
    const ctx = new Context();

    const results = [
      { id: "b1", outcome: "fail", notes: "", score: 0 },
      { id: "b2", outcome: "fail", notes: "", score: 0 },
    ];
    ctx.set("parallel.results", JSON.stringify(results));

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("All parallel candidates failed");
  });
});
