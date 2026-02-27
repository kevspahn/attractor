import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { PipelineRunner } from "../src/runner.js";
import type { PipelineEvent } from "../src/engine/events.js";
import { StageStatus } from "../src/state/outcome.js";

describe("PipelineRunner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const simplePipeline = `
    digraph Simple {
      graph [goal="Run tests and report"]
      start [shape=Mdiamond, label="Start"]
      exit  [shape=Msquare, label="Exit"]
      run_tests [label="Run Tests", prompt="Run the test suite"]
      report    [label="Report", prompt="Summarize results"]
      start -> run_tests -> report -> exit
    }
  `;

  it("executes a simple DOT pipeline string", async () => {
    const runner = new PipelineRunner({ enableSleep: false });
    const result = await runner.run(simplePipeline, { logsRoot: tmpDir });

    expect(result.status).toBe("success");
    expect(result.completedNodes).toContain("start");
    expect(result.completedNodes).toContain("run_tests");
    expect(result.completedNodes).toContain("report");
  });

  it("expands $goal in prompts", async () => {
    const dot = `
      digraph Test {
        graph [goal="Build a hello world script"]
        start [shape=Mdiamond]
        exit  [shape=Msquare]
        plan  [prompt="Plan how to: $goal"]
        start -> plan -> exit
      }
    `;

    const runner = new PipelineRunner({ enableSleep: false });
    const result = await runner.run(dot, { logsRoot: tmpDir });

    expect(result.status).toBe("success");

    // Check the prompt was expanded
    const promptPath = path.join(tmpDir, "plan", "prompt.md");
    const prompt = fs.readFileSync(promptPath, "utf-8");
    expect(prompt).toBe("Plan how to: Build a hello world script");
  });

  it("validates the pipeline before execution", async () => {
    const invalidDot = `
      digraph Invalid {
        task [label="Task"]
      }
    `;

    const runner = new PipelineRunner({ enableSleep: false });
    await expect(runner.run(invalidDot, { logsRoot: tmpDir })).rejects.toThrow(
      "Validation failed",
    );
  });

  it("supports conditional branching end-to-end", async () => {
    const dot = `
      digraph Branch {
        graph [goal="Test branching"]
        start [shape=Mdiamond]
        exit  [shape=Msquare]
        plan  [label="Plan", prompt="Create a plan"]
        gate  [shape=diamond, label="Check"]
        done  [label="Done", prompt="Finish up"]
        start -> plan -> gate
        gate -> done [condition="outcome=success"]
        done -> exit
      }
    `;

    const runner = new PipelineRunner({ enableSleep: false });
    const result = await runner.run(dot, { logsRoot: tmpDir });

    expect(result.status).toBe("success");
    expect(result.completedNodes).toContain("gate");
    expect(result.completedNodes).toContain("done");
  });

  it("emits events during execution", async () => {
    const events: PipelineEvent[] = [];

    const runner = new PipelineRunner({
      enableSleep: false,
      onEvent: (e) => events.push(e),
    });
    await runner.run(simplePipeline, { logsRoot: tmpDir });

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("PipelineStarted");
    expect(eventTypes).toContain("PipelineCompleted");
    expect(eventTypes).toContain("StageStarted");
  });

  it("registers custom handlers", async () => {
    const dot = `
      digraph Custom {
        start [shape=Mdiamond]
        exit  [shape=Msquare]
        task  [type="my_custom", label="Custom Task"]
        start -> task -> exit
      }
    `;

    const runner = new PipelineRunner({ enableSleep: false });
    runner.registerHandler("my_custom", {
      async execute() {
        return {
          status: StageStatus.SUCCESS,
          contextUpdates: { "custom.ran": "true" },
        };
      },
    });

    const result = await runner.run(dot, { logsRoot: tmpDir });

    expect(result.status).toBe("success");
    expect(result.context.getString("custom.ran")).toBe("true");
  });

  it("registers custom transforms", async () => {
    const dot = `
      digraph Test {
        graph [goal="Test"]
        start [shape=Mdiamond]
        exit  [shape=Msquare]
        task  [prompt="Original prompt"]
        start -> task -> exit
      }
    `;

    const runner = new PipelineRunner({ enableSleep: false });
    runner.registerTransform({
      name: "custom-transform",
      apply(graph) {
        for (const [, node] of graph.nodes) {
          if (node.prompt) {
            node.prompt = node.prompt + " [transformed]";
          }
        }
        return graph;
      },
    });

    const result = await runner.run(dot, { logsRoot: tmpDir });

    expect(result.status).toBe("success");
    // Check the prompt was modified by the transform
    const promptPath = path.join(tmpDir, "task", "prompt.md");
    const prompt = fs.readFileSync(promptPath, "utf-8");
    expect(prompt).toContain("[transformed]");
  });

  it("parseAndValidate returns graph and diagnostics", () => {
    const runner = new PipelineRunner({ enableSleep: false });
    const { graph, diagnostics } = runner.parseAndValidate(simplePipeline);

    expect(graph.nodes.size).toBe(4);
    expect(graph.attributes.goal).toBe("Run tests and report");
    // Warnings only (no errors, otherwise would have thrown)
    for (const d of diagnostics) {
      expect(d.severity).not.toBe("error");
    }
  });

  it("supports initial context values", async () => {
    const dot = `
      digraph Test {
        start [shape=Mdiamond]
        exit  [shape=Msquare]
        start -> exit
      }
    `;

    const runner = new PipelineRunner({ enableSleep: false });
    const result = await runner.run(dot, {
      logsRoot: tmpDir,
      initialContext: { "my.key": "hello" },
    });

    expect(result.context.getString("my.key")).toBe("hello");
  });

  it("runs a pipeline with backend (mock LLM)", async () => {
    const dot = `
      digraph Test {
        graph [goal="Test backend"]
        start [shape=Mdiamond]
        exit  [shape=Msquare]
        task  [prompt="Generate code"]
        start -> task -> exit
      }
    `;

    const runner = new PipelineRunner({
      enableSleep: false,
      backend: {
        async run(_node, prompt) {
          return `Response to: ${prompt}`;
        },
      },
    });

    const result = await runner.run(dot, { logsRoot: tmpDir });

    expect(result.status).toBe("success");
    const responsePath = path.join(tmpDir, "task", "response.md");
    const response = fs.readFileSync(responsePath, "utf-8");
    expect(response).toBe("Response to: Generate code");
  });
});
