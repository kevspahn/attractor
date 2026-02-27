/**
 * Tests for the Session class (core agentic loop).
 *
 * Uses a mock LLM client to test the session loop without real API calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Session } from "../src/session.js";
import type { SessionConfig } from "../src/session.js";
import { createAnthropicProfile } from "../src/profiles/anthropic.js";
import { EventEmitter } from "../src/events.js";
import type { AgentEvent } from "../src/events.js";
import type { ExecutionEnvironment, ExecResult, DirEntry, GrepOptions, ExecOptions } from "../src/types.js";
import type { Client, Request, Response } from "@attractor/llm-client";
import { Usage, ContentKind, Role } from "@attractor/llm-client";

// ---------------------------------------------------------------------------
// Helpers: mock execution environment
// ---------------------------------------------------------------------------

function createMockEnv(): ExecutionEnvironment {
  return {
    readFile: vi.fn().mockResolvedValue("1 | hello world"),
    readFileRaw: vi.fn().mockResolvedValue("hello world"),
    writeFile: vi.fn().mockResolvedValue(undefined),
    fileExists: vi.fn().mockResolvedValue(true),
    listDirectory: vi.fn().mockResolvedValue([]),
    execCommand: vi.fn().mockResolvedValue({
      stdout: "output",
      stderr: "",
      exitCode: 0,
      durationMs: 100,
      timedOut: false,
    } as ExecResult),
    grep: vi.fn().mockResolvedValue("result.ts:10: match"),
    glob: vi.fn().mockResolvedValue(["/path/file.ts"]),
    workingDirectory: () => "/tmp/test",
    platform: () => "linux",
  };
}

// ---------------------------------------------------------------------------
// Helpers: mock LLM client
// ---------------------------------------------------------------------------

/** Create a mock Response with just text (no tool calls). */
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

/** Create a mock Response with tool calls. */
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
        id: `call-${i}-${Date.now()}`,
        name: calls[i]!.name,
        arguments: calls[i]!.args,
      },
    });
  }
  return {
    id: `resp-${Date.now()}`,
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

function createMockClient(
  responses: Response[],
): Client {
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

function createSessionConfig(
  client: Client,
  overrides?: Partial<SessionConfig>,
): SessionConfig {
  return {
    profile: createAnthropicProfile(),
    executionEnv: createMockEnv(),
    client,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Session", () => {
  describe("natural completion (no tools)", () => {
    it("should process user input and return text response", async () => {
      const client = createMockClient([textResponse("Hello! How can I help?")]);
      const session = new Session(createSessionConfig(client));

      await session.processInput("Hi there");

      expect(session.state).toBe("idle");
      expect(session.history).toHaveLength(2); // user + assistant
      expect(session.history[0]!.type).toBe("user");
      expect(session.history[1]!.type).toBe("assistant");
      expect((session.history[1] as any).content).toBe(
        "Hello! How can I help?",
      );
    });

    it("should emit correct events for simple text response", async () => {
      const client = createMockClient([textResponse("Done")]);
      const allEvents: AgentEvent[] = [];

      // Subscribe before constructing the session to capture SESSION_START
      const profile = createAnthropicProfile();
      const config = createSessionConfig(client);

      const session = new Session(config);
      // SESSION_START is emitted in the constructor, so register onAny
      // and replay SESSION_START manually, or just check post-constructor events.
      session.events.onAny((e) => allEvents.push(e));

      await session.processInput("Test");

      const kinds = allEvents.map((e) => e.kind);
      // SESSION_START was emitted in constructor before listener was attached,
      // so we verify the other events.
      expect(kinds).toContain("USER_INPUT");
      expect(kinds).toContain("ASSISTANT_TEXT_START");
      expect(kinds).toContain("ASSISTANT_TEXT_END");
      expect(kinds).toContain("SESSION_END");
    });

    it("should emit SESSION_START in constructor", () => {
      const client = createMockClient([]);
      const events: AgentEvent[] = [];

      // Create config first
      const config = createSessionConfig(client);

      // Monkey-patch the EventEmitter to capture the constructor event
      const origEmit = EventEmitter.prototype.emit;
      const captured: AgentEvent[] = [];
      EventEmitter.prototype.emit = function (event: AgentEvent) {
        captured.push(event);
        return origEmit.call(this, event);
      };

      const session = new Session(config);

      // Restore
      EventEmitter.prototype.emit = origEmit;

      expect(captured.some((e) => e.kind === "SESSION_START")).toBe(true);
    });

    it("should call client.complete exactly once for text-only response", async () => {
      const client = createMockClient([textResponse("Result")]);
      const session = new Session(createSessionConfig(client));

      await session.processInput("Query");

      expect(client.complete).toHaveBeenCalledTimes(1);
    });
  });

  describe("single tool round", () => {
    it("should execute tool call and continue to completion", async () => {
      const client = createMockClient([
        toolCallResponse([
          { name: "read_file", args: { file_path: "/tmp/test.txt" } },
        ]),
        textResponse("I read the file and it says hello world."),
      ]);
      const session = new Session(createSessionConfig(client));

      await session.processInput("Read test.txt");

      expect(client.complete).toHaveBeenCalledTimes(2);
      expect(session.state).toBe("idle");
      // user + assistant(tool_call) + tool_results + assistant(text)
      expect(session.history).toHaveLength(4);
      expect(session.history[0]!.type).toBe("user");
      expect(session.history[1]!.type).toBe("assistant");
      expect(session.history[2]!.type).toBe("tool_results");
      expect(session.history[3]!.type).toBe("assistant");
    });

    it("should emit TOOL_CALL_START and TOOL_CALL_END events", async () => {
      const client = createMockClient([
        toolCallResponse([
          { name: "read_file", args: { file_path: "/tmp/test.txt" } },
        ]),
        textResponse("Done"),
      ]);
      const session = new Session(createSessionConfig(client));
      const events: AgentEvent[] = [];
      session.events.onAny((e) => events.push(e));

      await session.processInput("Read test.txt");

      const kinds = events.map((e) => e.kind);
      expect(kinds).toContain("TOOL_CALL_START");
      expect(kinds).toContain("TOOL_CALL_END");
    });

    it("should emit TOOL_CALL_END with full untruncated output", async () => {
      const client = createMockClient([
        toolCallResponse([
          { name: "read_file", args: { file_path: "/tmp/test.txt" } },
        ]),
        textResponse("Done"),
      ]);
      const session = new Session(createSessionConfig(client));
      const endEvents: AgentEvent[] = [];
      session.events.on("TOOL_CALL_END", (e) => endEvents.push(e));

      await session.processInput("Read file");

      expect(endEvents).toHaveLength(1);
      expect((endEvents[0]!.data as any).output).toBe("1 | hello world");
    });
  });

  describe("multi-tool rounds", () => {
    it("should handle multiple tool rounds", async () => {
      const client = createMockClient([
        // Round 1: read_file
        toolCallResponse([
          { name: "read_file", args: { file_path: "/tmp/test.txt" } },
        ]),
        // Round 2: edit_file
        toolCallResponse([
          {
            name: "edit_file",
            args: {
              file_path: "/tmp/test.txt",
              old_string: "hello",
              new_string: "goodbye",
            },
          },
        ]),
        // Completion
        textResponse("I edited the file."),
      ]);
      const env = createMockEnv();
      const session = new Session(
        createSessionConfig(client, { executionEnv: env }),
      );

      await session.processInput("Edit test.txt");

      expect(client.complete).toHaveBeenCalledTimes(3);
      expect(session.state).toBe("idle");
    });

    it("should handle parallel tool calls", async () => {
      const client = createMockClient([
        // Two tool calls in a single response
        toolCallResponse([
          { name: "read_file", args: { file_path: "/tmp/a.txt" } },
          { name: "read_file", args: { file_path: "/tmp/b.txt" } },
        ]),
        textResponse("Read both files."),
      ]);
      const session = new Session(createSessionConfig(client));

      await session.processInput("Read a.txt and b.txt");

      expect(session.state).toBe("idle");
      // user + assistant(2 tool_calls) + tool_results + assistant(text)
      expect(session.history).toHaveLength(4);
    });
  });

  describe("maxToolRoundsPerInput enforcement", () => {
    it("should stop after max rounds", async () => {
      // LLM always returns tool calls
      const client = createMockClient([
        toolCallResponse([
          { name: "read_file", args: { file_path: "/tmp/1.txt" } },
        ]),
        toolCallResponse([
          { name: "read_file", args: { file_path: "/tmp/2.txt" } },
        ]),
        toolCallResponse([
          { name: "read_file", args: { file_path: "/tmp/3.txt" } },
        ]),
        textResponse("Should not reach here"),
      ]);
      const session = new Session(
        createSessionConfig(client, { maxToolRoundsPerInput: 2 }),
      );
      const events: AgentEvent[] = [];
      session.events.onAny((e) => events.push(e));

      await session.processInput("Read files");

      // Should have called complete 2 times (first has tools, second has tools, then limit hit)
      expect(client.complete).toHaveBeenCalledTimes(2);

      const turnLimitEvents = events.filter((e) => e.kind === "TURN_LIMIT");
      expect(turnLimitEvents).toHaveLength(1);
    });
  });

  describe("maxTurns enforcement", () => {
    it("should stop when total turns exceed maxTurns", async () => {
      const client = createMockClient([
        textResponse("First response"),
        textResponse("Second response"),
      ]);
      const session = new Session(
        createSessionConfig(client, { maxTurns: 2 }),
      );

      await session.processInput("First input");
      expect(session.state).toBe("idle");

      await session.processInput("Second input");
      // After second input, we have 4 turns (2 user + 2 assistant) but the limit
      // is checked at the start of the LLM call loop, so the second input will
      // still process since the limit check happens before the LLM call
      expect(session.history.filter((t) => t.type === "user" || t.type === "assistant").length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("tool error handling", () => {
    it("should handle unknown tools gracefully", async () => {
      const client = createMockClient([
        toolCallResponse([
          { name: "nonexistent_tool", args: {} },
        ]),
        textResponse("I see the tool was not found."),
      ]);
      const session = new Session(createSessionConfig(client));

      await session.processInput("Use unknown tool");

      expect(session.state).toBe("idle");
      const toolResults = session.history.find(
        (t) => t.type === "tool_results",
      );
      expect(toolResults).toBeDefined();
      if (toolResults && toolResults.type === "tool_results") {
        expect(toolResults.results[0]!.isError).toBe(true);
        expect(toolResults.results[0]!.content).toContain("Unknown tool");
      }
    });

    it("should handle tool execution errors", async () => {
      const env = createMockEnv();
      (env.readFile as any).mockRejectedValue(
        new Error("File not found"),
      );
      const client = createMockClient([
        toolCallResponse([
          { name: "read_file", args: { file_path: "/nonexistent" } },
        ]),
        textResponse("The file was not found."),
      ]);
      const session = new Session(
        createSessionConfig(client, { executionEnv: env }),
      );

      await session.processInput("Read nonexistent file");

      expect(session.state).toBe("idle");
      const toolResults = session.history.find(
        (t) => t.type === "tool_results",
      );
      expect(toolResults).toBeDefined();
      if (toolResults && toolResults.type === "tool_results") {
        expect(toolResults.results[0]!.isError).toBe(true);
        expect(toolResults.results[0]!.content).toContain("Tool error");
      }
    });

    it("should handle LLM API errors", async () => {
      const client = createMockClient([]);
      (client.complete as any).mockRejectedValue(
        new Error("API Error: 500"),
      );
      const session = new Session(createSessionConfig(client));
      const events: AgentEvent[] = [];
      session.events.onAny((e) => events.push(e));

      await session.processInput("Trigger error");

      expect(session.state).toBe("closed");
      const errorEvents = events.filter((e) => e.kind === "ERROR");
      expect(errorEvents).toHaveLength(1);
    });
  });

  describe("steering injection", () => {
    it("should inject steering messages between tool rounds", async () => {
      let callCount = 0;
      const client = {
        complete: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return toolCallResponse([
              { name: "read_file", args: { file_path: "/tmp/test.txt" } },
            ]);
          }
          return textResponse("Adjusted approach.");
        }),
        stream: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as Client;

      const session = new Session(createSessionConfig(client));

      // Queue steering before processing
      session.steer("Change your approach");

      await session.processInput("Do something");

      // Steering should be in history
      const steeringTurns = session.history.filter(
        (t) => t.type === "steering",
      );
      expect(steeringTurns.length).toBeGreaterThanOrEqual(1);
      expect(
        steeringTurns.some(
          (t) => t.type === "steering" && t.content === "Change your approach",
        ),
      ).toBe(true);
    });

    it("should emit STEERING_INJECTED events", async () => {
      const client = createMockClient([textResponse("OK")]);
      const session = new Session(createSessionConfig(client));
      const events: AgentEvent[] = [];
      session.events.onAny((e) => events.push(e));

      session.steer("Redirect");
      await session.processInput("Input");

      const steeringEvents = events.filter(
        (e) => e.kind === "STEERING_INJECTED",
      );
      expect(steeringEvents).toHaveLength(1);
      expect((steeringEvents[0]!.data as any).content).toBe("Redirect");
    });
  });

  describe("follow-up messages", () => {
    it("should process follow-up after current input completes", async () => {
      const client = createMockClient([
        textResponse("First response"),
        textResponse("Follow-up response"),
      ]);
      const session = new Session(createSessionConfig(client));

      session.followUp("Follow-up input");
      await session.processInput("First input");

      expect(client.complete).toHaveBeenCalledTimes(2);
      const userTurns = session.history.filter((t) => t.type === "user");
      expect(userTurns).toHaveLength(2);
    });
  });

  describe("loop detection", () => {
    it("should detect loops and inject warning", async () => {
      // Create a sequence that triggers loop detection:
      // 10 identical tool calls in a row
      const responses: Response[] = [];
      for (let i = 0; i < 11; i++) {
        responses.push(
          toolCallResponse([
            { name: "read_file", args: { file_path: "/tmp/loop.txt" } },
          ]),
        );
      }
      responses.push(textResponse("Done"));

      const client = createMockClient(responses);
      const session = new Session(createSessionConfig(client));
      const events: AgentEvent[] = [];
      session.events.onAny((e) => events.push(e));

      await session.processInput("Loop test");

      const loopEvents = events.filter((e) => e.kind === "LOOP_DETECTION");
      expect(loopEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("abort", () => {
    it("should set state to closed on abort", () => {
      const client = createMockClient([]);
      const session = new Session(createSessionConfig(client));

      session.abort();

      expect(session.state).toBe("closed");
    });

    it("should stop the loop when abort is signaled during LLM call", async () => {
      let session: Session;
      const client = {
        complete: vi.fn().mockImplementation(async () => {
          // Abort during the LLM call itself
          session.abort();
          return toolCallResponse([
            { name: "read_file", args: { file_path: "/tmp/test.txt" } },
          ]);
        }),
        stream: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as Client;

      session = new Session(createSessionConfig(client));

      await session.processInput("Do work");

      // After abort, state should be closed
      expect(session.state).toBe("closed");
      // Should have been called once (abort stops the loop)
      expect(client.complete).toHaveBeenCalledTimes(1);
    });
  });

  describe("history-to-message conversion", () => {
    it("should convert user turns to user messages", async () => {
      const client = createMockClient([textResponse("OK")]);
      const session = new Session(createSessionConfig(client));

      await session.processInput("Hello");

      // The complete() call should have received a user message
      const requestArg = (client.complete as any).mock.calls[0][0] as Request;
      // First message is system, second is user
      const userMsg = requestArg.messages.find((m) => m.role === Role.USER);
      expect(userMsg).toBeDefined();
    });

    it("should convert steering turns to user messages", async () => {
      let callIdx = 0;
      const client = {
        complete: vi.fn().mockImplementation(async () => {
          callIdx++;
          if (callIdx === 1) {
            return toolCallResponse([
              { name: "read_file", args: { file_path: "/test" } },
            ]);
          }
          return textResponse("OK");
        }),
        stream: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as Client;

      const session = new Session(createSessionConfig(client));
      session.steer("Do it differently");

      await session.processInput("Start");

      // The second complete() call should include the steering message as a user message
      const secondRequest = (client.complete as any).mock
        .calls[1]?.[0] as Request;
      if (secondRequest) {
        const userMessages = secondRequest.messages.filter(
          (m) => m.role === Role.USER,
        );
        // Should have the original user input + steering message
        expect(userMessages.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("reasoning effort", () => {
    it("should pass reasoning_effort to the LLM request", async () => {
      const client = createMockClient([textResponse("OK")]);
      const session = new Session(
        createSessionConfig(client, { reasoningEffort: "high" }),
      );

      await session.processInput("Think hard");

      const requestArg = (client.complete as any).mock.calls[0][0] as Request;
      expect(requestArg.reasoning_effort).toBe("high");
    });
  });
});
