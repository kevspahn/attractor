/**
 * Subagent support.
 *
 * A subagent is a child Session spawned by the parent to handle a scoped task.
 * The subagent runs its own agentic loop with its own conversation history but
 * shares the parent's execution environment (same filesystem).
 */

import { Session } from "./session.js";
import type { SessionConfig } from "./session.js";

/**
 * Handle to a running subagent.
 */
export interface SubAgentHandle {
  id: string;
  session: Session;
  status: "running" | "completed" | "failed";
  /** Promise that resolves when the subagent finishes processing. */
  completion?: Promise<void>;
}

/**
 * Result from a completed subagent.
 */
export interface SubAgentResult {
  output: string;
  success: boolean;
  turnsUsed: number;
}

/**
 * Manager for subagents within a parent session.
 */
export class SubAgentManager {
  private _agents: Map<string, SubAgentHandle> = new Map();
  private _nextId = 1;
  private _parentConfig: SessionConfig;
  private _currentDepth: number;
  private _maxDepth: number;

  constructor(parentConfig: SessionConfig, currentDepth: number = 0) {
    this._parentConfig = parentConfig;
    this._currentDepth = currentDepth;
    this._maxDepth = parentConfig.maxSubagentDepth ?? 1;
  }

  /**
   * Spawn a new subagent.
   */
  async spawn(options: {
    task: string;
    workingDir?: string;
    model?: string;
    maxTurns?: number;
  }): Promise<SubAgentHandle> {
    // Check depth limit
    if (this._currentDepth >= this._maxDepth) {
      throw new Error(
        `Cannot spawn subagent: maximum depth (${this._maxDepth}) reached`,
      );
    }

    const id = `agent-${this._nextId++}`;

    // Create child session config sharing parent's execution environment
    const childConfig: SessionConfig = {
      profile: this._parentConfig.profile,
      executionEnv: this._parentConfig.executionEnv,
      client: this._parentConfig.client,
      maxTurns: options.maxTurns ?? 0,
      maxToolRoundsPerInput: this._parentConfig.maxToolRoundsPerInput,
      projectDocs: this._parentConfig.projectDocs,
      systemPrompt: this._parentConfig.systemPrompt,
      maxSubagentDepth: this._maxDepth,
      currentDepth: this._currentDepth + 1,
      reasoningEffort: this._parentConfig.reasoningEffort,
    };

    const childSession = new Session(childConfig);
    const handle: SubAgentHandle = {
      id,
      session: childSession,
      status: "running",
    };

    // Start processing the task
    handle.completion = childSession
      .processInput(options.task)
      .then(() => {
        handle.status = "completed";
      })
      .catch(() => {
        handle.status = "failed";
      });

    this._agents.set(id, handle);
    return handle;
  }

  /**
   * Send input to a running subagent.
   */
  async sendInput(agentId: string, message: string): Promise<void> {
    const handle = this._agents.get(agentId);
    if (!handle) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    if (handle.status !== "running") {
      throw new Error(`Agent ${agentId} is not running (status: ${handle.status})`);
    }
    handle.session.followUp(message);
  }

  /**
   * Wait for a subagent to complete and return its result.
   */
  async wait(agentId: string): Promise<SubAgentResult> {
    const handle = this._agents.get(agentId);
    if (!handle) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    // Wait for completion
    if (handle.completion) {
      await handle.completion;
    }

    // Collect the final output from the last assistant turn
    const lastAssistant = [...handle.session.history]
      .reverse()
      .find((t) => t.type === "assistant");

    const output = lastAssistant && lastAssistant.type === "assistant"
      ? lastAssistant.content
      : "";

    const turnsUsed = handle.session.history.filter(
      (t) => t.type === "user" || t.type === "assistant",
    ).length;

    return {
      output,
      success: handle.status === "completed",
      turnsUsed,
    };
  }

  /**
   * Terminate a subagent.
   */
  close(agentId: string): void {
    const handle = this._agents.get(agentId);
    if (!handle) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    handle.session.abort();
    handle.status = "failed";
    this._agents.delete(agentId);
  }

  /**
   * Get a subagent handle by ID.
   */
  get(agentId: string): SubAgentHandle | undefined {
    return this._agents.get(agentId);
  }
}
