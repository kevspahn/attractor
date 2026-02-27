import { describe, it, expect } from "vitest";
import {
  createSystemMessage,
  createUserMessage,
  createAssistantMessage,
  createToolResultMessage,
  getMessageText,
  getMessageToolCalls,
} from "../src/types/message.js";
import { Role, ContentKind } from "../src/types/enums.js";
import type { Message } from "../src/types/message.js";

describe("createSystemMessage", () => {
  it("creates a message with SYSTEM role and TEXT content", () => {
    const msg = createSystemMessage("You are a helpful assistant.");
    expect(msg.role).toBe(Role.SYSTEM);
    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]!.kind).toBe(ContentKind.TEXT);
    if (msg.content[0]!.kind === ContentKind.TEXT) {
      expect(msg.content[0]!.text).toBe("You are a helpful assistant.");
    }
  });
});

describe("createUserMessage", () => {
  it("creates a message with USER role and TEXT content", () => {
    const msg = createUserMessage("What is 2 + 2?");
    expect(msg.role).toBe(Role.USER);
    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]!.kind).toBe(ContentKind.TEXT);
    if (msg.content[0]!.kind === ContentKind.TEXT) {
      expect(msg.content[0]!.text).toBe("What is 2 + 2?");
    }
  });
});

describe("createAssistantMessage", () => {
  it("creates a message with ASSISTANT role and TEXT content", () => {
    const msg = createAssistantMessage("The answer is 4.");
    expect(msg.role).toBe(Role.ASSISTANT);
    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]!.kind).toBe(ContentKind.TEXT);
    if (msg.content[0]!.kind === ContentKind.TEXT) {
      expect(msg.content[0]!.text).toBe("The answer is 4.");
    }
  });
});

describe("createToolResultMessage", () => {
  it("creates a TOOL message with tool_result content and tool_call_id", () => {
    const msg = createToolResultMessage("call_123", "72F and sunny");
    expect(msg.role).toBe(Role.TOOL);
    expect(msg.tool_call_id).toBe("call_123");
    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]!.kind).toBe(ContentKind.TOOL_RESULT);
    if (msg.content[0]!.kind === ContentKind.TOOL_RESULT) {
      expect(msg.content[0]!.tool_result.tool_call_id).toBe("call_123");
      expect(msg.content[0]!.tool_result.content).toBe("72F and sunny");
      expect(msg.content[0]!.tool_result.is_error).toBe(false);
    }
  });

  it("creates an error tool result when is_error is true", () => {
    const msg = createToolResultMessage("call_456", "Connection refused", true);
    if (msg.content[0]!.kind === ContentKind.TOOL_RESULT) {
      expect(msg.content[0]!.tool_result.is_error).toBe(true);
    }
  });
});

describe("getMessageText", () => {
  it("concatenates text from all TEXT content parts", () => {
    const msg: Message = {
      role: Role.ASSISTANT,
      content: [
        { kind: ContentKind.TEXT, text: "Hello " },
        { kind: ContentKind.TEXT, text: "world" },
      ],
    };
    expect(getMessageText(msg)).toBe("Hello world");
  });

  it("returns empty string when no text parts exist", () => {
    const msg: Message = {
      role: Role.ASSISTANT,
      content: [
        {
          kind: ContentKind.THINKING,
          thinking: { text: "Let me think...", redacted: false },
        },
      ],
    };
    expect(getMessageText(msg)).toBe("");
  });

  it("ignores non-text content parts", () => {
    const msg: Message = {
      role: Role.ASSISTANT,
      content: [
        {
          kind: ContentKind.THINKING,
          thinking: { text: "reasoning...", redacted: false },
        },
        { kind: ContentKind.TEXT, text: "The answer is 42." },
        {
          kind: ContentKind.TOOL_CALL,
          tool_call: {
            id: "c1",
            name: "foo",
            arguments: {},
            type: "function",
          },
        },
      ],
    };
    expect(getMessageText(msg)).toBe("The answer is 42.");
  });
});

describe("getMessageToolCalls", () => {
  it("extracts tool calls from content parts", () => {
    const msg: Message = {
      role: Role.ASSISTANT,
      content: [
        { kind: ContentKind.TEXT, text: "Let me check." },
        {
          kind: ContentKind.TOOL_CALL,
          tool_call: {
            id: "call_1",
            name: "get_weather",
            arguments: { location: "SF" },
            type: "function",
          },
        },
      ],
    };
    const calls = getMessageToolCalls(msg);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.id).toBe("call_1");
    expect(calls[0]!.name).toBe("get_weather");
    expect(calls[0]!.arguments).toEqual({ location: "SF" });
  });

  it("parses string arguments into objects", () => {
    const msg: Message = {
      role: Role.ASSISTANT,
      content: [
        {
          kind: ContentKind.TOOL_CALL,
          tool_call: {
            id: "call_2",
            name: "search",
            arguments: '{"query":"test"}',
            type: "function",
          },
        },
      ],
    };
    const calls = getMessageToolCalls(msg);
    expect(calls[0]!.arguments).toEqual({ query: "test" });
    expect(calls[0]!.raw_arguments).toBe('{"query":"test"}');
  });

  it("returns empty array when no tool calls exist", () => {
    const msg = createUserMessage("hello");
    expect(getMessageToolCalls(msg)).toEqual([]);
  });
});
