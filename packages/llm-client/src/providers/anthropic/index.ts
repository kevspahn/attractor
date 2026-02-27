/**
 * Anthropic provider adapter.
 *
 * Uses the Messages API (POST /v1/messages) per spec Section 2.7.
 * Authentication via x-api-key header + anthropic-version header.
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

export interface AnthropicAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: AnthropicAdapterOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.anthropic.com").replace(
      /\/$/,
      "",
    );
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    return mergeHeaders(
      {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      this.defaultHeaders,
      extra,
    );
  }

  async complete(request: Request): Promise<Response> {
    const { body, extraHeaders } = translateRequest(request);
    const url = `${this.baseUrl}/v1/messages`;
    const headers = this.buildHeaders(extraHeaders);

    const httpRes = await httpPost(url, body, headers);

    if (httpRes.status < 200 || httpRes.status >= 300) {
      throw mapHttpError(httpRes.status, httpRes.body, "anthropic", httpRes.headers);
    }

    return translateResponse(httpRes.body);
  }

  async *stream(request: Request): AsyncIterableIterator<StreamEvent> {
    const { body, extraHeaders } = translateRequest(request);
    body.stream = true;
    const url = `${this.baseUrl}/v1/messages`;
    const headers = this.buildHeaders(extraHeaders);

    const httpRes = await httpStream(url, body, headers);

    if (httpRes.status < 200 || httpRes.status >= 300) {
      // For streaming errors, we need to consume the body to get error info.
      // Read the stream and try to parse as error JSON.
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
      throw mapHttpError(httpRes.status, parsedBody, "anthropic", httpRes.headers);
    }

    const sseStream = parseSSEStream(httpRes.body);
    yield* translateStream(sseStream);
  }

  supportsToolChoice(mode: string): boolean {
    return ["auto", "none", "required", "named"].includes(mode);
  }
}

export { translateRequest } from "./translate-request.js";
export { translateResponse } from "./translate-response.js";
export { translateStream } from "./stream.js";
