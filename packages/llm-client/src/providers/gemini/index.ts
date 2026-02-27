/**
 * Gemini provider adapter.
 *
 * Uses the Gemini API (POST /v1beta/models/{model}:generateContent) per spec Section 2.7.
 * Authentication via `key` query parameter.
 * Streaming via POST /v1beta/models/{model}:streamGenerateContent?alt=sse&key={apiKey}
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
import { translateRequest, GeminiIdMap } from "./translate-request.js";
import { translateResponse } from "./translate-response.js";
import { translateStream } from "./stream.js";

export interface GeminiAdapterOptions {
  apiKey: string;
  baseUrl?: string;
}

export class GeminiAdapter implements ProviderAdapter {
  readonly name = "gemini";
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: GeminiAdapterOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (
      options.baseUrl ?? "https://generativelanguage.googleapis.com"
    ).replace(/\/$/, "");
  }

  private buildHeaders(): Record<string, string> {
    return mergeHeaders({});
  }

  async complete(request: Request): Promise<Response> {
    const idMap = new GeminiIdMap();
    const body = translateRequest(request, idMap);
    const url = `${this.baseUrl}/v1beta/models/${request.model}:generateContent?key=${this.apiKey}`;
    const headers = this.buildHeaders();

    const httpRes = await httpPost(url, body, headers);

    if (httpRes.status < 200 || httpRes.status >= 300) {
      throw mapHttpError(httpRes.status, httpRes.body, "gemini", httpRes.headers);
    }

    return translateResponse(httpRes.body, idMap);
  }

  async *stream(request: Request): AsyncIterableIterator<StreamEvent> {
    const idMap = new GeminiIdMap();
    const body = translateRequest(request, idMap);
    const url = `${this.baseUrl}/v1beta/models/${request.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
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
      throw mapHttpError(httpRes.status, parsedBody, "gemini", httpRes.headers);
    }

    const sseStream = parseSSEStream(httpRes.body);
    yield* translateStream(sseStream, idMap);
  }

  supportsToolChoice(mode: string): boolean {
    return ["auto", "none", "required", "named"].includes(mode);
  }
}

export { translateRequest, GeminiIdMap } from "./translate-request.js";
export { translateResponse } from "./translate-response.js";
export { translateStream } from "./stream.js";
