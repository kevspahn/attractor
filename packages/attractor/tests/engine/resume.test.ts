import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { PipelineEngine } from "../../src/engine/engine.js";
import { HandlerRegistry } from "../../src/handlers/registry.js";
import { StartHandler } from "../../src/handlers/start.js";
import { ExitHandler } from "../../src/handlers/exit.js";
import { CodergenHandler } from "../../src/handlers/codergen.js";
import { ConditionalHandler } from "../../src/handlers/conditional.js";
import { StageStatus } from "../../src/state/outcome.js";
import type { Outcome } from "../../src/state/outcome.js";
import type { Handler } from "../../src/handlers/handler.js";
import { createCheckpoint, saveCheckpoint } from "../../src/state/checkpoint.js";
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
    condition?: string;
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
    if (ec.condition) e.condition = ec.condition;
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

describe("Checkpoint Resume", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resumes from mid-pipeline checkpoint", async () => {
    // Pipeline: start -> task1 -> task2 -> task3 -> exit
    const executedNodes: string[] = [];

    const trackingHandler: Handler = {
      async execute(node): Promise<Outcome> {
        executedNodes.push(node.id);
        return { status: StageStatus.SUCCESS, notes: `Done: ${node.id}` };
      },
    };

    const graph = makeGraph(
      [
        { id: "start", shape: "Mdiamond" },
        { id: "task1", shape: "box", attrs: { prompt: "Task 1" } },
        { id: "task2", shape: "box", attrs: { prompt: "Task 2" } },
        { id: "task3", shape: "box", attrs: { prompt: "Task 3" } },
        { id: "exit", shape: "Msquare" },
      ],
      [
        { source: "start", target: "task1" },
        { source: "task1", target: "task2" },
        { source: "task2", target: "task3" },
        { source: "task3", target: "exit" },
      ],
    );

    // Create a checkpoint as if task1 completed
    const checkpoint = createCheckpoint(
      "task1",
      ["start", "task1"],
      {},
      {
        "graph.goal": "",
        outcome: "success",
        current_node: "task1",
      },
      [],
    );
    saveCheckpoint(checkpoint, path.join(tmpDir, "checkpoint.json"));

    // Write status files for completed nodes
    const startDir = path.join(tmpDir, "start");
    fs.mkdirSync(startDir, { recursive: true });
    fs.writeFileSync(
      path.join(startDir, "status.json"),
      JSON.stringify({ status: "success" }),
    );

    const task1Dir = path.join(tmpDir, "task1");
    fs.mkdirSync(task1Dir, { recursive: true });
    fs.writeFileSync(
      path.join(task1Dir, "status.json"),
      JSON.stringify({ status: "success" }),
    );

    // Set up registry with tracking handler
    const registry = new HandlerRegistry();
    registry.register("start", new StartHandler());
    registry.register("exit", new ExitHandler());
    registry.register("codergen", trackingHandler);
    registry.setDefault(trackingHandler);

    const engine = new PipelineEngine({ registry, enableSleep: false });
    const result = await engine.execute(graph, {
      logsRoot: tmpDir,
      resume: true,
    });

    expect(result.status).toBe("success");
    // Should have resumed from task2, not re-run start and task1
    expect(executedNodes).toContain("task2");
    expect(executedNodes).toContain("task3");
    // start and task1 should NOT be re-executed
    expect(executedNodes).not.toContain("start");
    expect(executedNodes).not.toContain("task1");

    // Completed nodes should include all (from checkpoint + new)
    expect(result.completedNodes).toContain("start");
    expect(result.completedNodes).toContain("task1");
    expect(result.completedNodes).toContain("task2");
    expect(result.completedNodes).toContain("task3");
  });

  it("runs from scratch when no checkpoint exists", async () => {
    const graph = makeGraph(
      [
        { id: "start", shape: "Mdiamond" },
        { id: "task", shape: "box", attrs: { prompt: "Work" } },
        { id: "exit", shape: "Msquare" },
      ],
      [
        { source: "start", target: "task" },
        { source: "task", target: "exit" },
      ],
    );

    const registry = makeRegistry();
    const engine = new PipelineEngine({ registry, enableSleep: false });
    const result = await engine.execute(graph, {
      logsRoot: tmpDir,
      resume: true,
    });

    expect(result.status).toBe("success");
    expect(result.completedNodes).toContain("start");
    expect(result.completedNodes).toContain("task");
  });

  it("restores context values from checkpoint", async () => {
    const graph = makeGraph(
      [
        { id: "start", shape: "Mdiamond" },
        { id: "task", shape: "box", attrs: { prompt: "Work" } },
        { id: "exit", shape: "Msquare" },
      ],
      [
        { source: "start", target: "task" },
        { source: "task", target: "exit" },
      ],
    );

    // Save checkpoint with custom context values
    const checkpoint = createCheckpoint(
      "start",
      ["start"],
      {},
      {
        "graph.goal": "",
        "my.custom.key": "restored_value",
        outcome: "success",
      },
      ["log entry 1"],
    );
    saveCheckpoint(checkpoint, path.join(tmpDir, "checkpoint.json"));

    // Write start status
    const startDir = path.join(tmpDir, "start");
    fs.mkdirSync(startDir, { recursive: true });
    fs.writeFileSync(
      path.join(startDir, "status.json"),
      JSON.stringify({ status: "success" }),
    );

    const registry = makeRegistry();
    const engine = new PipelineEngine({ registry, enableSleep: false });
    const result = await engine.execute(graph, {
      logsRoot: tmpDir,
      resume: true,
    });

    expect(result.context.getString("my.custom.key")).toBe("restored_value");
  });

  it("restores retry counters from checkpoint", async () => {
    let attempts = 0;
    const retryHandler: Handler = {
      async execute(): Promise<Outcome> {
        attempts++;
        if (attempts < 2) {
          return { status: StageStatus.RETRY };
        }
        return { status: StageStatus.SUCCESS };
      },
    };

    const graph = makeGraph(
      [
        { id: "start", shape: "Mdiamond" },
        { id: "task", shape: "box", attrs: { maxRetries: 5 } },
        { id: "exit", shape: "Msquare" },
      ],
      [
        { source: "start", target: "task" },
        { source: "task", target: "exit" },
      ],
    );

    // Save checkpoint with pre-existing retry counts
    const checkpoint = createCheckpoint(
      "start",
      ["start"],
      { task: 2 }, // Already retried twice
      { "graph.goal": "", outcome: "success" },
      [],
    );
    saveCheckpoint(checkpoint, path.join(tmpDir, "checkpoint.json"));

    // Write start status
    const startDir = path.join(tmpDir, "start");
    fs.mkdirSync(startDir, { recursive: true });
    fs.writeFileSync(
      path.join(startDir, "status.json"),
      JSON.stringify({ status: "success" }),
    );

    const registry = new HandlerRegistry();
    registry.register("start", new StartHandler());
    registry.register("exit", new ExitHandler());
    registry.register("codergen", retryHandler);
    registry.setDefault(retryHandler);

    const engine = new PipelineEngine({ registry, enableSleep: false });
    const result = await engine.execute(graph, {
      logsRoot: tmpDir,
      resume: true,
    });

    expect(result.status).toBe("success");
  });
});
