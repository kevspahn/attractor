/**
 * Tests for the EventEmitter and event system.
 */

import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "../src/events.js";
import type { AgentEvent, EventKind } from "../src/events.js";

describe("EventEmitter", () => {
  it("should emit events to specific listeners", () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();

    emitter.on("SESSION_START", handler);
    const event: AgentEvent = {
      kind: "SESSION_START",
      timestamp: Date.now(),
    };
    emitter.emit(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("should not emit events to non-matching listeners", () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();

    emitter.on("SESSION_START", handler);
    emitter.emit({
      kind: "SESSION_END",
      timestamp: Date.now(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("should support multiple listeners for the same event", () => {
    const emitter = new EventEmitter();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    emitter.on("USER_INPUT", handler1);
    emitter.on("USER_INPUT", handler2);
    emitter.emit({ kind: "USER_INPUT", timestamp: Date.now() });

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it("should deliver events to onAny handlers", () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();

    emitter.onAny(handler);

    emitter.emit({ kind: "SESSION_START", timestamp: Date.now() });
    emitter.emit({ kind: "USER_INPUT", timestamp: Date.now() });
    emitter.emit({ kind: "SESSION_END", timestamp: Date.now() });

    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("should deliver events to both specific and onAny handlers", () => {
    const emitter = new EventEmitter();
    const specificHandler = vi.fn();
    const anyHandler = vi.fn();

    emitter.on("USER_INPUT", specificHandler);
    emitter.onAny(anyHandler);

    emitter.emit({ kind: "USER_INPUT", timestamp: Date.now() });

    expect(specificHandler).toHaveBeenCalledTimes(1);
    expect(anyHandler).toHaveBeenCalledTimes(1);
  });

  it("should include event data", () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();

    emitter.on("TOOL_CALL_START", handler);
    const event: AgentEvent = {
      kind: "TOOL_CALL_START",
      timestamp: Date.now(),
      data: { toolName: "read_file", callId: "call-1" },
    };
    emitter.emit(event);

    expect(handler).toHaveBeenCalledWith(event);
    expect((handler.mock.calls[0]![0] as AgentEvent).data).toEqual({
      toolName: "read_file",
      callId: "call-1",
    });
  });

  it("should clear all listeners with removeAllListeners", () => {
    const emitter = new EventEmitter();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const anyHandler = vi.fn();

    emitter.on("SESSION_START", handler1);
    emitter.on("SESSION_END", handler2);
    emitter.onAny(anyHandler);

    emitter.removeAllListeners();

    emitter.emit({ kind: "SESSION_START", timestamp: Date.now() });
    emitter.emit({ kind: "SESSION_END", timestamp: Date.now() });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
    expect(anyHandler).not.toHaveBeenCalled();
  });

  it("should handle emit with no listeners", () => {
    const emitter = new EventEmitter();
    // Should not throw
    emitter.emit({ kind: "ERROR", timestamp: Date.now() });
  });
});
