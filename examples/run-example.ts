/**
 * Example: Running a DOT pipeline with Attractor.
 *
 * This script demonstrates how to:
 *   1. Import the PipelineRunner from @attractor/attractor
 *   2. Read a DOT pipeline definition
 *   3. Run it with an AutoApproveInterviewer (for non-interactive execution)
 *   4. Print the results
 *
 * NOTE: This example runs in "simulation mode" by default — no real LLM API
 * keys are required. The CodergenHandler will produce simulated responses
 * for each stage. To use real LLM backends, provide a `backend` option
 * when constructing the PipelineRunner.
 *
 * Usage:
 *   npx tsx examples/run-example.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PipelineRunner,
  AutoApproveInterviewer,
} from "@attractor/attractor";
import type { PipelineEvent } from "@attractor/attractor";

// ---------------------------------------------------------------------------
// Resolve the DOT file path relative to this script
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dotFilePath = path.join(__dirname, "simple-pipeline.dot");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Attractor Pipeline Example ===\n");

  // 1. Read the DOT file
  const dotSource = fs.readFileSync(dotFilePath, "utf-8");
  console.log("Pipeline DOT source:");
  console.log("--------------------");
  console.log(dotSource);
  console.log("--------------------\n");

  // 2. Create the pipeline runner
  //    - AutoApproveInterviewer auto-approves all human review nodes
  //    - enableSleep: false skips retry delays
  //    - No backend is provided, so stages run in simulation mode
  const runner = new PipelineRunner({
    interviewer: new AutoApproveInterviewer(),
    enableSleep: false,
    onEvent: (event: PipelineEvent) => {
      // Print pipeline events as they happen
      switch (event.type) {
        case "PipelineStarted":
          console.log(`[PIPELINE] Started: ${event.name}`);
          break;
        case "StageStarted":
          console.log(`  [STAGE] Started: ${event.name} (step ${event.index})`);
          break;
        case "StageCompleted":
          console.log(`  [STAGE] Completed: ${event.name} (${event.duration}ms)`);
          break;
        case "CheckpointSaved":
          console.log(`  [CHECKPOINT] Saved at: ${event.nodeId}`);
          break;
        case "PipelineCompleted":
          console.log(`[PIPELINE] Completed in ${event.duration}ms`);
          break;
        case "PipelineFailed":
          console.log(`[PIPELINE] Failed: ${event.error}`);
          break;
        default:
          // Other events are available but not printed here
          break;
      }
    },
  });

  // 3. Run the pipeline
  const logsRoot = path.join(__dirname, "..", ".attractor-runs", `example-${Date.now()}`);
  console.log(`Logs will be written to: ${logsRoot}\n`);

  const result = await runner.run(dotSource, {
    logsRoot,
    initialContext: {
      project: "example-project",
      runBy: "run-example.ts",
    },
  });

  // 4. Print the results
  console.log("\n=== Pipeline Results ===");
  console.log(`Status: ${result.status}`);
  console.log(`Completed nodes: ${result.completedNodes.join(" -> ")}`);
  console.log(`\nNode outcomes:`);
  for (const [nodeId, outcome] of Object.entries(result.nodeOutcomes)) {
    console.log(`  ${nodeId}: ${outcome.status}${outcome.notes ? ` (${outcome.notes})` : ""}`);
  }

  // 5. Show context snapshot
  const ctx = result.context.snapshot();
  console.log(`\nFinal context (${Object.keys(ctx).length} keys):`);
  for (const [key, value] of Object.entries(ctx)) {
    const displayValue =
      typeof value === "string" && value.length > 60
        ? value.slice(0, 60) + "..."
        : JSON.stringify(value);
    console.log(`  ${key}: ${displayValue}`);
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
