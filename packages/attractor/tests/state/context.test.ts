import { describe, it, expect } from "vitest";
import { Context } from "../../src/state/context.js";

describe("Context", () => {
  it("sets and gets values", () => {
    const ctx = new Context();
    ctx.set("key", "value");
    expect(ctx.get("key")).toBe("value");
  });

  it("returns undefined for missing keys without default", () => {
    const ctx = new Context();
    expect(ctx.get("missing")).toBeUndefined();
  });

  it("returns default value for missing keys", () => {
    const ctx = new Context();
    expect(ctx.get("missing", "fallback")).toBe("fallback");
  });

  it("getString returns string representation", () => {
    const ctx = new Context();
    ctx.set("num", 42);
    expect(ctx.getString("num")).toBe("42");
  });

  it("getString returns default for missing keys", () => {
    const ctx = new Context();
    expect(ctx.getString("missing")).toBe("");
    expect(ctx.getString("missing", "default")).toBe("default");
  });

  it("snapshot returns serializable copy", () => {
    const ctx = new Context();
    ctx.set("a", 1);
    ctx.set("b", "two");
    const snap = ctx.snapshot();
    expect(snap).toEqual({ a: 1, b: "two" });

    // Modifying snapshot does not affect context
    snap["c"] = 3;
    expect(ctx.has("c")).toBe(false);
  });

  it("clone creates an independent copy", () => {
    const ctx = new Context();
    ctx.set("shared", "original");
    ctx.appendLog("log1");

    const cloned = ctx.clone();
    cloned.set("shared", "modified");
    cloned.set("new_key", "new_value");
    cloned.appendLog("log2");

    // Original is unmodified
    expect(ctx.get("shared")).toBe("original");
    expect(ctx.has("new_key")).toBe(false);
    expect(ctx.getLogs()).toEqual(["log1"]);

    // Clone has its own state
    expect(cloned.get("shared")).toBe("modified");
    expect(cloned.get("new_key")).toBe("new_value");
    expect(cloned.getLogs()).toEqual(["log1", "log2"]);
  });

  it("applyUpdates merges key-value pairs", () => {
    const ctx = new Context();
    ctx.set("existing", "old");
    ctx.applyUpdates({ existing: "new", added: "yes" });

    expect(ctx.get("existing")).toBe("new");
    expect(ctx.get("added")).toBe("yes");
  });

  it("has checks key existence", () => {
    const ctx = new Context();
    ctx.set("present", true);
    expect(ctx.has("present")).toBe(true);
    expect(ctx.has("absent")).toBe(false);
  });

  it("delete removes a key", () => {
    const ctx = new Context();
    ctx.set("key", "value");
    expect(ctx.delete("key")).toBe(true);
    expect(ctx.has("key")).toBe(false);
    expect(ctx.delete("key")).toBe(false);
  });

  it("size returns the number of entries", () => {
    const ctx = new Context();
    expect(ctx.size).toBe(0);
    ctx.set("a", 1);
    ctx.set("b", 2);
    expect(ctx.size).toBe(2);
  });

  it("appendLog and getLogs work correctly", () => {
    const ctx = new Context();
    ctx.appendLog("entry1");
    ctx.appendLog("entry2");
    expect(ctx.getLogs()).toEqual(["entry1", "entry2"]);
  });

  it("handles built-in context keys", () => {
    const ctx = new Context();
    ctx.set("outcome", "success");
    ctx.set("preferred_label", "Approve");
    ctx.set("graph.goal", "Build feature");
    ctx.set("current_node", "plan");
    ctx.set("last_stage", "plan");
    ctx.set("last_response", "Response text...");
    ctx.set("internal.retry_count.plan", 2);

    expect(ctx.getString("outcome")).toBe("success");
    expect(ctx.getString("preferred_label")).toBe("Approve");
    expect(ctx.getString("graph.goal")).toBe("Build feature");
    expect(ctx.get<number>("internal.retry_count.plan")).toBe(2);
  });

  it("supports various value types", () => {
    const ctx = new Context();
    ctx.set("string", "hello");
    ctx.set("number", 42);
    ctx.set("boolean", true);
    ctx.set("null", null);
    ctx.set("array", [1, 2, 3]);
    ctx.set("object", { nested: true });

    expect(ctx.get("string")).toBe("hello");
    expect(ctx.get("number")).toBe(42);
    expect(ctx.get("boolean")).toBe(true);
    expect(ctx.get("null")).toBeNull();
    expect(ctx.get("array")).toEqual([1, 2, 3]);
    expect(ctx.get("object")).toEqual({ nested: true });
  });
});
