/**
 * OpenAI provider adapter.
 *
 * Uses the Responses API (POST /v1/responses) per spec Section 2.7.
 * Authentication via Bearer token in Authorization header.
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

export interface OpenAIAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  organizationId?: string;
  projectId?: string;
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly organizationId?: string;
  private readonly projectId?: string;

  constructor(options: OpenAIAdapterOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com").replace(
      /\/$/,
      "",
    );
    this.organizationId = options.organizationId;
    this.projectId = options.projectId;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.organizationId) {
      headers["OpenAI-Organization"] = this.organizationId;
    }
    if (this.projectId) {
      headers["OpenAI-Project"] = this.projectId;
    }
    return mergeHeaders(headers);
  }

  async complete(request: Request): Promise<Response> {
    const body = translateRequest(request);
    const url = `${this.baseUrl}/v1/responses`;
    const headers = this.buildHeaders();

    const httpRes = await httpPost(url, body, headers);

    if (httpRes.status < 200 || httpRes.status >= 300) {
      throw mapHttpError(httpRes.status, httpRes.body, "openai", httpRes.headers);
    }

    return translateResponse(httpRes.body);
  }

  async *stream(request: Request): AsyncIterableIterator<StreamEvent> {
    const body = translateRequest(request);
    body.stream = true;
    const url = `${this.baseUrl}/v1/responses`;
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
      throw mapHttpError(httpRes.status, parsedBody, "openai", httpRes.headers);
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
