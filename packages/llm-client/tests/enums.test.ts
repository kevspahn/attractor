import { describe, it, expect } from "vitest";
import { Role, ContentKind, StreamEventType } from "../src/types/enums.js";

describe("Role", () => {
  it("has all five role values as correct strings", () => {
    expect(Role.SYSTEM).toBe("system");
    expect(Role.USER).toBe("user");
    expect(Role.ASSISTANT).toBe("assistant");
    expect(Role.TOOL).toBe("tool");
    expect(Role.DEVELOPER).toBe("developer");
  });

  it("has exactly five members", () => {
    expect(Object.keys(Role)).toHaveLength(5);
  });
});

describe("ContentKind", () => {
  it("has all content kind values as correct strings", () => {
    expect(ContentKind.TEXT).toBe("text");
    expect(ContentKind.IMAGE).toBe("image");
    expect(ContentKind.AUDIO).toBe("audio");
    expect(ContentKind.DOCUMENT).toBe("document");
    expect(ContentKind.TOOL_CALL).toBe("tool_call");
    expect(ContentKind.TOOL_RESULT).toBe("tool_result");
    expect(ContentKind.THINKING).toBe("thinking");
    expect(ContentKind.REDACTED_THINKING).toBe("redacted_thinking");
  });

  it("has exactly eight members", () => {
    expect(Object.keys(ContentKind)).toHaveLength(8);
  });
});

describe("StreamEventType", () => {
  it("has all stream event type values as correct strings", () => {
    expect(StreamEventType.STREAM_START).toBe("stream_start");
    expect(StreamEventType.TEXT_START).toBe("text_start");
    expect(StreamEventType.TEXT_DELTA).toBe("text_delta");
    expect(StreamEventType.TEXT_END).toBe("text_end");
    expect(StreamEventType.REASONING_START).toBe("reasoning_start");
    expect(StreamEventType.REASONING_DELTA).toBe("reasoning_delta");
    expect(StreamEventType.REASONING_END).toBe("reasoning_end");
    expect(StreamEventType.TOOL_CALL_START).toBe("tool_call_start");
    expect(StreamEventType.TOOL_CALL_DELTA).toBe("tool_call_delta");
    expect(StreamEventType.TOOL_CALL_END).toBe("tool_call_end");
    expect(StreamEventType.FINISH).toBe("finish");
    expect(StreamEventType.ERROR).toBe("error");
    expect(StreamEventType.PROVIDER_EVENT).toBe("provider_event");
  });

  it("has exactly thirteen members", () => {
    expect(Object.keys(StreamEventType)).toHaveLength(13);
  });
});
