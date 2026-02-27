/**
 * Integration smoke tests for @attractor/attractor pipeline engine.
 *
 * These tests use the PipelineRunner with simulation mode (no real LLM backend)
 * to verify end-to-end pipeline execution:
 *   - DOT parsing
 *   - Validation
 *   - Node execution in correct order
 *   - Context propagation
 *   - Checkpoint saving
 *   - Artifact (log) writing
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { PipelineRunner } from "../../src/runner.js";
import { AutoApproveInterviewer } from "../../src/interviewer.js";
import { StageStatus } from "../../src/state/outcome.js";
import type { PipelineEvent } from "../../src/engine/events.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

function createTmpDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "attractor-integration-"),
  );
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

// ---------------------------------------------------------------------------
// Pipeline DOT sources
// ---------------------------------------------------------------------------

/** A 5-node pipeline: start -> analyze -> review -> fix -> done */
const fiveNodePipeline = `
  digraph code_review {
    graph [goal="Review and improve code quality"]

    start   [shape=Mdiamond]
    analyze [prompt="Analyze the codebase for issues"]
    review  [shape=hexagon, label="Human Review"]
    fix     [prompt="Fix the identified issues"]
    done    [shape=Msquare]

    start -> analyze
    analyze -> review
    review -> fix
    fix -> done
  }
`;

/** A pipeline with conditional branching */
const branchingPipeline = `
  digraph branching {
    graph [goal="Test conditional flow"]

    start  [shape=Mdiamond]
    check  [prompt="Check quality"]
    pass   [shape=Msquare, label="Pass"]
    repair [prompt="Repair issues"]
    done   [shape=Msquare]

    start -> check
    check -> pass
    check -> repair [label="Fix"]
    repair -> done
  }
`;

/** A minimal 3-node pipeline */
const minimalPipeline = `
  digraph minimal {
    graph [goal="Quick task"]
    start [shape=Mdiamond]
    task  [prompt="Do the task"]
    exit  [shape=Msquare]
    start -> task -> exit
  }
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Attractor pipeline integration smoke", () => {
  it("executes a 5-node pipeline end-to-end", async () => {
    const logsRoot = createTmpDir();
    const events: PipelineEvent[] = [];

    const runner = new PipelineRunner({
      interviewer: new AutoApproveInterviewer(),
      enableSleep: false,
      onEvent: (e) => events.push(e),
    });

    const result = await runner.run(fiveNodePipeline, { logsRoot });

    // Pipeline should succeed
    expect(result.status).toBe("success");

    // All nodes should have executed in the correct order
    expect(result.completedNodes).toContain("start");
    expect(result.completedNodes).toContain("analyze");
    expect(result.completedNodes).toContain("review");
    expect(result.completedNodes).toContain("fix");

    // start should come before analyze, analyze before review, etc.
    const startIdx = result.completedNodes.indexOf("start");
    const analyzeIdx = result.completedNodes.indexOf("analyze");
    const reviewIdx = result.completedNodes.indexOf("review");
    const fixIdx = result.completedNodes.indexOf("fix");
    expect(startIdx).toBeLessThan(analyzeIdx);
    expect(analyzeIdx).toBeLessThan(reviewIdx);
    expect(reviewIdx).toBeLessThan(fixIdx);
  });

  it("propagates context between nodes", async () => {
    const logsRoot = createTmpDir();

    const runner = new PipelineRunner({
      interviewer: new AutoApproveInterviewer(),
      enableSleep: false,
    });

    const result = await runner.run(fiveNodePipeline, {
      logsRoot,
      initialContext: { custom_key: "initial_value" },
    });

    expect(result.status).toBe("success");

    // Context should contain the initial value
    expect(result.context.get("custom_key")).toBe("initial_value");

    // Context should have the goal set from graph attributes
    expect(result.context.get("graph.goal")).toBe(
      "Review and improve code quality",
    );

    // Context should have outcome tracking from execution
    expect(result.context.has("current_node")).toBe(true);
    expect(result.context.has("outcome")).toBe(true);
  });

  it("saves checkpoints during execution", async () => {
    const logsRoot = createTmpDir();

    const runner = new PipelineRunner({
      interviewer: new AutoApproveInterviewer(),
      enableSleep: false,
    });

    const result = await runner.run(minimalPipeline, { logsRoot });

    expect(result.status).toBe("success");

    // Checkpoint file should exist
    const checkpointPath = path.join(logsRoot, "checkpoint.json");
    expect(fs.existsSync(checkpointPath)).toBe(true);

    // Parse and verify checkpoint content
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf-8"));
    expect(checkpoint.completed_nodes).toContain("start");
    expect(checkpoint.completed_nodes).toContain("task");
    expect(typeof checkpoint.timestamp).toBe("string");
  });

  it("writes stage artifacts (prompt/response logs)", async () => {
    const logsRoot = createTmpDir();

    const runner = new PipelineRunner({
      interviewer: new AutoApproveInterviewer(),
      enableSleep: false,
    });

    const result = await runner.run(minimalPipeline, { logsRoot });

    expect(result.status).toBe("success");

    // The "task" node should have prompt and response artifacts
    const taskDir = path.join(logsRoot, "task");
    expect(fs.existsSync(taskDir)).toBe(true);

    const promptPath = path.join(taskDir, "prompt.md");
    expect(fs.existsSync(promptPath)).toBe(true);
    const promptContent = fs.readFileSync(promptPath, "utf-8");
    expect(promptContent).toBe("Do the task");

    const responsePath = path.join(taskDir, "response.md");
    expect(fs.existsSync(responsePath)).toBe(true);
    const responseContent = fs.readFileSync(responsePath, "utf-8");
    expect(responseContent).toContain("[Simulated]");

    // Status file
    const statusPath = path.join(taskDir, "status.json");
    expect(fs.existsSync(statusPath)).toBe(true);
    const status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
    expect(status.status).toBe("success");
  });

  it("emits pipeline lifecycle events", async () => {
    const logsRoot = createTmpDir();
    const events: PipelineEvent[] = [];

    const runner = new PipelineRunner({
      interviewer: new AutoApproveInterviewer(),
      enableSleep: false,
      onEvent: (e) => events.push(e),
    });

    await runner.run(minimalPipeline, { logsRoot });

    const eventTypes = events.map((e) => e.type);

    // Should have pipeline lifecycle events
    expect(eventTypes).toContain("PipelineStarted");
    expect(eventTypes).toContain("PipelineCompleted");

    // Should have stage events for each node
    expect(eventTypes.filter((t) => t === "StageStarted").length).toBeGreaterThanOrEqual(2);
    expect(eventTypes.filter((t) => t === "StageCompleted").length).toBeGreaterThanOrEqual(2);

    // Should have checkpoint events
    expect(eventTypes).toContain("CheckpointSaved");
  });

  it("records outcomes for all executed nodes", async () => {
    const logsRoot = createTmpDir();

    const runner = new PipelineRunner({
      interviewer: new AutoApproveInterviewer(),
      enableSleep: false,
    });

    const result = await runner.run(fiveNodePipeline, { logsRoot });

    expect(result.status).toBe("success");

    // Should have outcomes for each executed node
    for (const nodeId of result.completedNodes) {
      expect(result.nodeOutcomes[nodeId]).toBeDefined();
      expect(result.nodeOutcomes[nodeId]!.status).toBe(StageStatus.SUCCESS);
    }
  });

  it("expands $goal variable in prompts", async () => {
    const logsRoot = createTmpDir();

    const goalPipeline = `
      digraph goaltest {
        graph [goal="Build a calculator"]
        start [shape=Mdiamond]
        plan  [prompt="Plan how to: $goal"]
        exit  [shape=Msquare]
        start -> plan -> exit
      }
    `;

    const runner = new PipelineRunner({
      enableSleep: false,
    });

    const result = await runner.run(goalPipeline, { logsRoot });

    expect(result.status).toBe("success");

    // Verify the prompt was expanded
    const promptPath = path.join(logsRoot, "plan", "prompt.md");
    const prompt = fs.readFileSync(promptPath, "utf-8");
    expect(prompt).toBe("Plan how to: Build a calculator");
  });

  it("uses AutoApproveInterviewer for human nodes", async () => {
    const logsRoot = createTmpDir();

    // Pipeline with a human-review node (hexagon shape)
    const result = await new PipelineRunner({
      interviewer: new AutoApproveInterviewer(),
      enableSleep: false,
    }).run(fiveNodePipeline, { logsRoot });

    expect(result.status).toBe("success");

    // The human review node should have been auto-approved
    expect(result.completedNodes).toContain("review");
    expect(result.nodeOutcomes["review"]!.status).toBe(StageStatus.SUCCESS);
  });

  it("validates pipeline before execution", async () => {
    const logsRoot = createTmpDir();

    // Invalid pipeline: no start node, no goal
    const invalidDot = `
      digraph invalid {
        task [label="Orphan Task"]
      }
    `;

    const runner = new PipelineRunner({ enableSleep: false });

    await expect(
      runner.run(invalidDot, { logsRoot }),
    ).rejects.toThrow("Validation failed");
  });

  it("supports initial context values", async () => {
    const logsRoot = createTmpDir();

    const runner = new PipelineRunner({
      enableSleep: false,
    });

    const result = await runner.run(minimalPipeline, {
      logsRoot,
      initialContext: {
        user: "tester",
        version: "1.0.0",
        tags: ["smoke", "integration"],
      },
    });

    expect(result.status).toBe("success");
    expect(result.context.get("user")).toBe("tester");
    expect(result.context.get("version")).toBe("1.0.0");
    expect(result.context.get("tags")).toEqual(["smoke", "integration"]);
  });

  it("handles branching pipeline with default edge", async () => {
    const logsRoot = createTmpDir();

    const runner = new PipelineRunner({
      enableSleep: false,
    });

    const result = await runner.run(branchingPipeline, { logsRoot });

    // Pipeline should succeed (follows default/first edge from check)
    expect(result.status).toBe("success");
    expect(result.completedNodes).toContain("start");
    expect(result.completedNodes).toContain("check");
  });
});
