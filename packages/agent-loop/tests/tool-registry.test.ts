import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "../src/tool-registry.js";
import type { RegisteredTool, ExecutionEnvironment } from "../src/types.js";

function makeTool(name: string, description = "test"): RegisteredTool {
  return {
    definition: {
      name,
      description,
      parameters: { type: "object", properties: {} },
    },
    executor: async () => `result from ${name}`,
  };
}

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it("should register and retrieve a tool", () => {
    const tool = makeTool("read_file");
    registry.register(tool);
    expect(registry.get("read_file")).toBe(tool);
  });

  it("should return undefined for unknown tools", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("should override a tool with the same name (latest-wins)", () => {
    const tool1 = makeTool("shell", "original");
    const tool2 = makeTool("shell", "override");
    registry.register(tool1);
    registry.register(tool2);
    expect(registry.get("shell")?.definition.description).toBe("override");
  });

  it("should unregister a tool", () => {
    registry.register(makeTool("edit_file"));
    registry.unregister("edit_file");
    expect(registry.get("edit_file")).toBeUndefined();
  });

  it("should handle unregister of non-existent tool without error", () => {
    expect(() => registry.unregister("nope")).not.toThrow();
  });

  it("should return all definitions", () => {
    registry.register(makeTool("read_file"));
    registry.register(makeTool("write_file"));
    registry.register(makeTool("shell"));

    const defs = registry.definitions();
    expect(defs).toHaveLength(3);
    expect(defs.map((d) => d.name).sort()).toEqual([
      "read_file",
      "shell",
      "write_file",
    ]);
  });

  it("should return all names", () => {
    registry.register(makeTool("a"));
    registry.register(makeTool("b"));
    registry.register(makeTool("c"));

    expect(registry.names().sort()).toEqual(["a", "b", "c"]);
  });

  it("should return empty arrays when no tools registered", () => {
    expect(registry.definitions()).toEqual([]);
    expect(registry.names()).toEqual([]);
  });

  it("definitions should not include unregistered tools", () => {
    registry.register(makeTool("a"));
    registry.register(makeTool("b"));
    registry.unregister("a");

    expect(registry.names()).toEqual(["b"]);
    expect(registry.definitions()).toHaveLength(1);
  });
});
