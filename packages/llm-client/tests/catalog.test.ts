import { describe, it, expect } from "vitest";
import {
  getModelInfo,
  listModels,
  getLatestModel,
} from "../src/catalog.js";

describe("getModelInfo", () => {
  it("returns correct model for a known Anthropic model ID", () => {
    const info = getModelInfo("claude-opus-4-6");
    expect(info).toBeDefined();
    expect(info!.id).toBe("claude-opus-4-6");
    expect(info!.provider).toBe("anthropic");
    expect(info!.displayName).toBe("Claude Opus 4.6");
    expect(info!.contextWindow).toBe(200000);
    expect(info!.supportsTools).toBe(true);
    expect(info!.supportsVision).toBe(true);
    expect(info!.supportsReasoning).toBe(true);
  });

  it("returns correct model for a known OpenAI model ID", () => {
    const info = getModelInfo("gpt-5.2");
    expect(info).toBeDefined();
    expect(info!.id).toBe("gpt-5.2");
    expect(info!.provider).toBe("openai");
    expect(info!.displayName).toBe("GPT-5.2");
    expect(info!.contextWindow).toBe(1047576);
  });

  it("returns correct model for a known Gemini model ID", () => {
    const info = getModelInfo("gemini-3-pro-preview");
    expect(info).toBeDefined();
    expect(info!.id).toBe("gemini-3-pro-preview");
    expect(info!.provider).toBe("gemini");
    expect(info!.displayName).toBe("Gemini 3 Pro (Preview)");
    expect(info!.contextWindow).toBe(1048576);
  });

  it("returns undefined for an unknown model ID", () => {
    expect(getModelInfo("nonexistent-model")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(getModelInfo("")).toBeUndefined();
  });
});

describe("listModels", () => {
  it("returns all models when no provider filter is given", () => {
    const all = listModels();
    expect(all.length).toBeGreaterThanOrEqual(7);

    // Should include models from all providers
    const providers = new Set(all.map((m) => m.provider));
    expect(providers.has("anthropic")).toBe(true);
    expect(providers.has("openai")).toBe(true);
    expect(providers.has("gemini")).toBe(true);
  });

  it("returns only Anthropic models when filtered", () => {
    const models = listModels("anthropic");
    expect(models.length).toBe(2);
    for (const m of models) {
      expect(m.provider).toBe("anthropic");
    }
  });

  it("returns only OpenAI models when filtered", () => {
    const models = listModels("openai");
    expect(models.length).toBe(3);
    for (const m of models) {
      expect(m.provider).toBe("openai");
    }
  });

  it("returns only Gemini models when filtered", () => {
    const models = listModels("gemini");
    expect(models.length).toBe(2);
    for (const m of models) {
      expect(m.provider).toBe("gemini");
    }
  });

  it("returns empty array for unknown provider", () => {
    expect(listModels("nonexistent")).toEqual([]);
  });

  it("returns a copy (not the original array)", () => {
    const a = listModels();
    const b = listModels();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("getLatestModel", () => {
  it("returns the first model for a provider (no capability filter)", () => {
    const model = getLatestModel("anthropic");
    expect(model).toBeDefined();
    expect(model!.id).toBe("claude-opus-4-6");
    expect(model!.provider).toBe("anthropic");
  });

  it("returns the first model for openai", () => {
    const model = getLatestModel("openai");
    expect(model).toBeDefined();
    expect(model!.id).toBe("gpt-5.2");
  });

  it("returns the first model for gemini", () => {
    const model = getLatestModel("gemini");
    expect(model).toBeDefined();
    expect(model!.id).toBe("gemini-3-pro-preview");
  });

  it("returns undefined for unknown provider", () => {
    expect(getLatestModel("nonexistent")).toBeUndefined();
  });

  it("filters by 'tools' capability", () => {
    const model = getLatestModel("anthropic", "tools");
    expect(model).toBeDefined();
    expect(model!.supportsTools).toBe(true);
  });

  it("filters by 'vision' capability", () => {
    const model = getLatestModel("openai", "vision");
    expect(model).toBeDefined();
    expect(model!.supportsVision).toBe(true);
  });

  it("filters by 'reasoning' capability", () => {
    const model = getLatestModel("gemini", "reasoning");
    expect(model).toBeDefined();
    expect(model!.supportsReasoning).toBe(true);
  });

  it("falls back to first model for unknown capability", () => {
    const model = getLatestModel("anthropic", "teleportation");
    expect(model).toBeDefined();
    expect(model!.id).toBe("claude-opus-4-6");
  });
});
