/**
 * HandlerRegistry — maps type strings to handler instances.
 *
 * Resolution order (spec Section 4.2):
 * 1. Explicit `type` attribute on the node
 * 2. Shape-based resolution using SHAPE_TO_TYPE mapping (Section 2.8)
 * 3. Default handler (codergen/LLM handler)
 *
 * See spec Section 4.2.
 */

import type { Node } from "../parser/types.js";
import type { Handler } from "./handler.js";

/** Shape-to-handler-type mapping from spec Section 2.8 */
export const SHAPE_TO_TYPE: Record<string, string> = {
  Mdiamond: "start",
  Msquare: "exit",
  box: "codergen",
  hexagon: "wait.human",
  diamond: "conditional",
  component: "parallel",
  tripleoctagon: "parallel.fan_in",
  parallelogram: "tool",
  house: "stack.manager_loop",
};

export class HandlerRegistry {
  private handlers: Map<string, Handler> = new Map();
  private defaultHandler: Handler | undefined;

  /**
   * Register a handler for a type string.
   * Registering for an already-registered type replaces the previous handler.
   */
  register(type: string, handler: Handler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Set the default handler used when no specific handler is found.
   */
  setDefault(handler: Handler): void {
    this.defaultHandler = handler;
  }

  /**
   * Resolve the handler for a node.
   *
   * 1. Explicit type attribute
   * 2. Shape-based resolution
   * 3. Default handler
   */
  resolve(node: Node): Handler {
    // 1. Explicit type attribute
    if (node.type && this.handlers.has(node.type)) {
      return this.handlers.get(node.type)!;
    }

    // 2. Shape-based resolution
    const handlerType = SHAPE_TO_TYPE[node.shape];
    if (handlerType && this.handlers.has(handlerType)) {
      return this.handlers.get(handlerType)!;
    }

    // 3. Default handler
    if (this.defaultHandler) {
      return this.defaultHandler;
    }

    throw new Error(
      `No handler found for node "${node.id}" (type="${node.type}", shape="${node.shape}") and no default handler registered`,
    );
  }

  /** Check if a handler is registered for a type. */
  has(type: string): boolean {
    return this.handlers.has(type);
  }

  /** Get all registered type strings. */
  registeredTypes(): string[] {
    return Array.from(this.handlers.keys());
  }
}
