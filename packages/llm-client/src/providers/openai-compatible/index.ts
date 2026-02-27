/**
 * OpenAI-compatible provider adapter for Chat Completions API.
 *
 * Per spec Section 7.10: for third-party endpoints (vLLM, Ollama, Together, Groq).
 * Uses /v1/chat/completions endpoint with standard chat completions format.
 * Does NOT support reasoning tokens or Responses API features.
 */

import type { ProviderAdapter } from "../adapter.js";
import type { Request, Response, StreamEvent } from "../../types/index.js";
import {
  httpPost,
  httpStream,
  parseSSEStream,
  mapHttpError,
  mergeHeaders,
} from "../../utils/index.js";
import { translateRequest } from "./translate-request.js";
import { translateResponse } from "./translate-response.js";
import { translateStream } from "./stream.js";

export interface OpenAICompatibleAdapterOptions {
  apiKey: string;
  baseUrl: string;
  providerName?: string;
  defaultHeaders?: Record<string, string>;
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: OpenAICompatibleAdapterOptions) {
    this.name = options.providerName ?? "openai-compatible";
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return mergeHeaders(headers, this.defaultHeaders);
  }

  async complete(request: Request): Promise<Response> {
    const body = translateRequest(request);
    const url = `${this.baseUrl}/v1/chat/completions`;
    const headers = this.buildHeaders();

    const httpRes = await httpPost(url, body, headers);

    if (httpRes.status < 200 || httpRes.status >= 300) {
      throw mapHttpError(httpRes.status, httpRes.body, this.name, httpRes.headers);
    }

    return translateResponse(httpRes.body, this.name);
  }

  async *stream(request: Request): AsyncIterableIterator<StreamEvent> {
    const body = translateRequest(request);
    body.stream = true;
    body.stream_options = { include_usage: true };
    const url = `${this.baseUrl}/v1/chat/completions`;
    const headers = this.buildHeaders();

    const httpRes = await httpStream(url, body, headers);

    if (httpRes.status < 200 || httpRes.status >= 300) {
      const reader = httpRes.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(text);
      } catch {
        parsedBody = text;
      }
      throw mapHttpError(httpRes.status, parsedBody, this.name, httpRes.headers);
    }

    const sseStream = parseSSEStream(httpRes.body);
    yield* translateStream(sseStream, this.name);
  }

  supportsToolChoice(mode: string): boolean {
    return ["auto", "none", "required", "named"].includes(mode);
  }
}

export { translateRequest } from "./translate-request.js";
export { translateResponse } from "./translate-response.js";
export { translateStream } from "./stream.js";
