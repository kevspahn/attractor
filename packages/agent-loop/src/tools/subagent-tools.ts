/**
 * Subagent tools: spawn_agent, send_input, wait, close_agent.
 *
 * These tools allow an agent to spawn child agents for parallel work
 * and task decomposition.
 */

import type { RegisteredTool, ExecutionEnvironment } from "../types.js";
import type { SubAgentManager } from "../subagent.js";

/**
 * Create subagent tools that are bound to a specific SubAgentManager.
 * The manager must be provided at registration time because the tools
 * need access to the parent session's subagent state.
 */
export function createSubagentTools(manager: SubAgentManager): RegisteredTool[] {
  const spawnAgentTool: RegisteredTool = {
    definition: {
      name: "spawn_agent",
      description:
        "Spawn a subagent to handle a scoped task autonomously. The subagent runs its own agentic loop with independent conversation history but shares the same filesystem.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "Natural language task description for the subagent.",
          },
          working_dir: {
            type: "string",
            description: "Optional subdirectory to scope the agent to.",
          },
          model: {
            type: "string",
            description:
              "Optional model override (default: parent's model).",
          },
          max_turns: {
            type: "integer",
            description: "Optional turn limit (default: 0, unlimited).",
          },
        },
        required: ["task"],
      },
    },
    executor: async (
      args: Record<string, unknown>,
      _env: ExecutionEnvironment,
    ): Promise<string> => {
      const task = args.task as string;
      const workingDir = args.working_dir as string | undefined;
      const model = args.model as string | undefined;
      const maxTurns = args.max_turns as number | undefined;

      try {
        const handle = await manager.spawn({
          task,
          workingDir,
          model,
          maxTurns,
        });
        return JSON.stringify({
          agent_id: handle.id,
          status: handle.status,
          task,
        });
      } catch (error) {
        throw new Error(
          `Failed to spawn agent: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };

  const sendInputTool: RegisteredTool = {
    definition: {
      name: "send_input",
      description: "Send a message to a running subagent.",
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "The ID of the subagent to send the message to.",
          },
          message: {
            type: "string",
            description: "The message to send to the subagent.",
          },
        },
        required: ["agent_id", "message"],
      },
    },
    executor: async (
      args: Record<string, unknown>,
      _env: ExecutionEnvironment,
    ): Promise<string> => {
      const agentId = args.agent_id as string;
      const message = args.message as string;

      await manager.sendInput(agentId, message);
      return JSON.stringify({ status: "sent", agent_id: agentId });
    },
  };

  const waitTool: RegisteredTool = {
    definition: {
      name: "wait",
      description:
        "Wait for a subagent to complete and return its result.",
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "The ID of the subagent to wait for.",
          },
        },
        required: ["agent_id"],
      },
    },
    executor: async (
      args: Record<string, unknown>,
      _env: ExecutionEnvironment,
    ): Promise<string> => {
      const agentId = args.agent_id as string;
      const result = await manager.wait(agentId);
      return JSON.stringify(result);
    },
  };

  const closeAgentTool: RegisteredTool = {
    definition: {
      name: "close_agent",
      description: "Terminate a subagent.",
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "The ID of the subagent to terminate.",
          },
        },
        required: ["agent_id"],
      },
    },
    executor: async (
      args: Record<string, unknown>,
      _env: ExecutionEnvironment,
    ): Promise<string> => {
      const agentId = args.agent_id as string;
      manager.close(agentId);
      return JSON.stringify({ status: "closed", agent_id: agentId });
    },
  };

  return [spawnAgentTool, sendInputTool, waitTool, closeAgentTool];
}
