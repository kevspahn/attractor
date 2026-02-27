/**
 * ProviderAdapter interface — the contract every provider must implement.
 *
 * Defined in spec Section 2.4. Two required methods (complete, stream) and
 * three optional methods (close, initialize, supportsToolChoice).
 */

import type { Request, Response, StreamEvent } from "../types/index.js";

/**
 * The contract that every LLM provider adapter must implement.
 *
 * Each adapter translates between the unified Request/Response types and
 * the provider's native API format.
 */
export interface ProviderAdapter {
  /** Provider name, e.g. "openai", "anthropic", "gemini". */
  readonly name: string;

  /**
   * Send a request and block until the model finishes.
   * Returns the full response.
   */
  complete(request: Request): Promise<Response>;

  /**
   * Send a request and return an async iterator of stream events.
   */
  stream(request: Request): AsyncIterableIterator<StreamEvent>;

  /**
   * Release resources (HTTP connections, etc.). Called by Client.close().
   */
  close?(): Promise<void>;

  /**
   * Validate configuration on startup. Called by Client on registration.
   */
  initialize?(): Promise<void>;

  /**
   * Query whether a particular tool choice mode is supported.
   */
  supportsToolChoice?(mode: string): boolean;
}
