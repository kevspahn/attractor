import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { PipelineEngine } from "../../src/engine/engine.js";
import type { PipelineEvent } from "../../src/engine/events.js";
import { HandlerRegistry } from "../../src/handlers/registry.js";
import { StartHandler } from "../../src/handlers/start.js";
import { ExitHandler } from "../../src/handlers/exit.js";
import { CodergenHandler } from "../../src/handlers/codergen.js";
import { ConditionalHandler } from "../../src/handlers/conditional.js";
import { StageStatus } from "../../src/state/outcome.js";
import type { Outcome } from "../../src/state/outcome.js";
import type { Handler } from "../../src/handlers/handler.js";
import {
  createDefaultNode,
  createDefaultEdge,
  createDefaultGraphAttributes,
} from "../../src/parser/types.js";
import type { Graph, Node } from "../../src/parser/types.js";

function makeRegistry(): HandlerRegistry {
  const registry = new HandlerRegistry();
  registry.register("start", new StartHandler());
  registry.register("exit", new ExitHandler());
  registry.register("codergen", new CodergenHandler());
  registry.register("conditional", new ConditionalHandler());
  registry.setDefault(new CodergenHandler());
  return registry;
}

function makeGraph(
  nodeConfigs: Array<{ id: string; shape?: string; attrs?: Partial<Node> }>,
  edgeConfigs: Array<{
    source: string;
    target: string;
    label?: string;
    condition?: string;
    weight?: number;
  }>,
  graphAttrs?: Partial<ReturnType<typeof createDefaultGraphAttributes>>,
): Graph {
  const attrs = { ...createDefaultGraphAttributes(), ...graphAttrs };
  const nodes = new Map<string, Node>();
  for (const nc of nodeConfigs) {
    const node = createDefaultNode(nc.id);
    if (nc.shape) node.shape = nc.shape;
    if (nc.attrs) Object.assign(node, nc.attrs);
    nodes.set(nc.id, node);
  }

  const edges = edgeConfigs.map((ec) => {
    const e = createDefaultEdge(ec.source, ec.target);
    if (ec.label) e.label = ec.label;
    if (ec.condition) e.condition = ec.condition;
    if (ec.weight !== undefined) e.weight = ec.weight;
    return e;
  });

  return {
    id: "test_pipeline",
    attributes: attrs,
    nodes,
    edges,
    subgraphs: [],
  };
}

describe("PipelineEngine", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("executes a simple linear pipeline (start -> task -> exit)", async () => {
    const graph = makeGraph(
      [
        { id: "start", shape: "Mdiamond" },
        { id: "task", shape: "box", attrs: { prompt: "Do work" } },
        { id: "exit", shape: "Msquare" },
      ],
      [
        { source: "start", target: "task" },
        { source: "task", target: "exit" },
      ],
      { goal: "Test goal" },
    );

    const registry = makeRegistry();
    const engine = new PipelineEngine({ registry, enableSleep: false });
    const result = await engine.execute(graph, { logsRoot: tmpDir });

    expect(result.status).toBe("success");
    expect(result.completedNodes).toEqual(["start", "task"]);
    expect(result.nodeOutcomes["task"]?.status).toBe("success");

    // Check files were written
    expect(fs.existsSync(path.join(tmpDir, "task", "prompt.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "task", "response.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "checkpoint.json"))).toBe(true);
  });

  it("mirrors graph.goal into context", async () => {
    const graph = makeGraph(
      [
        { id: "start", shape: "Mdiamond" },
        { id: "exit", shape: "Msquare" },
      ],
      [{ source: "start", target: "exit" }],
      { goal: "Build a feature" },
    );

    const registry = makeRegistry();
    const engine = new PipelineEngine({ registry, enableSleep: false });
    const result = await engine.execute(graph, { logsRoot: tmpDir });

    expect(result.context.getString("graph.goal")).toBe("Build a feature");
  });

  it("executes a branching pipeline with conditions", async () => {
    // Custom handler that always fails
    const failHandler: Handler = {
      async execute(): Promise<Outcome> {
        return { status: StageStatus.FAIL, failureReason: "test failure" };
      },
    };

    const registry = makeRegistry();
    registry.register("fail_handler", failHandler);

    const graph = makeGraph(
      [
        { id: "start", shape: "Mdiamond" },
        { id: "task", shape: "box", attrs: { type: "fail_handler" } },
        { id: "fix", shape: "box", attrs: { prompt: "Fix the issue" } },
        { id: "exit", shape: "Msquare" },
      ],
      [
        { source: "start", target: "task" },
        { source: "task", target: "exit", condition: "outcome=success" },
        { source: "task", target: "fix", condition: "outcome=fail" },
        { source: "fix", target: "exit" },
      ],
    );

    const engine = new PipelineEngine({ registry, enableSleep: false });
    const result = await engine.execute(graph, { logsRoot: tmpDir });

    expect(result.status).toBe("success");
    expect(result.completedNodes).toContain("task");
    expect(result.completedNodes).toContain("fix");
  });

  it("applies context updates from outcomes", async () => {
    const customHandler: Handler = {
      async execute(): Promise<Outcome> {
        return {
          status: StageStatus.SUCCESS,
          contextUpdates: { "custom.key": "custom_value" },
        };
      },
    };

    const registry = makeRegistry();
    registry.register("custom", customHandler);

    const graph = makeGraph(
      [
        { id: "start", shape: "Mdiamond" },
        { id: "task", shape: "box", attrs: { type: "custom" } },
        { id: "exit", shape: "Msquare" },
      ],
      [
        { source: "start", target: "task" },
        { source: "task", target: "exit" },
      ],
    );

    const engine = new PipelineEngine({ registry, enableSleep: false });
    const result = await engine.execute(graph, { logsRoot: tmpDir });

    expect(result.context.getString("custom.key")).toBe("custom_value");
  });

  it("enforces goal gates and routes to retry target", async () => {
    let callCount = 0;
    const sometimesFails: Handler = {
      async execute(): Promise<Outcome> {
        callCount++;
        if (callCount === 1) {
          return { status: StageStatus.FAIL, failureReason: "first attempt" };
        }
        return { status: StageStatus.SUCCESS };
      },
    };

    const registry = makeRegistry();
    registry.register("sometimes_fails", sometimesFails);

    const graph = makeGraph(
      [
        { id: "start", shape: "Mdiamond" },
        {
          id: "important",
          shape: "box",
          attrs: {
            type: "sometimes_fails",
            goalGate: true,
            retryTarget: "plan",
          },
        },
        { id: "plan", shape: "box", attrs: { prompt: "Plan again" } },
        { id: "exit", shape: "Msquare" },
      ],
      [
        { source: "start", target: "important" },
        { source: "important", target: "exit", condition: "outcome=success" },
        { source: "important", target: "plan", condition: "outcome=fail" },
        { source: "plan", target: "important" },
      ],
    );

    const engine = new PipelineEngine({ registry, enableSleep: false });
    const result = await engine.execute(graph, { logsRoot: tmpDir });

    // Should succeed on second attempt
    expect(result.status).toBe("success");
    expect(callCount).toBe(2);
  });

  it("fails when goal gate unsatisfied and no retry target", async () => {
    const failHandler: Handler = {
      async execute(): Promise<Outcome> {
        return { status: StageStatus.FAIL, failureReason: "always fails" };
      },
    };

    const registry = makeRegistry();
    registry.register("always_fails", failHandler);

    const graph = makeGraph(
      [
        { id: "start", shape: "Mdiamond" },
        {
          id: "task",
          shape: "box",
          attrs: { type: "always_fails", goalGate: true },
        },
        { id: "exit", shape: "Msquare" },
      ],
      [
        { source: "start", target: "task" },
        { source: "task", target: "exit" },
      ],
    );

    const engine = new PipelineEngine({ registry, enableSleep: false });
    const result = await engine.execute(graph, { logsRoot: tmpDir });

    expect(result.status).toBe("fail");
  });

  it("retries a node on RETRY status", async () => {
    let attempts = 0;
    const retryThenSucceed: Handler = {
      async execute(): Promise<Outcome> {
        attempts++;
        if (attempts < 3) {
          return { status: StageStatus.RETRY, failureReason: "not ready" };
        }
        return { status: StageStatus.SUCCESS };
      },
    };

    const registry = makeRegistry();
    registry.register("retry_then_succeed", retryThenSucceed);

    const graph = makeGraph(
      [
        { id: "start", shape: "Mdiamond" },
        {
          id: "task",
          shape: "box",
          attrs: { type: "retry_then_succeed", maxRetries: 5 },
        },
        { id: "exit", shape: "Msquare" },
      ],
      [
        { source: "start", target: "task" },
        { source: "task", target: "exit" },
      ],
    );

    const engine = new PipelineEngine({ registry, enableSleep: false });
    const result = await engine.execute(graph, { logsRoot: tmpDir });

    expect(result.status).toBe("success");
    expect(attempts).toBe(3);
  });

  it("emits events during execution", async () => {
    const events: PipelineEvent[] = [];

    const graph = makeGraph(
      [
        { id: "start", shape: "Mdiamond" },
        { id: "task", shape: "box", attrs: { prompt: "Do work" } },
        { id: "exit", shape: "Msquare" },
      ],
      [
        { source: "start", target: "task" },
        { source: "task", target: "exit" },
      ],
    );

    const registry = makeRegistry();
    const engine = new PipelineEngine({
      registry,
      enableSleep: false,
      onEvent: (e) => events.push(e),
    });
    await engine.execute(graph, { logsRoot: tmpDir });

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("PipelineStarted");
    expect(eventTypes).toContain("StageStarted");
    expect(eventTypes).toContain("StageCompleted");
    expect(eventTypes).toContain("CheckpointSaved");
    expect(eventTypes).toContain("PipelineCompleted");
  });

  it("saves checkpoints after each node", async () => {
    const graph = makeGraph(
      [
        { id: "start", shape: "Mdiamond" },
        { id: "task1", shape: "box", attrs: { prompt: "First" } },
        { id: "task2", shape: "box", attrs: { prompt: "Second" } },
        { id: "exit", shape: "Msquare" },
      ],
      [
        { source: "start", target: "task1" },
        { source: "task1", target: "task2" },
        { source: "task2", target: "exit" },
      ],
    );

    const registry = makeRegistry();
    const engine = new PipelineEngine({ registry, enableSleep: false });
    await engine.execute(graph, { logsRoot: tmpDir });

    const checkpointPath = path.join(tmpDir, "checkpoint.json");
    expect(fs.existsSync(checkpointPath)).toBe(true);

    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf-8"));
    expect(checkpoint.completed_nodes).toContain("start");
    expect(checkpoint.completed_nodes).toContain("task1");
    expect(checkpoint.completed_nodes).toContain("task2");
  });

  it("supports initial context values", async () => {
    const graph = makeGraph(
      [
        { id: "start", shape: "Mdiamond" },
        { id: "exit", shape: "Msquare" },
      ],
      [{ source: "start", target: "exit" }],
    );

    const registry = makeRegistry();
    const engine = new PipelineEngine({ registry, enableSleep: false });
    const result = await engine.execute(graph, {
      logsRoot: tmpDir,
      initialContext: { "my.key": "my_value" },
    });

    expect(result.context.getString("my.key")).toBe("my_value");
  });

  it("handles handler exceptions as FAIL outcomes", async () => {
    const throwingHandler: Handler = {
      async execute(): Promise<Outcome> {
        throw new Error("Handler crashed");
      },
    };

    const registry = makeRegistry();
    registry.register("throw_handler", throwingHandler);

    const graph = makeGraph(
      [
        { id: "start", shape: "Mdiamond" },
        { id: "task", shape: "box", attrs: { type: "throw_handler" } },
        { id: "exit", shape: "Msquare" },
      ],
      [
        { source: "start", target: "task" },
        { source: "task", target: "exit" },
      ],
    );

    const engine = new PipelineEngine({ registry, enableSleep: false });
    const result = await engine.execute(graph, { logsRoot: tmpDir });

    // The handler exception is caught and converted to FAIL
    expect(result.nodeOutcomes["task"]?.status).toBe("fail");
  });
});
