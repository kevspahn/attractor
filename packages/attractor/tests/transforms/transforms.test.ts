import { describe, it, expect } from "vitest";
import { VariableExpansionTransform } from "../../src/transforms/variable-expansion.js";
import { StylesheetApplicationTransform } from "../../src/transforms/stylesheet-application.js";
import {
  applyTransforms,
  getBuiltInTransforms,
} from "../../src/transforms/index.js";
import {
  createDefaultNode,
  createDefaultGraphAttributes,
} from "../../src/parser/types.js";
import type { Graph } from "../../src/parser/types.js";

function makeGraph(
  goal: string = "",
  nodeConfigs: Array<{ id: string; prompt?: string; className?: string; shape?: string }> = [],
): Graph {
  const attrs = createDefaultGraphAttributes();
  attrs.goal = goal;
  const nodes = new Map<string, ReturnType<typeof createDefaultNode>>();
  for (const nc of nodeConfigs) {
    const node = createDefaultNode(nc.id);
    if (nc.prompt !== undefined) node.prompt = nc.prompt;
    if (nc.className !== undefined) node.className = nc.className;
    if (nc.shape !== undefined) node.shape = nc.shape;
    nodes.set(nc.id, node);
  }
  return {
    id: "test",
    attributes: attrs,
    nodes,
    edges: [],
    subgraphs: [],
  };
}

describe("VariableExpansionTransform", () => {
  it("expands $goal in node prompts", () => {
    const graph = makeGraph("Build a web app", [
      { id: "plan", prompt: "Plan the implementation for: $goal" },
      { id: "implement", prompt: "Implement: $goal" },
    ]);

    const transform = new VariableExpansionTransform();
    const result = transform.apply(graph);

    expect(result.nodes.get("plan")!.prompt).toBe(
      "Plan the implementation for: Build a web app",
    );
    expect(result.nodes.get("implement")!.prompt).toBe(
      "Implement: Build a web app",
    );
  });

  it("does not modify prompts without $goal", () => {
    const graph = makeGraph("My goal", [
      { id: "task", prompt: "Do something specific" },
    ]);

    const transform = new VariableExpansionTransform();
    const result = transform.apply(graph);

    expect(result.nodes.get("task")!.prompt).toBe("Do something specific");
  });

  it("handles empty goal gracefully", () => {
    const graph = makeGraph("", [
      { id: "task", prompt: "Goal is: $goal" },
    ]);

    const transform = new VariableExpansionTransform();
    const result = transform.apply(graph);

    expect(result.nodes.get("task")!.prompt).toBe("Goal is: ");
  });

  it("expands multiple $goal references in a single prompt", () => {
    const graph = makeGraph("X", [
      { id: "task", prompt: "$goal then $goal" },
    ]);

    const transform = new VariableExpansionTransform();
    const result = transform.apply(graph);

    expect(result.nodes.get("task")!.prompt).toBe("X then X");
  });
});

describe("StylesheetApplicationTransform", () => {
  it("applies stylesheet rules to nodes", () => {
    const graph = makeGraph("", [
      { id: "plan", className: "fast" },
      { id: "review", className: "code" },
    ]);
    graph.attributes.modelStylesheet =
      '.fast { llm_model: gemini-3-flash-preview; } .code { llm_model: claude-opus-4-6; llm_provider: anthropic; }';

    const transform = new StylesheetApplicationTransform();
    const result = transform.apply(graph);

    expect(result.nodes.get("plan")!.llmModel).toBe("gemini-3-flash-preview");
    expect(result.nodes.get("review")!.llmModel).toBe("claude-opus-4-6");
    expect(result.nodes.get("review")!.llmProvider).toBe("anthropic");
  });

  it("does not override explicit node attributes", () => {
    const graph = makeGraph("", [
      { id: "task", className: "fast" },
    ]);
    const node = graph.nodes.get("task")!;
    node.llmModel = "my-model";
    node.explicitKeys.add("llm_model");

    graph.attributes.modelStylesheet =
      '.fast { llm_model: gemini-3-flash-preview; }';

    const transform = new StylesheetApplicationTransform();
    const result = transform.apply(graph);

    expect(result.nodes.get("task")!.llmModel).toBe("my-model");
  });

  it("does nothing when no stylesheet defined", () => {
    const graph = makeGraph("", [{ id: "task" }]);

    const transform = new StylesheetApplicationTransform();
    const result = transform.apply(graph);

    expect(result.nodes.get("task")!.llmModel).toBe("");
  });
});

describe("applyTransforms", () => {
  it("applies multiple transforms in order", () => {
    const graph = makeGraph("Build X", [
      { id: "task", prompt: "Work on $goal", className: "fast" },
    ]);
    graph.attributes.modelStylesheet =
      '.fast { llm_model: gemini-3-flash-preview; }';

    const transforms = getBuiltInTransforms();
    const result = applyTransforms(graph, transforms);

    // Variable expansion should have run first
    expect(result.nodes.get("task")!.prompt).toBe("Work on Build X");
    // Stylesheet should have run second
    expect(result.nodes.get("task")!.llmModel).toBe("gemini-3-flash-preview");
  });
});
