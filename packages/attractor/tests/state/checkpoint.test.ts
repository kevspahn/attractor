import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createCheckpoint,
  saveCheckpoint,
  loadCheckpoint,
} from "../../src/state/checkpoint.js";

describe("Checkpoint", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("creates a checkpoint with all fields", () => {
    const cp = createCheckpoint(
      "plan",
      ["start", "plan"],
      { plan: 1 },
      { outcome: "success", "graph.goal": "Build feature" },
      ["Stage start completed", "Stage plan completed"],
    );

    expect(cp.currentNode).toBe("plan");
    expect(cp.completedNodes).toEqual(["start", "plan"]);
    expect(cp.nodeRetries).toEqual({ plan: 1 });
    expect(cp.contextValues).toEqual({
      outcome: "success",
      "graph.goal": "Build feature",
    });
    expect(cp.logs).toEqual(["Stage start completed", "Stage plan completed"]);
    expect(cp.timestamp).toBeTruthy();
  });

  it("creates independent copies of arrays and objects", () => {
    const completedNodes = ["start"];
    const nodeRetries = { start: 0 };
    const contextValues = { key: "value" };
    const logs = ["log1"];

    const cp = createCheckpoint("start", completedNodes, nodeRetries, contextValues, logs);

    // Mutate originals
    completedNodes.push("plan");
    nodeRetries["plan"] = 1;
    contextValues["new_key"] = "new_value";
    logs.push("log2");

    // Checkpoint should be unaffected
    expect(cp.completedNodes).toEqual(["start"]);
    expect(cp.nodeRetries).toEqual({ start: 0 });
    expect(cp.contextValues).toEqual({ key: "value" });
    expect(cp.logs).toEqual(["log1"]);
  });

  it("save and load round-trip", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "attractor-test-"));
    const filePath = path.join(tmpDir, "checkpoint.json");

    const original = createCheckpoint(
      "implement",
      ["start", "plan", "implement"],
      { implement: 2, plan: 0 },
      { outcome: "retry", "graph.goal": "Build feature", count: 42 },
      ["Started", "Plan completed", "Implement retrying"],
    );

    saveCheckpoint(original, filePath);

    // File should exist
    expect(fs.existsSync(filePath)).toBe(true);

    // Load and compare
    const loaded = loadCheckpoint(filePath);
    expect(loaded.currentNode).toBe(original.currentNode);
    expect(loaded.completedNodes).toEqual(original.completedNodes);
    expect(loaded.nodeRetries).toEqual(original.nodeRetries);
    expect(loaded.contextValues).toEqual(original.contextValues);
    expect(loaded.logs).toEqual(original.logs);
    expect(loaded.timestamp).toBe(original.timestamp);
  });

  it("save creates parent directories if needed", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "attractor-test-"));
    const filePath = path.join(tmpDir, "nested", "dir", "checkpoint.json");

    const cp = createCheckpoint("start", ["start"], {}, {}, []);
    saveCheckpoint(cp, filePath);

    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("throws on malformed checkpoint file", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "attractor-test-"));
    const filePath = path.join(tmpDir, "bad-checkpoint.json");

    // Write a JSON file missing required fields
    fs.writeFileSync(filePath, JSON.stringify({ foo: "bar" }), "utf-8");

    expect(() => loadCheckpoint(filePath)).toThrow(
      "Checkpoint file is missing required fields",
    );
  });

  it("throws on non-object checkpoint file", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "attractor-test-"));
    const filePath = path.join(tmpDir, "bad-checkpoint.json");

    fs.writeFileSync(filePath, '"just a string"', "utf-8");

    expect(() => loadCheckpoint(filePath)).toThrow(
      "Invalid checkpoint file",
    );
  });

  it("saved JSON uses snake_case keys", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "attractor-test-"));
    const filePath = path.join(tmpDir, "checkpoint.json");

    const cp = createCheckpoint("node1", ["node1"], { node1: 3 }, { key: "val" }, ["log"]);
    saveCheckpoint(cp, filePath);

    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(raw).toHaveProperty("current_node");
    expect(raw).toHaveProperty("completed_nodes");
    expect(raw).toHaveProperty("node_retries");
    expect(raw).toHaveProperty("context");
    expect(raw).toHaveProperty("logs");
    expect(raw).toHaveProperty("timestamp");
  });
});
