/**
 * Tests for provider profiles.
 */

import { describe, it, expect } from "vitest";
import { createAnthropicProfile } from "../src/profiles/anthropic.js";
import { createOpenAIProfile } from "../src/profiles/openai.js";
import { createGeminiProfile } from "../src/profiles/gemini.js";
import type { EnvironmentContext } from "../src/profiles/types.js";

const testEnv: EnvironmentContext = {
  workingDirectory: "/home/user/project",
  isGitRepo: true,
  gitBranch: "main",
  platform: "linux",
  osVersion: "Ubuntu 24.04",
  date: "2026-02-26",
  model: "test-model",
};

describe("Anthropic profile", () => {
  it("should use correct default model", () => {
    const profile = createAnthropicProfile();
    expect(profile.model).toBe("claude-sonnet-4-5");
  });

  it("should accept custom model", () => {
    const profile = createAnthropicProfile("claude-opus-4-6");
    expect(profile.model).toBe("claude-opus-4-6");
  });

  it("should have correct id", () => {
    const profile = createAnthropicProfile();
    expect(profile.id).toBe("anthropic");
  });

  it("should register the correct tools", () => {
    const profile = createAnthropicProfile();
    const toolNames = profile.tools().map((t) => t.name);
    expect(toolNames).toContain("read_file");
    expect(toolNames).toContain("write_file");
    expect(toolNames).toContain("edit_file");
    expect(toolNames).toContain("shell");
    expect(toolNames).toContain("grep");
    expect(toolNames).toContain("glob");
    // Should NOT have apply_patch
    expect(toolNames).not.toContain("apply_patch");
  });

  it("should have correct capability flags", () => {
    const profile = createAnthropicProfile();
    expect(profile.supportsReasoning).toBe(true);
    expect(profile.supportsStreaming).toBe(true);
    expect(profile.supportsParallelToolCalls).toBe(true);
    expect(profile.contextWindowSize).toBe(200_000);
    expect(profile.defaultCommandTimeoutMs).toBe(120_000);
  });

  it("should build a system prompt", () => {
    const profile = createAnthropicProfile();
    const prompt = profile.buildSystemPrompt(testEnv, "");
    expect(prompt).toContain("coding agent");
    expect(prompt).toContain("edit_file");
    expect(prompt).toContain("old_string");
  });

  it("should return undefined for providerOptions", () => {
    const profile = createAnthropicProfile();
    expect(profile.providerOptions()).toBeUndefined();
  });

  it("should support custom tool registration", () => {
    const profile = createAnthropicProfile();
    profile.toolRegistry.register({
      definition: {
        name: "custom_tool",
        description: "A custom tool",
        parameters: { type: "object", properties: {} },
      },
      executor: async () => "result",
    });
    const toolNames = profile.tools().map((t) => t.name);
    expect(toolNames).toContain("custom_tool");
  });

  it("should allow custom tool to override a built-in tool", () => {
    const profile = createAnthropicProfile();
    profile.toolRegistry.register({
      definition: {
        name: "read_file",
        description: "Custom read_file override",
        parameters: { type: "object", properties: {} },
      },
      executor: async () => "custom result",
    });
    const readFile = profile.toolRegistry.get("read_file");
    expect(readFile?.definition.description).toBe(
      "Custom read_file override",
    );
  });
});

describe("OpenAI profile", () => {
  it("should use correct default model", () => {
    const profile = createOpenAIProfile();
    expect(profile.model).toBe("gpt-5.2-codex");
  });

  it("should have correct id", () => {
    const profile = createOpenAIProfile();
    expect(profile.id).toBe("openai");
  });

  it("should register the correct tools", () => {
    const profile = createOpenAIProfile();
    const toolNames = profile.tools().map((t) => t.name);
    expect(toolNames).toContain("read_file");
    expect(toolNames).toContain("apply_patch");
    expect(toolNames).toContain("write_file");
    expect(toolNames).toContain("shell");
    expect(toolNames).toContain("grep");
    expect(toolNames).toContain("glob");
    // Should NOT have edit_file
    expect(toolNames).not.toContain("edit_file");
  });

  it("should have correct capability flags", () => {
    const profile = createOpenAIProfile();
    expect(profile.supportsParallelToolCalls).toBe(true);
    expect(profile.contextWindowSize).toBe(1_047_576);
    expect(profile.defaultCommandTimeoutMs).toBe(10_000);
  });

  it("should build a system prompt mentioning apply_patch", () => {
    const profile = createOpenAIProfile();
    const prompt = profile.buildSystemPrompt(testEnv, "");
    expect(prompt).toContain("coding agent");
    expect(prompt).toContain("apply_patch");
  });
});

describe("Gemini profile", () => {
  it("should use correct default model", () => {
    const profile = createGeminiProfile();
    expect(profile.model).toBe("gemini-3-flash-preview");
  });

  it("should have correct id", () => {
    const profile = createGeminiProfile();
    expect(profile.id).toBe("gemini");
  });

  it("should register the correct tools", () => {
    const profile = createGeminiProfile();
    const toolNames = profile.tools().map((t) => t.name);
    expect(toolNames).toContain("read_file");
    expect(toolNames).toContain("write_file");
    expect(toolNames).toContain("edit_file");
    expect(toolNames).toContain("shell");
    expect(toolNames).toContain("grep");
    expect(toolNames).toContain("glob");
  });

  it("should have correct capability flags", () => {
    const profile = createGeminiProfile();
    expect(profile.supportsParallelToolCalls).toBe(true);
    expect(profile.contextWindowSize).toBe(1_048_576);
    expect(profile.defaultCommandTimeoutMs).toBe(10_000);
  });

  it("should build a system prompt", () => {
    const profile = createGeminiProfile();
    const prompt = profile.buildSystemPrompt(testEnv, "");
    expect(prompt).toContain("coding agent");
    expect(prompt).toContain("edit_file");
  });
});
