/**
 * Integration smoke tests for @attractor/agent-loop.
 *
 * These tests use a mock LLM client (no real API calls) to verify that the
 * Session loop works end-to-end: user input -> LLM call -> tool execution ->
 * final text response.
 */

import { describe, it, expect, vi } from "vitest";
import { Session } from "../../src/session.js";
import type { SessionConfig } from "../../src/session.js";
import { createAnthropicProfile } from "../../src/profiles/anthropic.js";
import type { AgentEvent } from "../../src/events.js";
import type {
  ExecutionEnvironment,
  ExecResult,
} from "../../src/types.js";
import type { Client, Request, Response } from "@attractor/llm-client";
import { Usage, ContentKind, Role } from "@attractor/llm-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock execution environment that simulates file operations. */
function createMockEnv(): ExecutionEnvironment {
  const files = new Map<string, string>();

  return {
    readFile: vi.fn().mockImplementation(async (filePath: string) => {
      const content = files.get(filePath) ?? "";
      return content
        .split("\n")
        .map((line, i) => `${String(i + 1).padStart(3)} | ${line}`)
        .join("\n");
    }),
    readFileRaw: vi.fn().mockImplementation(async (filePath: string) => {
      return files.get(filePath) ?? "";
    }),
    writeFile: vi.fn().mockImplementation(async (filePath: string, content: string) => {
      files.set(filePath, content);
    }),
    fileExists: vi.fn().mockImplementation(async (filePath: string) => {
      return files.has(filePath);
    }),
    listDirectory: vi.fn().mockResolvedValue([]),
    execCommand: vi.fn().mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    } as ExecResult),
    grep: vi.fn().mockResolvedValue(""),
    glob: vi.fn().mockResolvedValue([]),
    workingDirectory: () => "/tmp/integration-test",
    platform: () => "linux",
  };
}

/** Create a mock Response containing only text (no tool calls). */
function textResponse(text: string): Response {
  return {
    id: `resp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

/** Create a mock Response containing tool calls. */
function toolCallResponse(
  calls: Array<{ name: string; args: Record<string, unknown> }>,
  text?: string,
): Response {
  const content: Response["message"]["content"][number][] = [];
  if (text) {
    content.push({ kind: ContentKind.TEXT, text });
  }
  for (let i = 0; i < calls.length; i++) {
    content.push({
      kind: ContentKind.TOOL_CALL,
      tool_call: {
        id: `call-${i}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: calls[i]!.name,
        arguments: calls[i]!.args,
      },
    });
  }
  return {
    id: `resp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    model: "claude-sonnet-4-5",
    provider: "anthropic",
    message: {
      role: Role.ASSISTANT,
      content,
    },
    finish_reason: { reason: "tool_calls" },
    usage: new Usage({ input_tokens: 10, output_tokens: 15 }),
  };
}

/** Create a mock LLM client that returns responses in sequence. */
function createMockClient(responses: Response[]): Client {
  let callIdx = 0;
  return {
    complete: vi.fn().mockImplementation(async () => {
      const resp = responses[callIdx];
      callIdx++;
      if (!resp) {
        throw new Error("No more mock responses");
      }
      return resp;
    }),
    stream: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Client;
}

/** Create a session config with mock client and env. */
function createSessionConfig(
  client: Client,
  overrides?: Partial<SessionConfig>,
): SessionConfig {
  return {
    profile: createAnthropicProfile(),
    executionEnv: createMockEnv(),
    client,
    maxToolRoundsPerInput: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Agent Loop integration smoke", () => {
  it("completes a simple text-only conversation", async () => {
    const client = createMockClient([
      textResponse("Hello! I can help you with that."),
    ]);
    const session = new Session(createSessionConfig(client));

    const events: AgentEvent[] = [];
    // Use onAny to capture all events (SESSION_START is emitted in the
    // constructor before we can attach, so we verify post-constructor events)
    session.events.onAny((e) => events.push(e));

    await session.processInput("Hello, can you help me?");

    // Session should complete with idle state
    expect(session.state).toBe("idle");

    // History should have user turn + assistant turn
    expect(session.history.length).toBe(2);
    expect(session.history[0]!.type).toBe("user");
    expect(session.history[1]!.type).toBe("assistant");
    expect((session.history[1] as { content: string }).content).toBe(
      "Hello! I can help you with that.",
    );

    // Should have emitted key events (SESSION_START fires in constructor
    // before our listener, so we check the others)
    const eventKinds = events.map((e) => e.kind);
    expect(eventKinds).toContain("USER_INPUT");
    expect(eventKinds).toContain("ASSISTANT_TEXT_END");
    expect(eventKinds).toContain("SESSION_END");
  });

  it("executes a tool call and completes", async () => {
    // LLM first calls write_file, then responds with text
    const client = createMockClient([
      toolCallResponse([
        {
          name: "write_file",
          args: { path: "/tmp/test/test.txt", content: "hello" },
        },
      ]),
      textResponse("Done! I created test.txt with content 'hello'."),
    ]);

    const mockEnv = createMockEnv();
    const session = new Session(
      createSessionConfig(client, { executionEnv: mockEnv }),
    );

    const events: AgentEvent[] = [];
    session.events.onAny((e) => events.push(e));

    await session.processInput(
      "Create a file called test.txt with content hello",
    );

    // Session should finish
    expect(session.state).toBe("idle");

    // History: user -> assistant (tool call) -> tool_results -> assistant (text)
    expect(session.history.length).toBe(4);
    expect(session.history[0]!.type).toBe("user");
    expect(session.history[1]!.type).toBe("assistant");
    expect(session.history[2]!.type).toBe("tool_results");
    expect(session.history[3]!.type).toBe("assistant");

    // Tool call events should have been emitted
    const eventKinds = events.map((e) => e.kind);
    expect(eventKinds).toContain("TOOL_CALL_START");
    expect(eventKinds).toContain("TOOL_CALL_END");
  });

  it("handles multiple sequential tool calls", async () => {
    // LLM calls write_file twice (sequentially), then responds with text
    const client = createMockClient([
      toolCallResponse([
        {
          name: "write_file",
          args: { path: "/tmp/test/file1.txt", content: "first" },
        },
      ]),
      toolCallResponse([
        {
          name: "write_file",
          args: { path: "/tmp/test/file2.txt", content: "second" },
        },
      ]),
      textResponse("Created both files successfully."),
    ]);

    const session = new Session(createSessionConfig(client));
    await session.processInput("Create two files");

    expect(session.state).toBe("idle");

    // History: user -> assistant -> tool_results -> assistant -> tool_results -> assistant
    expect(session.history.length).toBe(6);
    const types = session.history.map((t) => t.type);
    expect(types).toEqual([
      "user",
      "assistant",
      "tool_results",
      "assistant",
      "tool_results",
      "assistant",
    ]);
  });

  it("respects maxToolRoundsPerInput limit", async () => {
    // LLM keeps requesting tool calls forever -- should be capped
    const infiniteToolCalls: Response[] = Array.from({ length: 10 }, () =>
      toolCallResponse([
        {
          name: "read_file",
          args: { path: "/tmp/test/loop.txt" },
        },
      ]),
    );

    const client = createMockClient(infiniteToolCalls);
    const session = new Session(
      createSessionConfig(client, { maxToolRoundsPerInput: 3 }),
    );

    const events: AgentEvent[] = [];
    session.events.onAny((e) => events.push(e));

    await session.processInput("Read files in a loop");

    // Should hit the limit after 3 tool rounds
    const toolCallEvents = events.filter(
      (e) => e.kind === "TOOL_CALL_START",
    );
    expect(toolCallEvents.length).toBe(3);
  });

  it("emits error event on LLM failure", async () => {
    const client = {
      complete: vi.fn().mockRejectedValue(new Error("API key invalid")),
      stream: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Client;

    const session = new Session(createSessionConfig(client));

    const events: AgentEvent[] = [];
    session.events.onAny((e) => events.push(e));

    await session.processInput("This should fail");

    // Session should be closed due to error
    expect(session.state).toBe("closed");

    const errorEvents = events.filter((e) => e.kind === "ERROR");
    expect(errorEvents.length).toBe(1);
  });

  it("supports steering messages", async () => {
    const client = createMockClient([
      toolCallResponse([
        {
          name: "read_file",
          args: { path: "/tmp/test/data.txt" },
        },
      ]),
      textResponse("Understood. I will take a different approach."),
    ]);

    const session = new Session(createSessionConfig(client));

    // Queue a steering message before processing
    session.steer("Focus on performance optimization only.");

    await session.processInput("Review the codebase");

    expect(session.state).toBe("idle");

    // The steering message should appear in history
    const steeringTurns = session.history.filter(
      (t) => t.type === "steering",
    );
    expect(steeringTurns.length).toBeGreaterThan(0);
  });

  it("handles abort during LLM call", async () => {
    // Abort is triggered during the LLM call itself
    let session: Session;
    const client = {
      complete: vi.fn().mockImplementation(async () => {
        // Abort during the LLM call
        session.abort();
        return toolCallResponse([
          {
            name: "read_file",
            args: { path: "/tmp/test/data.txt" },
          },
        ]);
      }),
      stream: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Client;

    session = new Session(createSessionConfig(client));

    await session.processInput("Do something");

    // After abort during LLM call, state should be closed
    expect(session.state).toBe("closed");
    // Should have been called once (abort stops the loop after first response)
    expect(client.complete).toHaveBeenCalledTimes(1);
  });
});
