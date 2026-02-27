import { describe, it, expect } from "vitest";
import {
  WaitForHumanHandler,
  parseAcceleratorKey,
} from "../../src/handlers/human.js";
import { QueueInterviewer, AnswerValue } from "../../src/interviewer.js";
import { Context } from "../../src/state/context.js";
import { StageStatus } from "../../src/state/outcome.js";
import {
  createDefaultNode,
  createDefaultEdge,
  createDefaultGraphAttributes,
} from "../../src/parser/types.js";
import type { Graph } from "../../src/parser/types.js";

function makeGraph(nodes: string[], edges: Array<[string, string, string?]>): Graph {
  const graph: Graph = {
    id: "test",
    attributes: createDefaultGraphAttributes(),
    nodes: new Map(),
    edges: [],
    subgraphs: [],
  };

  for (const id of nodes) {
    graph.nodes.set(id, createDefaultNode(id));
  }

  for (const [source, target, label] of edges) {
    const edge = createDefaultEdge(source, target);
    if (label) edge.label = label;
    graph.edges.push(edge);
  }

  return graph;
}

describe("parseAcceleratorKey", () => {
  it("extracts key from [K] Label pattern", () => {
    expect(parseAcceleratorKey("[Y] Yes, deploy")).toBe("Y");
    expect(parseAcceleratorKey("[A] Approve")).toBe("A");
    expect(parseAcceleratorKey("[f] Fix")).toBe("F");
  });

  it("extracts key from K) Label pattern", () => {
    expect(parseAcceleratorKey("Y) Yes, deploy")).toBe("Y");
    expect(parseAcceleratorKey("A) Approve")).toBe("A");
  });

  it("extracts key from K - Label pattern", () => {
    expect(parseAcceleratorKey("Y - Yes, deploy")).toBe("Y");
    expect(parseAcceleratorKey("A - Approve")).toBe("A");
  });

  it("uses first character as fallback", () => {
    expect(parseAcceleratorKey("Yes, deploy")).toBe("Y");
    expect(parseAcceleratorKey("no")).toBe("N");
  });

  it("returns empty string for empty label", () => {
    expect(parseAcceleratorKey("")).toBe("");
  });
});

describe("WaitForHumanHandler", () => {
  it("derives choices from outgoing edges", async () => {
    const graph = makeGraph(
      ["gate", "approve", "reject"],
      [
        ["gate", "approve", "[A] Approve"],
        ["gate", "reject", "[R] Reject"],
      ],
    );

    const interviewer = new QueueInterviewer([{ value: "A" }]);
    const handler = new WaitForHumanHandler(interviewer);
    const node = graph.nodes.get("gate")!;
    node.label = "Review Changes";
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.status).toBe(StageStatus.SUCCESS);
    expect(outcome.suggestedNextIds).toEqual(["approve"]);
    expect(outcome.contextUpdates?.["human.gate.selected"]).toBe("A");
    expect(outcome.contextUpdates?.["human.gate.label"]).toBe("[A] Approve");
  });

  it("uses target node ID as label when edge has no label", async () => {
    const graph = makeGraph(
      ["gate", "next_step"],
      [["gate", "next_step"]],
    );

    const interviewer = new QueueInterviewer([{ value: "N" }]);
    const handler = new WaitForHumanHandler(interviewer);
    const node = graph.nodes.get("gate")!;
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.status).toBe(StageStatus.SUCCESS);
    expect(outcome.suggestedNextIds).toEqual(["next_step"]);
  });

  it("fails when no outgoing edges", async () => {
    const graph = makeGraph(["gate"], []);

    const interviewer = new QueueInterviewer([]);
    const handler = new WaitForHumanHandler(interviewer);
    const node = graph.nodes.get("gate")!;
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("No outgoing edges");
  });

  it("handles timeout with default choice", async () => {
    const graph = makeGraph(
      ["gate", "approve", "reject"],
      [
        ["gate", "approve", "[A] Approve"],
        ["gate", "reject", "[R] Reject"],
      ],
    );

    const interviewer = new QueueInterviewer([
      { value: AnswerValue.TIMEOUT },
    ]);
    const handler = new WaitForHumanHandler(interviewer);
    const node = graph.nodes.get("gate")!;
    node.raw["human.default_choice"] = "approve";
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.status).toBe(StageStatus.SUCCESS);
    expect(outcome.suggestedNextIds).toEqual(["approve"]);
  });

  it("returns RETRY on timeout with no default choice", async () => {
    const graph = makeGraph(
      ["gate", "approve"],
      [["gate", "approve", "Approve"]],
    );

    const interviewer = new QueueInterviewer([
      { value: AnswerValue.TIMEOUT },
    ]);
    const handler = new WaitForHumanHandler(interviewer);
    const node = graph.nodes.get("gate")!;
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.status).toBe(StageStatus.RETRY);
    expect(outcome.failureReason).toContain("timeout");
  });

  it("returns FAIL when human skips", async () => {
    const graph = makeGraph(
      ["gate", "approve"],
      [["gate", "approve", "Approve"]],
    );

    const interviewer = new QueueInterviewer([
      { value: AnswerValue.SKIPPED },
    ]);
    const handler = new WaitForHumanHandler(interviewer);
    const node = graph.nodes.get("gate")!;
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("skipped");
  });

  it("returns FAIL when answer does not match any choice", async () => {
    const graph = makeGraph(
      ["gate", "approve", "reject"],
      [
        ["gate", "approve", "[A] Approve"],
        ["gate", "reject", "[R] Reject"],
      ],
    );

    const interviewer = new QueueInterviewer([{ value: "Z" }]);
    const handler = new WaitForHumanHandler(interviewer);
    const node = graph.nodes.get("gate")!;
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, "");

    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain('No matching choice for answer "Z"');
  });

  it("returns SKIPPED when queue is empty", async () => {
    const graph = makeGraph(
      ["gate", "approve"],
      [["gate", "approve", "Approve"]],
    );

    const interviewer = new QueueInterviewer([]);
    const handler = new WaitForHumanHandler(interviewer);
    const node = graph.nodes.get("gate")!;
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, "");

    // QueueInterviewer returns SKIPPED when empty
    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toContain("skipped");
  });
});
