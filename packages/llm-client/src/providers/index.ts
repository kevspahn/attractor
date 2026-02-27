/**
 * Barrel re-export for all provider adapters.
 */

// Adapter interface
export type { ProviderAdapter } from "./adapter.js";

// Anthropic adapter
export { AnthropicAdapter } from "./anthropic/index.js";
export type { AnthropicAdapterOptions } from "./anthropic/index.js";

// OpenAI adapter (Responses API)
export { OpenAIAdapter } from "./openai/index.js";
export type { OpenAIAdapterOptions } from "./openai/index.js";

// OpenAI-compatible adapter (Chat Completions API)
export { OpenAICompatibleAdapter } from "./openai-compatible/index.js";
export type { OpenAICompatibleAdapterOptions } from "./openai-compatible/index.js";

// Gemini adapter
export { GeminiAdapter } from "./gemini/index.js";
export type { GeminiAdapterOptions } from "./gemini/index.js";
