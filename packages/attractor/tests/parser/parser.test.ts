import { describe, it, expect } from "vitest";
import { parseDot, deriveClassName, ParseError } from "../../src/parser/parser.js";

describe("parseDot", () => {
  it("parses a simple digraph with nodes and edges", () => {
    const graph = parseDot(`
      digraph Test {
        A [label="Node A"]
        B [label="Node B"]
        A -> B
      }
    `);
    expect(graph.id).toBe("Test");
    expect(graph.nodes.size).toBe(2);
    expect(graph.nodes.get("A")!.label).toBe("Node A");
    expect(graph.nodes.get("B")!.label).toBe("Node B");
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]!.source).toBe("A");
    expect(graph.edges[0]!.target).toBe("B");
  });

  it("parses graph-level attributes", () => {
    const graph = parseDot(`
      digraph Pipeline {
        graph [goal="Build feature", label="My Pipeline"]
      }
    `);
    expect(graph.attributes.goal).toBe("Build feature");
    expect(graph.attributes.label).toBe("My Pipeline");
  });

  it("parses top-level key=value graph attributes", () => {
    const graph = parseDot(`
      digraph Pipeline {
        rankdir=LR
      }
    `);
    expect(graph.attributes.raw["rankdir"]).toBe("LR");
  });

  it("parses node attributes", () => {
    const graph = parseDot(`
      digraph Test {
        start [shape=Mdiamond, label="Start"]
        task [shape=box, prompt="Do something", max_retries=3, goal_gate=true, timeout="900s"]
      }
    `);
    const start = graph.nodes.get("start")!;
    expect(start.shape).toBe("Mdiamond");
    expect(start.label).toBe("Start");

    const task = graph.nodes.get("task")!;
    expect(task.shape).toBe("box");
    expect(task.prompt).toBe("Do something");
    expect(task.maxRetries).toBe(3);
    expect(task.goalGate).toBe(true);
    expect(task.timeout).toBe(900_000);
  });

  it("parses edge attributes", () => {
    const graph = parseDot(`
      digraph Test {
        A -> B [label="next", condition="outcome=success", weight=5]
      }
    `);
    const edge = graph.edges[0]!;
    expect(edge.label).toBe("next");
    expect(edge.condition).toBe("outcome=success");
    expect(edge.weight).toBe(5);
  });

  it("parses chained edges A -> B -> C", () => {
    const graph = parseDot(`
      digraph Test {
        A -> B -> C [label="chain"]
      }
    `);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]!.source).toBe("A");
    expect(graph.edges[0]!.target).toBe("B");
    expect(graph.edges[0]!.label).toBe("chain");
    expect(graph.edges[1]!.source).toBe("B");
    expect(graph.edges[1]!.target).toBe("C");
    expect(graph.edges[1]!.label).toBe("chain");
  });

  it("applies node default blocks", () => {
    const graph = parseDot(`
      digraph Test {
        node [shape=box, timeout="900s"]
        A [label="Node A"]
        B [label="Node B"]
      }
    `);
    expect(graph.nodes.get("A")!.shape).toBe("box");
    expect(graph.nodes.get("A")!.timeout).toBe(900_000);
    expect(graph.nodes.get("B")!.shape).toBe("box");
  });

  it("explicit attributes override defaults", () => {
    const graph = parseDot(`
      digraph Test {
        node [shape=box, timeout="900s"]
        A [label="Node A", timeout="1800s"]
      }
    `);
    expect(graph.nodes.get("A")!.timeout).toBe(1_800_000);
    expect(graph.nodes.get("A")!.shape).toBe("box");
  });

  it("applies edge default blocks", () => {
    const graph = parseDot(`
      digraph Test {
        edge [weight=10]
        A -> B
        C -> D [weight=5]
      }
    `);
    expect(graph.edges[0]!.weight).toBe(10);
    expect(graph.edges[1]!.weight).toBe(5);
  });

  it("parses subgraphs", () => {
    const graph = parseDot(`
      digraph Test {
        subgraph cluster_loop {
          node [thread_id="loop-a"]
          Plan [label="Plan next step"]
          Implement [label="Implement"]
        }
      }
    `);
    expect(graph.subgraphs).toHaveLength(1);
    expect(graph.subgraphs[0]!.id).toBe("cluster_loop");
    expect(graph.nodes.get("Plan")!.threadId).toBe("loop-a");
    expect(graph.nodes.get("Implement")!.threadId).toBe("loop-a");
  });

  it("creates nodes implicitly from edge declarations", () => {
    const graph = parseDot(`
      digraph Test {
        A -> B -> C
      }
    `);
    expect(graph.nodes.size).toBe(3);
    expect(graph.nodes.has("A")).toBe(true);
    expect(graph.nodes.has("B")).toBe(true);
    expect(graph.nodes.has("C")).toBe(true);
  });

  it("handles optional semicolons", () => {
    const graph = parseDot(`
      digraph Test {
        A [label="A"];
        B [label="B"];
        A -> B;
      }
    `);
    expect(graph.nodes.size).toBe(2);
    expect(graph.edges).toHaveLength(1);
  });

  it("handles comments in DOT source", () => {
    const graph = parseDot(`
      // This is a comment
      digraph Test {
        /* Block comment */
        A [label="A"]
        // Another comment
        B [label="B"]
        A -> B
      }
    `);
    expect(graph.nodes.size).toBe(2);
    expect(graph.edges).toHaveLength(1);
  });

  it("default node label is node ID", () => {
    const graph = parseDot(`
      digraph Test {
        my_node
      }
    `);
    expect(graph.nodes.get("my_node")!.label).toBe("my_node");
  });

  it("default node shape is box", () => {
    const graph = parseDot(`
      digraph Test {
        my_node
      }
    `);
    expect(graph.nodes.get("my_node")!.shape).toBe("box");
  });

  it("parses a complete pipeline example", () => {
    const graph = parseDot(`
      digraph Pipeline {
        graph [goal="Implement and validate a feature"]
        rankdir=LR
        node [shape=box, timeout="900s"]

        start     [shape=Mdiamond, label="Start"]
        exit      [shape=Msquare, label="Exit"]
        plan      [label="Plan", prompt="Plan the implementation"]
        implement [label="Implement", prompt="Implement the plan"]
        validate  [label="Validate", prompt="Run tests"]
        gate      [shape=diamond, label="Tests passing?"]

        start -> plan -> implement -> validate -> gate
        gate -> exit      [label="Yes", condition="outcome=success"]
        gate -> implement [label="No", condition="outcome!=success"]
      }
    `);

    expect(graph.id).toBe("Pipeline");
    expect(graph.attributes.goal).toBe("Implement and validate a feature");
    expect(graph.nodes.size).toBe(6);
    // 4 chained edges + 2 conditional = 6 total
    expect(graph.edges).toHaveLength(6);

    const start = graph.nodes.get("start")!;
    expect(start.shape).toBe("Mdiamond");

    const exit = graph.nodes.get("exit")!;
    expect(exit.shape).toBe("Msquare");

    const gate = graph.nodes.get("gate")!;
    expect(gate.shape).toBe("diamond");

    // Nodes get defaults from node [shape=box, timeout="900s"]
    const plan = graph.nodes.get("plan")!;
    expect(plan.timeout).toBe(900_000);
  });

  it("parses the model_stylesheet attribute", () => {
    const graph = parseDot(`
      digraph Test {
        graph [model_stylesheet="* { llm_model: claude-sonnet-4-5; }"]
      }
    `);
    expect(graph.attributes.modelStylesheet).toBe("* { llm_model: claude-sonnet-4-5; }");
  });

  it("parses boolean node attributes", () => {
    const graph = parseDot(`
      digraph Test {
        A [auto_status=true, allow_partial=false]
      }
    `);
    expect(graph.nodes.get("A")!.autoStatus).toBe(true);
    expect(graph.nodes.get("A")!.allowPartial).toBe(false);
  });

  it("parses edge loop_restart attribute", () => {
    const graph = parseDot(`
      digraph Test {
        A -> B [loop_restart=true]
      }
    `);
    expect(graph.edges[0]!.loopRestart).toBe(true);
  });

  it("tracks explicit keys on nodes", () => {
    const graph = parseDot(`
      digraph Test {
        node [shape=box]
        A [label="My Node"]
      }
    `);
    const node = graph.nodes.get("A")!;
    expect(node.explicitKeys.has("label")).toBe(true);
    expect(node.explicitKeys.has("shape")).toBe(false); // from defaults
  });

  it("parses class attribute", () => {
    const graph = parseDot(`
      digraph Test {
        A [class="code,critical"]
      }
    `);
    expect(graph.nodes.get("A")!.className).toBe("code,critical");
  });

  it("parses graph default_max_retry", () => {
    const graph = parseDot(`
      digraph Test {
        graph [default_max_retry=10]
      }
    `);
    expect(graph.attributes.defaultMaxRetry).toBe(10);
  });

  it("throws on non-digraph input", () => {
    expect(() => parseDot("graph Test { }")).toThrow(ParseError);
  });

  it("throws on missing graph ID", () => {
    expect(() => parseDot("digraph { }")).toThrow(ParseError);
  });

  it("captures subgraph label and derives class for contained nodes", () => {
    const graph = parseDot(`
      digraph Test {
        subgraph cluster_loop {
          label = "Loop A"
          node [thread_id="loop-a"]
          Plan [label="Plan next step"]
          Implement [label="Implement"]
        }
      }
    `);
    expect(graph.subgraphs).toHaveLength(1);
    expect(graph.subgraphs[0]!.label).toBe("Loop A");
    // Nodes should have derived class "loop-a"
    expect(graph.nodes.get("Plan")!.className).toBe("loop-a");
    expect(graph.nodes.get("Implement")!.className).toBe("loop-a");
  });

  it("does not override explicit class with subgraph-derived class", () => {
    const graph = parseDot(`
      digraph Test {
        subgraph cluster_loop {
          label = "Loop A"
          Plan [label="Plan", class="custom"]
          Implement [label="Implement"]
        }
      }
    `);
    // Explicit class should not be overridden
    expect(graph.nodes.get("Plan")!.className).toBe("custom");
    // Non-explicit should get derived class
    expect(graph.nodes.get("Implement")!.className).toBe("loop-a");
  });

  it("does not pollute graph-level label with subgraph label", () => {
    const graph = parseDot(`
      digraph Test {
        graph [label="Pipeline Label"]
        subgraph cluster_loop {
          label = "Loop A"
          A [label="A"]
        }
      }
    `);
    // Graph-level label should remain unchanged
    expect(graph.attributes.label).toBe("Pipeline Label");
    expect(graph.subgraphs[0]!.label).toBe("Loop A");
  });
});

describe("deriveClassName", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(deriveClassName("Loop A")).toBe("loop-a");
  });

  it("strips non-alphanumeric characters except hyphens", () => {
    expect(deriveClassName("My Loop (v2)")).toBe("my-loop-v2");
  });

  it("handles simple labels", () => {
    expect(deriveClassName("fast")).toBe("fast");
  });

  it("handles empty string", () => {
    expect(deriveClassName("")).toBe("");
  });
});
