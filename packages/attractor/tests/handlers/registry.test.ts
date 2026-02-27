import { describe, it, expect } from "vitest";
import { HandlerRegistry, SHAPE_TO_TYPE } from "../../src/handlers/registry.js";
import type { Handler } from "../../src/handlers/handler.js";
import type { Node } from "../../src/parser/types.js";
import { createDefaultNode } from "../../src/parser/types.js";
import { StageStatus } from "../../src/state/outcome.js";

/** A simple mock handler for tests */
function mockHandler(name: string): Handler {
  return {
    async execute() {
      return { status: StageStatus.SUCCESS, notes: name };
    },
  };
}

describe("HandlerRegistry", () => {
  describe("SHAPE_TO_TYPE mapping", () => {
    it("maps all shapes from spec Section 2.8", () => {
      expect(SHAPE_TO_TYPE["Mdiamond"]).toBe("start");
      expect(SHAPE_TO_TYPE["Msquare"]).toBe("exit");
      expect(SHAPE_TO_TYPE["box"]).toBe("codergen");
      expect(SHAPE_TO_TYPE["hexagon"]).toBe("wait.human");
      expect(SHAPE_TO_TYPE["diamond"]).toBe("conditional");
      expect(SHAPE_TO_TYPE["component"]).toBe("parallel");
      expect(SHAPE_TO_TYPE["tripleoctagon"]).toBe("parallel.fan_in");
      expect(SHAPE_TO_TYPE["parallelogram"]).toBe("tool");
      expect(SHAPE_TO_TYPE["house"]).toBe("stack.manager_loop");
    });
  });

  describe("register and resolve", () => {
    it("resolves by explicit type attribute", async () => {
      const registry = new HandlerRegistry();
      const handler = mockHandler("my-handler");
      registry.register("my.custom", handler);

      const node = createDefaultNode("test");
      node.type = "my.custom";

      const resolved = registry.resolve(node);
      expect(resolved).toBe(handler);

      const outcome = await resolved.execute(node, {} as never, {} as never, "");
      expect(outcome.notes).toBe("my-handler");
    });

    it("resolves by shape when no explicit type", async () => {
      const registry = new HandlerRegistry();
      const startHandler = mockHandler("start-handler");
      registry.register("start", startHandler);

      const node = createDefaultNode("begin");
      node.shape = "Mdiamond";

      const resolved = registry.resolve(node);
      expect(resolved).toBe(startHandler);
    });

    it("explicit type takes precedence over shape", async () => {
      const registry = new HandlerRegistry();
      const customHandler = mockHandler("custom");
      const codergenHandler = mockHandler("codergen");
      registry.register("my.type", customHandler);
      registry.register("codergen", codergenHandler);

      const node = createDefaultNode("test");
      node.shape = "box"; // maps to codergen
      node.type = "my.type"; // explicit override

      const resolved = registry.resolve(node);
      expect(resolved).toBe(customHandler);
    });

    it("falls back to default handler when no match", async () => {
      const registry = new HandlerRegistry();
      const defaultHandler = mockHandler("default");
      registry.setDefault(defaultHandler);

      const node = createDefaultNode("test");
      node.shape = "unknown_shape";

      const resolved = registry.resolve(node);
      expect(resolved).toBe(defaultHandler);
    });

    it("throws when no handler found and no default", () => {
      const registry = new HandlerRegistry();
      const node = createDefaultNode("test");
      node.shape = "unknown_shape";

      expect(() => registry.resolve(node)).toThrow("No handler found");
    });

    it("replacing a handler for the same type works", async () => {
      const registry = new HandlerRegistry();
      const handler1 = mockHandler("first");
      const handler2 = mockHandler("second");

      registry.register("codergen", handler1);
      registry.register("codergen", handler2);

      const node = createDefaultNode("test");
      node.shape = "box";

      const resolved = registry.resolve(node);
      expect(resolved).toBe(handler2);
    });

    it("resolves each shape to the correct handler type", () => {
      const registry = new HandlerRegistry();
      const handlers: Record<string, Handler> = {};

      // Register a handler for every known type
      for (const type of Object.values(SHAPE_TO_TYPE)) {
        handlers[type] = mockHandler(type);
        registry.register(type, handlers[type]!);
      }

      // Test each shape resolves correctly
      for (const [shape, type] of Object.entries(SHAPE_TO_TYPE)) {
        const node = createDefaultNode("test");
        node.shape = shape;
        const resolved = registry.resolve(node);
        expect(resolved).toBe(handlers[type]);
      }
    });
  });

  describe("utility methods", () => {
    it("has() checks if a type is registered", () => {
      const registry = new HandlerRegistry();
      registry.register("start", mockHandler("start"));

      expect(registry.has("start")).toBe(true);
      expect(registry.has("nonexistent")).toBe(false);
    });

    it("registeredTypes() returns all type strings", () => {
      const registry = new HandlerRegistry();
      registry.register("start", mockHandler("start"));
      registry.register("exit", mockHandler("exit"));
      registry.register("codergen", mockHandler("codergen"));

      const types = registry.registeredTypes();
      expect(types).toContain("start");
      expect(types).toContain("exit");
      expect(types).toContain("codergen");
      expect(types).toHaveLength(3);
    });
  });
});
