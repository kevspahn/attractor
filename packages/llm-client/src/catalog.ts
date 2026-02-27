/**
 * Model catalog — static metadata for known models.
 *
 * Provides lookup, listing, and filtering functions.
 * See spec Section 2.9.
 */

// ---------------------------------------------------------------------------
// ModelInfo
// ---------------------------------------------------------------------------

/** Static metadata about a known model. */
export interface ModelInfo {
  /** The provider's native model ID. */
  id: string;
  /** Which provider serves this model. */
  provider: string;
  /** Human-readable label. */
  displayName: string;
  /** Maximum input context window in tokens. */
  contextWindow: number;
  /** Maximum output tokens (if known). */
  maxOutput?: number;
  /** Whether the model supports tool/function calling. */
  supportsTools: boolean;
  /** Whether the model supports image/vision inputs. */
  supportsVision: boolean;
  /** Whether the model supports chain-of-thought reasoning. */
  supportsReasoning: boolean;
  /** Cost per million input tokens (USD). */
  inputCostPerMillion?: number;
  /** Cost per million output tokens (USD). */
  outputCostPerMillion?: number;
  /** Alternative identifiers for convenience. */
  aliases?: string[];
}

// ---------------------------------------------------------------------------
// Catalog data
// ---------------------------------------------------------------------------

const MODELS: ModelInfo[] = [
  // -- Anthropic --
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    displayName: "Claude Opus 4.6",
    contextWindow: 200000,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
  },
  {
    id: "claude-sonnet-4-5",
    provider: "anthropic",
    displayName: "Claude Sonnet 4.5",
    contextWindow: 200000,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
  },

  // -- OpenAI --
  {
    id: "gpt-5.2",
    provider: "openai",
    displayName: "GPT-5.2",
    contextWindow: 1047576,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
  },
  {
    id: "gpt-5.2-mini",
    provider: "openai",
    displayName: "GPT-5.2 Mini",
    contextWindow: 1047576,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
  },
  {
    id: "gpt-5.2-codex",
    provider: "openai",
    displayName: "GPT-5.2 Codex",
    contextWindow: 1047576,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
  },

  // -- Gemini --
  {
    id: "gemini-3-pro-preview",
    provider: "gemini",
    displayName: "Gemini 3 Pro (Preview)",
    contextWindow: 1048576,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
  },
  {
    id: "gemini-3-flash-preview",
    provider: "gemini",
    displayName: "Gemini 3 Flash (Preview)",
    contextWindow: 1048576,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
  },
];

// Build a lookup map (by id and aliases) for O(1) access.
const MODEL_MAP = new Map<string, ModelInfo>();
for (const model of MODELS) {
  MODEL_MAP.set(model.id, model);
  if (model.aliases) {
    for (const alias of model.aliases) {
      MODEL_MAP.set(alias, model);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up a model by its ID or alias.
 *
 * Returns `undefined` if the model is not in the catalog.
 */
export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODEL_MAP.get(modelId);
}

/**
 * List all known models, optionally filtered by provider name.
 */
export function listModels(provider?: string): ModelInfo[] {
  if (provider === undefined) {
    return [...MODELS];
  }
  return MODELS.filter((m) => m.provider === provider);
}

/**
 * Get the "latest" (first listed) model for a provider.
 *
 * Optionally filter by a capability: `"tools"`, `"vision"`, or `"reasoning"`.
 */
export function getLatestModel(
  provider: string,
  capability?: string,
): ModelInfo | undefined {
  const candidates = MODELS.filter((m) => m.provider === provider);

  if (!capability) {
    return candidates[0];
  }

  switch (capability) {
    case "tools":
      return candidates.find((m) => m.supportsTools);
    case "vision":
      return candidates.find((m) => m.supportsVision);
    case "reasoning":
      return candidates.find((m) => m.supportsReasoning);
    default:
      return candidates[0];
  }
}
