/**
 * CodingAgentHandler — wraps @attractor/agent-loop Session.
 *
 * Spawns a Session with the node's prompt as the task,
 * enabling full agent capability (file editing, shell, iterative problem solving).
 *
 * See spec Section 4.12 (custom handler pattern).
 */

import type { Node, Graph } from "../parser/types.js";
import type { Context } from "../state/context.js";
import type { Outcome } from "../state/outcome.js";
import { StageStatus } from "../state/outcome.js";
import type { Handler } from "./handler.js";
import { expandVariables } from "./codergen.js";

/**
 * Interface for an agent session that the handler can drive.
 * This decouples the handler from the concrete agent-loop implementation.
 */
export interface AgentSession {
  run(prompt: string): Promise<{ success: boolean; output: string }>;
}

/** Factory function to create agent sessions. */
export type AgentSessionFactory = (
  node: Node,
  context: Context,
) => AgentSession;

export class CodingAgentHandler implements Handler {
  private sessionFactory: AgentSessionFactory | undefined;

  constructor(sessionFactory?: AgentSessionFactory) {
    this.sessionFactory = sessionFactory;
  }

  async execute(
    node: Node,
    context: Context,
    graph: Graph,
    _logsRoot: string,
  ): Promise<Outcome> {
    // Build prompt
    let prompt = node.prompt;
    if (!prompt) {
      prompt = node.label;
    }
    prompt = expandVariables(prompt, graph, context);

    if (!this.sessionFactory) {
      // Simulation mode
      return {
        status: StageStatus.SUCCESS,
        notes: `[Simulated] Coding agent for: ${node.id}`,
        contextUpdates: {
          last_stage: node.id,
          last_response: `[Simulated] Agent completed: ${node.id}`,
        },
      };
    }

    try {
      const session = this.sessionFactory(node, context);
      const result = await session.run(prompt);

      return {
        status: result.success ? StageStatus.SUCCESS : StageStatus.FAIL,
        notes: result.output.slice(0, 500),
        failureReason: result.success ? undefined : result.output,
        contextUpdates: {
          last_stage: node.id,
          last_response: result.output.slice(0, 200),
        },
      };
    } catch (err) {
      return {
        status: StageStatus.FAIL,
        failureReason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
