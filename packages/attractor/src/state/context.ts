/**
 * Context — thread-safe key-value store shared across all stages during a pipeline run.
 *
 * See spec Section 5.1 for full details.
 */

export class Context {
  private values: Map<string, unknown>;
  private logs: string[];

  constructor() {
    this.values = new Map();
    this.logs = [];
  }

  /** Set a value in the context. */
  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  /** Get a value from the context with optional default. */
  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    if (this.values.has(key)) {
      return this.values.get(key) as T;
    }
    return defaultValue;
  }

  /** Get a string value with a default. */
  getString(key: string, defaultValue: string = ""): string {
    const value = this.values.get(key);
    if (value === undefined || value === null) return defaultValue;
    return String(value);
  }

  /** Append an entry to the run log. */
  appendLog(entry: string): void {
    this.logs.push(entry);
  }

  /** Get the run log entries. */
  getLogs(): string[] {
    return [...this.logs];
  }

  /**
   * Returns a serializable shallow copy of all values.
   */
  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of this.values) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Deep copy for parallel branch isolation.
   */
  clone(): Context {
    const ctx = new Context();
    for (const [key, value] of this.values) {
      ctx.values.set(key, value);
    }
    ctx.logs = [...this.logs];
    return ctx;
  }

  /**
   * Merge a dictionary of updates into the context.
   */
  applyUpdates(updates: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(updates)) {
      this.values.set(key, value);
    }
  }

  /** Check if a key exists. */
  has(key: string): boolean {
    return this.values.has(key);
  }

  /** Delete a key. */
  delete(key: string): boolean {
    return this.values.delete(key);
  }

  /** Get the number of entries. */
  get size(): number {
    return this.values.size;
  }
}
