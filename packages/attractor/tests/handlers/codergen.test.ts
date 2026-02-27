import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  CodergenHandler,
  expandVariables,
} from "../../src/handlers/codergen.js";
import type { CodergenBackend } from "../../src/handlers/codergen.js";
import { Context } from "../../src/state/context.js";
import { StageStatus } from "../../src/state/outcome.js";
import type { Outcome } from "../../src/state/outcome.js";
import {
  createDefaultNode,
  createDefaultGraphAttributes,
} from "../../src/parser/types.js";
import type { Graph } from "../../src/parser/types.js";

function makeGraph(goal: string = "Test goal"): Graph {
  return {
    id: "test",
    attributes: { ...createDefaultGraphAttributes(), goal },
    nodes: new Map(),
    edges: [],
    subgraphs: [],
  };
}

describe("expandVariables", () => {
  it("expands $goal in text", () => {
    const graph = makeGraph("Build a web app");
    const ctx = new Context();
    expect(expandVariables("Task: $goal", graph, ctx)).toBe(
      "Task: Build a web app",
    );
  });

  it("expands multiple $goal references", () => {
    const graph = makeGraph("Do X");
    const ctx = new Context();
    expect(expandVariables("$goal and $goal", graph, ctx)).toBe(
      "Do X and Do X",
    );
  });

  it("returns text unchanged when no $goal", () => {
    const graph = makeGraph("Anything");
    const ctx = new Context();
    expect(expandVariables("No variables here", graph, ctx)).toBe(
      "No variables here",
    );
  });
});

describe("CodergenHandler", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codergen-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs in simulation mode when no backend provided", async () => {
    const handler = new CodergenHandler();
    const node = createDefaultNode("plan");
    node.prompt = "Plan the implementation";
    const graph = makeGraph();
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, tmpDir);

    expect(outcome.status).toBe(StageStatus.SUCCESS);
    expect(outcome.notes).toBe("Stage completed: plan");
    expect(outcome.contextUpdates?.last_stage).toBe("plan");

    // Check files were written
    const promptPath = path.join(tmpDir, "plan", "prompt.md");
    const responsePath = path.join(tmpDir, "plan", "response.md");
    const statusPath = path.join(tmpDir, "plan", "status.json");

    expect(fs.existsSync(promptPath)).toBe(true);
    expect(fs.existsSync(responsePath)).toBe(true);
    expect(fs.existsSync(statusPath)).toBe(true);

    expect(fs.readFileSync(promptPath, "utf-8")).toBe(
      "Plan the implementation",
    );
    expect(fs.readFileSync(responsePath, "utf-8")).toContain("[Simulated]");
  });

  it("uses label as fallback when prompt is empty", async () => {
    const handler = new CodergenHandler();
    const node = createDefaultNode("plan");
    node.label = "Plan Next Step";
    node.prompt = "";
    const graph = makeGraph();
    const ctx = new Context();

    await handler.execute(node, ctx, graph, tmpDir);

    const promptContent = fs.readFileSync(
      path.join(tmpDir, "plan", "prompt.md"),
      "utf-8",
    );
    expect(promptContent).toBe("Plan Next Step");
  });

  it("expands $goal in prompt", async () => {
    const handler = new CodergenHandler();
    const node = createDefaultNode("plan");
    node.prompt = "Work on: $goal";
    const graph = makeGraph("Build the feature");
    const ctx = new Context();

    await handler.execute(node, ctx, graph, tmpDir);

    const promptContent = fs.readFileSync(
      path.join(tmpDir, "plan", "prompt.md"),
      "utf-8",
    );
    expect(promptContent).toBe("Work on: Build the feature");
  });

  it("calls backend and uses string response", async () => {
    const backend: CodergenBackend = {
      async run(_node, _prompt, _context) {
        return "Generated code: console.log('hello')";
      },
    };

    const handler = new CodergenHandler(backend);
    const node = createDefaultNode("implement");
    node.prompt = "Write hello world";
    const graph = makeGraph();
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, tmpDir);

    expect(outcome.status).toBe(StageStatus.SUCCESS);
    const responseContent = fs.readFileSync(
      path.join(tmpDir, "implement", "response.md"),
      "utf-8",
    );
    expect(responseContent).toBe("Generated code: console.log('hello')");
  });

  it("returns backend Outcome directly when backend returns Outcome", async () => {
    const customOutcome: Outcome = {
      status: StageStatus.PARTIAL_SUCCESS,
      notes: "Partial",
      contextUpdates: { key: "val" },
    };
    const backend: CodergenBackend = {
      async run() {
        return customOutcome;
      },
    };

    const handler = new CodergenHandler(backend);
    const node = createDefaultNode("custom");
    node.prompt = "Do something";
    const graph = makeGraph();
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, tmpDir);

    expect(outcome.status).toBe(StageStatus.PARTIAL_SUCCESS);
    expect(outcome.notes).toBe("Partial");
    expect(outcome.contextUpdates?.key).toBe("val");
  });

  it("handles backend exceptions as FAIL outcome", async () => {
    const backend: CodergenBackend = {
      async run() {
        throw new Error("LLM API down");
      },
    };

    const handler = new CodergenHandler(backend);
    const node = createDefaultNode("broken");
    node.prompt = "Do something";
    const graph = makeGraph();
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, tmpDir);

    expect(outcome.status).toBe(StageStatus.FAIL);
    expect(outcome.failureReason).toBe("LLM API down");
  });

  it("writes status.json with outcome data", async () => {
    const handler = new CodergenHandler();
    const node = createDefaultNode("task");
    node.prompt = "Test";
    const graph = makeGraph();
    const ctx = new Context();

    await handler.execute(node, ctx, graph, tmpDir);

    const statusPath = path.join(tmpDir, "task", "status.json");
    const status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
    expect(status.status).toBe("success");
    expect(status.notes).toBe("Stage completed: task");
  });

  it("truncates last_response in context_updates to 200 chars", async () => {
    const longResponse = "a".repeat(500);
    const backend: CodergenBackend = {
      async run() {
        return longResponse;
      },
    };

    const handler = new CodergenHandler(backend);
    const node = createDefaultNode("task");
    node.prompt = "Test";
    const graph = makeGraph();
    const ctx = new Context();

    const outcome = await handler.execute(node, ctx, graph, tmpDir);

    const lastResponse = outcome.contextUpdates?.last_response as string;
    expect(lastResponse).toHaveLength(200);
  });
});
