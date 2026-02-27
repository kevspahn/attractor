/**
 * Client class — the main orchestration layer (Layer 3).
 *
 * Routes requests to provider adapters, applies middleware in onion pattern,
 * and provides factory methods for environment-based configuration.
 *
 * See spec Sections 2.2-2.6.
 */

import type { ProviderAdapter } from "./providers/adapter.js";
import type { Request } from "./types/request.js";
import type { Response } from "./types/response.js";
import type { StreamEvent } from "./types/stream.js";
import { ConfigurationError } from "./types/errors.js";
import { AnthropicAdapter } from "./providers/anthropic/index.js";
import { OpenAIAdapter } from "./providers/openai/index.js";
import { GeminiAdapter } from "./providers/gemini/index.js";

// Minimal declaration for process.env (avoids requiring @types/node).
declare const process: { env: Record<string, string | undefined> };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Middleware for `complete()` calls.
 *
 * Follows the onion pattern: middleware runs in registration order for the
 * request phase and in reverse order for the response phase.
 */
export type Middleware = (
  request: Request,
  next: (request: Request) => Promise<Response>,
) => Promise<Response>;

/**
 * Middleware for `stream()` calls.
 *
 * Wraps the event iterator so each middleware can observe/transform events.
 */
export type StreamMiddleware = (
  request: Request,
  next: (request: Request) => AsyncIterableIterator<StreamEvent>,
) => AsyncIterableIterator<StreamEvent>;

/** Configuration for the Client constructor. */
export interface ClientConfig {
  /** Named provider adapters. */
  providers?: Record<string, ProviderAdapter>;
  /** Key into `providers` to use when `request.provider` is omitted. */
  defaultProvider?: string;
  /** Middleware chain for `complete()` calls (onion pattern). */
  middleware?: Middleware[];
  /** Middleware chain for `stream()` calls. */
  streamMiddleware?: StreamMiddleware[];
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class Client {
  private readonly providers: Record<string, ProviderAdapter>;
  private readonly defaultProvider: string | undefined;
  private readonly middleware: Middleware[];
  private readonly streamMiddleware: StreamMiddleware[];

  constructor(config: ClientConfig) {
    this.providers = { ...(config.providers ?? {}) };
    this.defaultProvider = config.defaultProvider;
    this.middleware = [...(config.middleware ?? [])];
    this.streamMiddleware = [...(config.streamMiddleware ?? [])];
  }

  // -----------------------------------------------------------------------
  // Static factory
  // -----------------------------------------------------------------------

  /**
   * Create a Client from environment variables.
   *
   * Checks `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and
   * `GEMINI_API_KEY` / `GOOGLE_API_KEY`. Only registers adapters whose keys
   * are present. The first registered adapter becomes the default.
   */
  static fromEnv(): Client {
    const providers: Record<string, ProviderAdapter> = {};

    if (process.env.ANTHROPIC_API_KEY) {
      providers.anthropic = new AnthropicAdapter({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }
    if (process.env.OPENAI_API_KEY) {
      providers.openai = new OpenAIAdapter({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
      providers.gemini = new GeminiAdapter({
        apiKey: (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)!,
      });
    }

    const defaultProvider = Object.keys(providers)[0];
    return new Client({ providers, defaultProvider });
  }

  // -----------------------------------------------------------------------
  // Provider resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve the adapter for a given request.
   *
   * If `request.provider` is set, look it up; otherwise fall back to the
   * default provider. Throws `ConfigurationError` on any routing failure.
   */
  private resolveAdapter(request: Request): ProviderAdapter {
    const providerName = request.provider ?? this.defaultProvider;

    if (!providerName) {
      throw new ConfigurationError(
        "No provider specified in request and no default provider configured",
      );
    }

    const adapter = this.providers[providerName];
    if (!adapter) {
      throw new ConfigurationError(
        `Provider "${providerName}" is not registered`,
      );
    }

    return adapter;
  }

  // -----------------------------------------------------------------------
  // complete()
  // -----------------------------------------------------------------------

  /**
   * Low-level blocking call. Routes to the resolved adapter and applies
   * the middleware chain in onion pattern.
   *
   * Does NOT retry. Raises on errors.
   */
  async complete(request: Request): Promise<Response> {
    const adapter = this.resolveAdapter(request);

    // Build the middleware chain (onion pattern).
    // The innermost call is the adapter itself.
    const innermost = (req: Request): Promise<Response> =>
      adapter.complete(req);

    // Wrap from the last middleware to the first so that the first middleware
    // registered is the outermost (runs first for request, last for response).
    const chain = this.middleware.reduceRight<
      (req: Request) => Promise<Response>
    >((next, mw) => (req: Request) => mw(req, next), innermost);

    return chain(request);
  }

  // -----------------------------------------------------------------------
  // stream()
  // -----------------------------------------------------------------------

  /**
   * Low-level streaming call. Returns an async iterator of StreamEvents.
   *
   * Applies streaming middleware if configured.
   */
  stream(request: Request): AsyncIterableIterator<StreamEvent> {
    const adapter = this.resolveAdapter(request);

    // Build the stream middleware chain.
    const innermost = (req: Request): AsyncIterableIterator<StreamEvent> =>
      adapter.stream(req);

    const chain = this.streamMiddleware.reduceRight<
      (req: Request) => AsyncIterableIterator<StreamEvent>
    >((next, mw) => (req: Request) => mw(req, next), innermost);

    return chain(request);
  }

  // -----------------------------------------------------------------------
  // close()
  // -----------------------------------------------------------------------

  /**
   * Release resources held by all registered providers.
   */
  async close(): Promise<void> {
    const closeTasks = Object.values(this.providers).map((adapter) =>
      adapter.close?.(),
    );
    await Promise.all(closeTasks);
  }
}
