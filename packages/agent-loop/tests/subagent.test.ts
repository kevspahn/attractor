/**
 * Tests for subagent support.
 */

import { describe, it, expect, vi } from "vitest";
import { SubAgentManager } from "../src/subagent.js";
import type { SessionConfig } from "../src/session.js";
import { createAnthropicProfile } from "../src/profiles/anthropic.js";
import type { Client, Response } from "@attractor/llm-client";
import { Usage, ContentKind, Role } from "@attractor/llm-client";
import type { ExecutionEnvironment, ExecResult } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEnv(): ExecutionEnvironment {
  return {
    readFile: vi.fn().mockResolvedValue("1 | content"),
    readFileRaw: vi.fn().mockResolvedValue("content"),
    writeFile: vi.fn().mockResolvedValue(undefined),
    fileExists: vi.fn().mockResolvedValue(true),
    listDirectory: vi.fn().mockResolvedValue([]),
    execCommand: vi.fn().mockResolvedValue({
      stdout: "output",
      stderr: "",
      exitCode: 0,
      durationMs: 50,
      timedOut: false,
    } as ExecResult),
    grep: vi.fn().mockResolvedValue(""),
    glob: vi.fn().mockResolvedValue([]),
    workingDirectory: () => "/tmp/test",
    platform: () => "linux",
  };
}

function textResponse(text: string): Response {
  return {
    id: `resp-${Date.now()}`,
    model: "claude-sonnet-4-5",
    provider: "anthropic",
    message: {
      role: Role.ASSISTANT,
      content: [{ kind: ContentKind.TEXT, text }],
    },
    finish_reason: { reason: "stop" },
    usage: new Usage({ input_tokens: 10, output_tokens: 5 }),
  };
}

function createMockClient(responses: Response[]): Client {
  let callIdx = 0;
  return {
    complete: vi.fn().mockImplementation(async () => {
      const resp = responses[callIdx];
      callIdx++;
      if (!resp) throw new Error("No more mock responses");
      return resp;
    }),
    stream: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Client;
}

function createTestConfig(client: Client): SessionConfig {
  return {
    profile: createAnthropicProfile(),
    executionEnv: createMockEnv(),
    client,
    maxSubagentDepth: 1,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SubAgentManager", () => {
  it("should spawn a subagent", async () => {
    const client = createMockClient([textResponse("Subagent done")]);
    const config = createTestConfig(client);
    const manager = new SubAgentManager(config, 0);

    const handle = await manager.spawn({ task: "Write tests" });

    expect(handle.id).toBeTruthy();
    expect(handle.session).toBeDefined();
  });

  it("should wait for subagent completion", async () => {
    const client = createMockClient([textResponse("Task completed")]);
    const config = createTestConfig(client);
    const manager = new SubAgentManager(config, 0);

    const handle = await manager.spawn({ task: "Write tests" });
    const result = await manager.wait(handle.id);

    expect(result.success).toBe(true);
    expect(result.output).toBe("Task completed");
    expect(result.turnsUsed).toBeGreaterThan(0);
  });

  it("should close a subagent", async () => {
    const client = createMockClient([textResponse("Done")]);
    const config = createTestConfig(client);
    const manager = new SubAgentManager(config, 0);

    const handle = await manager.spawn({ task: "Run tests" });

    // Wait for it to complete first
    await manager.wait(handle.id);

    // Close should work without error
    manager.close(handle.id);
  });

  it("should enforce depth limiting", async () => {
    const client = createMockClient([textResponse("Done")]);
    const config = createTestConfig(client);
    // Current depth is already at max (1), so spawning should fail
    const manager = new SubAgentManager(config, 1);

    await expect(
      manager.spawn({ task: "Should fail" }),
    ).rejects.toThrow("maximum depth");
  });

  it("should allow spawning at depth 0 with maxDepth 1", async () => {
    const client = createMockClient([textResponse("Done")]);
    const config = createTestConfig(client);
    const manager = new SubAgentManager(config, 0);

    const handle = await manager.spawn({ task: "Should succeed" });
    expect(handle.id).toBeTruthy();
  });

  it("should throw for unknown agent on wait", async () => {
    const client = createMockClient([]);
    const config = createTestConfig(client);
    const manager = new SubAgentManager(config, 0);

    await expect(
      manager.wait("nonexistent"),
    ).rejects.toThrow("Unknown agent");
  });

  it("should throw for unknown agent on close", () => {
    const client = createMockClient([]);
    const config = createTestConfig(client);
    const manager = new SubAgentManager(config, 0);

    expect(() => manager.close("nonexistent")).toThrow("Unknown agent");
  });

  it("should throw for unknown agent on sendInput", async () => {
    const client = createMockClient([]);
    const config = createTestConfig(client);
    const manager = new SubAgentManager(config, 0);

    await expect(
      manager.sendInput("nonexistent", "hello"),
    ).rejects.toThrow("Unknown agent");
  });
});
