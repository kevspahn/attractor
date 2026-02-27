/**
 * Tool registry: stores registered tools and provides lookup by name.
 */

import type { RegisteredTool, ToolDefinition } from "./types.js";

export class ToolRegistry {
  private _tools: Map<string, RegisteredTool> = new Map();

  /**
   * Register a tool. If a tool with the same name already exists, it is replaced
   * (latest-wins semantics for custom overrides).
   */
  register(tool: RegisteredTool): void {
    this._tools.set(tool.definition.name, tool);
  }

  /**
   * Remove a tool by name. No-op if the tool does not exist.
   */
  unregister(name: string): void {
    this._tools.delete(name);
  }

  /**
   * Look up a tool by name.
   */
  get(name: string): RegisteredTool | undefined {
    return this._tools.get(name);
  }

  /**
   * Return all tool definitions (for sending to the LLM).
   */
  definitions(): ToolDefinition[] {
    return Array.from(this._tools.values()).map((t) => t.definition);
  }

  /**
   * Return all registered tool names.
   */
  names(): string[] {
    return Array.from(this._tools.keys());
  }
}
