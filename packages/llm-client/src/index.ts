export const VERSION = "0.1.0";

// Re-export all types
export * from "./types/index.js";

// Re-export provider utilities
export * from "./utils/index.js";

// Re-export provider adapters
export * from "./providers/index.js";

// Re-export Client class and related types
export { Client } from "./client.js";
export type { ClientConfig, Middleware, StreamMiddleware } from "./client.js";

// Re-export model catalog
export { getModelInfo, listModels, getLatestModel } from "./catalog.js";
export type { ModelInfo } from "./catalog.js";

// Re-export high-level API (Layer 4)
export { generate, executeTools } from "./generate.js";
export type {
  GenerateOptions,
  StepResult,
  GenerateResult,
} from "./generate.js";

export { stream } from "./stream-fn.js";
export type { StreamResult } from "./stream-fn.js";

export { generateObject } from "./generate-object.js";
export type { GenerateObjectOptions } from "./generate-object.js";

// ---------------------------------------------------------------------------
// Module-level default client
// ---------------------------------------------------------------------------

import { Client } from "./client.js";

let defaultClient: Client | undefined;

/**
 * Set the module-level default Client instance.
 */
export function setDefaultClient(client: Client): void {
  defaultClient = client;
}

/**
 * Get the module-level default Client instance.
 *
 * If none has been set, creates one via `Client.fromEnv()` and caches it.
 */
export function getDefaultClient(): Client {
  if (!defaultClient) {
    defaultClient = Client.fromEnv();
  }
  return defaultClient;
}

/**
 * Reset the module-level default client to undefined.
 * Primarily useful for testing.
 */
export function resetDefaultClient(): void {
  defaultClient = undefined;
}
