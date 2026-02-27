/**
 * generateObject() — structured output generation (Layer 4).
 *
 * Wraps generate() with provider-specific strategies for extracting
 * structured JSON output from the model.
 *
 * See spec Section 4.5.
 */

import { generate } from "./generate.js";
import type { GenerateOptions, GenerateResult } from "./generate.js";
import type { ResponseFormat } from "./types/index.js";
import { NoObjectGeneratedError } from "./types/index.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for generateObject(). Extends GenerateOptions minus responseFormat. */
export interface GenerateObjectOptions
  extends Omit<GenerateOptions, "responseFormat"> {
  /** JSON Schema defining the expected output structure. */
  schema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Provider-specific strategies
// ---------------------------------------------------------------------------

/**
 * Build the responseFormat and option overrides for OpenAI-style providers.
 *
 * OpenAI uses `response_format: { type: "json_schema", json_schema: { name, schema, strict } }`.
 */
function buildOpenAIStrategy(
  schema: Record<string, unknown>,
): Partial<GenerateOptions> {
  const responseFormat: ResponseFormat = {
    type: "json_schema",
    json_schema: {
      name: "output",
      schema,
      strict: true,
    },
  };
  return { responseFormat };
}

/**
 * Build the responseFormat and option overrides for Gemini-style providers.
 *
 * Gemini uses `response_format: { type: "json_schema", json_schema: schema }`.
 */
function buildGeminiStrategy(
  schema: Record<string, unknown>,
): Partial<GenerateOptions> {
  const responseFormat: ResponseFormat = {
    type: "json_schema",
    json_schema: schema,
  };
  return { responseFormat };
}

/**
 * Build overrides for Anthropic using tool-based extraction.
 *
 * Defines a tool named "extract" whose parameters match the schema,
 * forces the model to call it via toolChoice, and extracts the
 * structured output from the tool call arguments.
 */
function buildAnthropicStrategy(
  schema: Record<string, unknown>,
): Partial<GenerateOptions> {
  return {
    tools: [
      {
        name: "extract",
        description: "Extract structured data matching the provided schema.",
        parameters: schema,
      },
    ],
    toolChoice: { mode: "named", tool_name: "extract" },
    maxToolRounds: 0, // Don't actually execute the tool
  };
}

/**
 * Select the strategy based on provider name.
 */
function selectStrategy(
  provider: string | undefined,
  schema: Record<string, unknown>,
): Partial<GenerateOptions> {
  switch (provider) {
    case "anthropic":
      return buildAnthropicStrategy(schema);
    case "gemini":
      return buildGeminiStrategy(schema);
    case "openai":
    default:
      return buildOpenAIStrategy(schema);
  }
}

// ---------------------------------------------------------------------------
// generateObject()
// ---------------------------------------------------------------------------

/**
 * Generate structured JSON output from the model.
 *
 * Uses provider-specific strategies:
 * - OpenAI: json_schema response format with strict mode
 * - Gemini: json_schema response format
 * - Anthropic: tool-based extraction (force a tool call with the schema)
 *
 * Parses and validates the output. Throws NoObjectGeneratedError on failure.
 */
export async function generateObject(
  options: GenerateObjectOptions,
): Promise<GenerateResult> {
  const { schema, ...baseOptions } = options;

  // Select provider-specific strategy
  const strategy = selectStrategy(options.provider, schema);

  // Merge strategy into options (strategy overrides take precedence)
  const mergedOptions: GenerateOptions = {
    ...baseOptions,
    ...strategy,
  };

  // Run generate()
  const result = await generate(mergedOptions);

  // Extract structured output based on strategy
  let output: unknown;

  if (options.provider === "anthropic") {
    // For Anthropic, the output is in the tool call arguments
    const firstToolCall = result.toolCalls[0];
    if (firstToolCall) {
      output = firstToolCall.arguments;
    } else {
      throw new NoObjectGeneratedError(
        "Anthropic model did not produce a tool call for structured output extraction",
      );
    }
  } else {
    // For OpenAI/Gemini, parse the text response as JSON
    const text = result.text.trim();
    if (!text) {
      throw new NoObjectGeneratedError(
        "Model returned empty text; cannot extract structured output",
      );
    }

    try {
      output = JSON.parse(text);
    } catch (err) {
      throw new NoObjectGeneratedError(
        `Failed to parse model output as JSON: ${String(err)}`,
        { cause: err },
      );
    }
  }

  return {
    ...result,
    output,
  };
}
