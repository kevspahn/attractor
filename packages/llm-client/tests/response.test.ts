import { describe, it, expect } from "vitest";
import {
  Usage,
  getResponseText,
  getResponseToolCalls,
  getResponseReasoning,
} from "../src/types/response.js";
import type { Response } from "../src/types/response.js";
import { Role, ContentKind } from "../src/types/enums.js";

describe("Usage", () => {
  it("computes total_tokens automatically if not provided", () => {
    const u = new Usage({ input_tokens: 100, output_tokens: 50 });
    expect(u.total_tokens).toBe(150);
  });

  it("uses explicit total_tokens when provided", () => {
    const u = new Usage({
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 200,
    });
    expect(u.total_tokens).toBe(200);
  });

  describe("add()", () => {
    it("sums required integer fields", () => {
      const a = new Usage({ input_tokens: 100, output_tokens: 50 });
      const b = new Usage({ input_tokens: 200, output_tokens: 80 });
      const sum = a.add(b);
      expect(sum.input_tokens).toBe(300);
      expect(sum.output_tokens).toBe(130);
      expect(sum.total_tokens).toBe(430);
    });

    it("handles None + number for optional fields (treats None as 0)", () => {
      const a = new Usage({
        input_tokens: 100,
        output_tokens: 50,
        reasoning_tokens: undefined,
      });
      const b = new Usage({
        input_tokens: 200,
        output_tokens: 80,
        reasoning_tokens: 30,
      });
      const sum = a.add(b);
      expect(sum.reasoning_tokens).toBe(30);
    });

    it("handles number + None for optional fields (treats None as 0)", () => {
      const a = new Usage({
        input_tokens: 100,
        output_tokens: 50,
        cache_read_tokens: 20,
      });
      const b = new Usage({
        input_tokens: 200,
        output_tokens: 80,
        cache_read_tokens: undefined,
      });
      const sum = a.add(b);
      expect(sum.cache_read_tokens).toBe(20);
    });

    it("returns undefined when both sides are undefined for optional fields", () => {
      const a = new Usage({ input_tokens: 100, output_tokens: 50 });
      const b = new Usage({ input_tokens: 200, output_tokens: 80 });
      const sum = a.add(b);
      expect(sum.reasoning_tokens).toBeUndefined();
      expect(sum.cache_read_tokens).toBeUndefined();
      expect(sum.cache_write_tokens).toBeUndefined();
    });

    it("sums number + number for optional fields", () => {
      const a = new Usage({
        input_tokens: 100,
        output_tokens: 50,
        reasoning_tokens: 10,
        cache_read_tokens: 5,
        cache_write_tokens: 3,
      });
      const b = new Usage({
        input_tokens: 200,
        output_tokens: 80,
        reasoning_tokens: 20,
        cache_read_tokens: 15,
        cache_write_tokens: 7,
      });
      const sum = a.add(b);
      expect(sum.reasoning_tokens).toBe(30);
      expect(sum.cache_read_tokens).toBe(20);
      expect(sum.cache_write_tokens).toBe(10);
    });
  });
});

describe("getResponseText", () => {
  it("concatenates text from response message", () => {
    const response: Response = {
      id: "r1",
      model: "test-model",
      provider: "test",
      message: {
        role: Role.ASSISTANT,
        content: [
          { kind: ContentKind.TEXT, text: "Hello " },
          { kind: ContentKind.TEXT, text: "world!" },
        ],
      },
      finish_reason: { reason: "stop" },
      usage: new Usage({ input_tokens: 10, output_tokens: 5 }),
    };
    expect(getResponseText(response)).toBe("Hello world!");
  });
});

describe("getResponseToolCalls", () => {
  it("extracts tool calls from response message", () => {
    const response: Response = {
      id: "r2",
      model: "test-model",
      provider: "test",
      message: {
        role: Role.ASSISTANT,
        content: [
          {
            kind: ContentKind.TOOL_CALL,
            tool_call: {
              id: "tc1",
              name: "get_weather",
              arguments: { location: "NYC" },
              type: "function",
            },
          },
        ],
      },
      finish_reason: { reason: "tool_calls" },
      usage: new Usage({ input_tokens: 10, output_tokens: 5 }),
    };
    const calls = getResponseToolCalls(response);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("get_weather");
    expect(calls[0]!.arguments).toEqual({ location: "NYC" });
  });
});

describe("getResponseReasoning", () => {
  it("concatenates reasoning text from thinking content parts", () => {
    const response: Response = {
      id: "r3",
      model: "test-model",
      provider: "test",
      message: {
        role: Role.ASSISTANT,
        content: [
          {
            kind: ContentKind.THINKING,
            thinking: {
              text: "Let me think... ",
              redacted: false,
            },
          },
          {
            kind: ContentKind.THINKING,
            thinking: {
              text: "The answer should be 42.",
              redacted: false,
            },
          },
          { kind: ContentKind.TEXT, text: "The answer is 42." },
        ],
      },
      finish_reason: { reason: "stop" },
      usage: new Usage({ input_tokens: 10, output_tokens: 20 }),
    };
    expect(getResponseReasoning(response)).toBe(
      "Let me think... The answer should be 42.",
    );
  });

  it("returns undefined when no thinking parts exist", () => {
    const response: Response = {
      id: "r4",
      model: "test-model",
      provider: "test",
      message: {
        role: Role.ASSISTANT,
        content: [{ kind: ContentKind.TEXT, text: "Simple answer." }],
      },
      finish_reason: { reason: "stop" },
      usage: new Usage({ input_tokens: 10, output_tokens: 5 }),
    };
    expect(getResponseReasoning(response)).toBeUndefined();
  });
});
