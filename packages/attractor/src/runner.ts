/**
 * PipelineRunner — the main entry point for executing DOT pipelines.
 *
 * Orchestrates: parse -> transform -> validate -> engine.execute()
 *
 * See spec Section 9.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Graph } from "./parser/types.js";
import { parseDot } from "./parser/parser.js";
import { validateOrRaise } from "./validator.js";
import type { LintRule, Diagnostic } from "./validator.js";
import { PipelineEngine } from "./engine/engine.js";
import type {
  EngineConfig,
  ExecuteOptions,
  PipelineResult,
} from "./engine/engine.js";
import { HandlerRegistry } from "./handlers/registry.js";
import { StartHandler } from "./handlers/start.js";
import { ExitHandler } from "./handlers/exit.js";
import { CodergenHandler } from "./handlers/codergen.js";
import type { CodergenBackend } from "./handlers/codergen.js";
import { ConditionalHandler } from "./handlers/conditional.js";
import { WaitForHumanHandler } from "./handlers/human.js";
import { ParallelHandler } from "./handlers/parallel.js";
import { FanInHandler } from "./handlers/fan-in.js";
import { ToolHandler } from "./handlers/tool.js";
import { CodingAgentHandler } from "./handlers/coding-agent.js";
import type { AgentSessionFactory } from "./handlers/coding-agent.js";
import type { Handler } from "./handlers/handler.js";
import type { Interviewer } from "./interviewer.js";
import { AutoApproveInterviewer } from "./interviewer.js";
import type { Transform } from "./transforms/index.js";
import { getBuiltInTransforms, applyTransforms } from "./transforms/index.js";
import type { PipelineEvent } from "./engine/events.js";

// ---------- Config Types ----------

export interface RunnerConfig {
  /** LLM backend for codergen nodes. If not set, simulation mode. */
  backend?: CodergenBackend;
  /** Interviewer for human-in-the-loop nodes. Default: AutoApproveInterviewer. */
  interviewer?: Interviewer;
  /** Agent session factory for coding-agent nodes. */
  agentSessionFactory?: AgentSessionFactory;
  /** Event listener callback. */
  onEvent?: (event: PipelineEvent) => void;
  /** Extra lint rules for validation. */
  extraLintRules?: LintRule[];
  /** Whether to actually sleep during retries. Default true. */
  enableSleep?: boolean;
}

export interface RunOptions {
  /** Root directory for logs and artifacts. Auto-generated if not set. */
  logsRoot?: string;
  /** Resume from existing checkpoint. */
  resume?: boolean;
  /** Initial context values. */
  initialContext?: Record<string, unknown>;
}

// ---------- PipelineRunner ----------

export class PipelineRunner {
  private config: RunnerConfig;
  private registry: HandlerRegistry;
  private customTransforms: Transform[] = [];
  private extraLintRules: LintRule[];

  constructor(config: RunnerConfig = {}) {
    this.config = config;
    this.extraLintRules = config.extraLintRules ?? [];

    // Build handler registry with all built-in handlers
    this.registry = new HandlerRegistry();
    this.registry.register("start", new StartHandler());
    this.registry.register("exit", new ExitHandler());

    const codergen = new CodergenHandler(config.backend);
    this.registry.register("codergen", codergen);
    this.registry.setDefault(codergen);

    this.registry.register("conditional", new ConditionalHandler());

    const interviewer = config.interviewer ?? new AutoApproveInterviewer();
    this.registry.register("wait.human", new WaitForHumanHandler(interviewer));

    this.registry.register("parallel", new ParallelHandler());
    this.registry.register("parallel.fan_in", new FanInHandler());
    this.registry.register("tool", new ToolHandler());
    this.registry.register(
      "coding_agent",
      new CodingAgentHandler(config.agentSessionFactory),
    );
  }

  /** Register a custom transform. */
  registerTransform(transform: Transform): void {
    this.customTransforms.push(transform);
  }

  /** Register a custom handler for a type string. */
  registerHandler(type: string, handler: Handler): void {
    this.registry.register(type, handler);
  }

  /**
   * Run a pipeline from a DOT source string.
   */
  async run(
    dotSource: string,
    options: RunOptions = {},
  ): Promise<PipelineResult> {
    // 1. Parse
    const graph = parseDot(dotSource);

    // 2. Transform
    const transforms = [...getBuiltInTransforms(), ...this.customTransforms];
    const transformedGraph = applyTransforms(graph, transforms);

    // 3. Validate (throws on errors, returns warnings)
    const warnings = validateOrRaise(transformedGraph, this.extraLintRules);

    // 4. Execute
    return this.executeGraph(transformedGraph, options, warnings);
  }

  /**
   * Run a pipeline from a DOT file path.
   */
  async runFile(
    dotFilePath: string,
    options: RunOptions = {},
  ): Promise<PipelineResult> {
    const dotSource = fs.readFileSync(dotFilePath, "utf-8");
    return this.run(dotSource, options);
  }

  /**
   * Parse and validate only (no execution).
   */
  parseAndValidate(dotSource: string): {
    graph: Graph;
    diagnostics: Diagnostic[];
  } {
    const graph = parseDot(dotSource);
    const transforms = [...getBuiltInTransforms(), ...this.customTransforms];
    const transformedGraph = applyTransforms(graph, transforms);
    const diagnostics = validateOrRaise(transformedGraph, this.extraLintRules);
    return { graph: transformedGraph, diagnostics };
  }

  /** Get the handler registry (for testing/inspection). */
  getRegistry(): HandlerRegistry {
    return this.registry;
  }

  private async executeGraph(
    graph: Graph,
    options: RunOptions,
    _warnings: Diagnostic[],
  ): Promise<PipelineResult> {
    // Determine logs root
    const logsRoot =
      options.logsRoot ??
      path.join(
        process.cwd(),
        ".attractor-runs",
        `run-${Date.now()}`,
      );

    const engineConfig: EngineConfig = {
      registry: this.registry,
      onEvent: this.config.onEvent,
      enableSleep: this.config.enableSleep,
    };

    const engine = new PipelineEngine(engineConfig);

    const executeOptions: ExecuteOptions = {
      logsRoot,
      resume: options.resume,
      initialContext: options.initialContext,
    };

    return engine.execute(graph, executeOptions);
  }
}
