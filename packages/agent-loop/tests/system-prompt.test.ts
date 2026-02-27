/**
 * Tests for system prompt assembly.
 */

import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../src/system-prompt.js";
import { createAnthropicProfile } from "../src/profiles/anthropic.js";
import type { EnvironmentContext } from "../src/profiles/types.js";

const testEnv: EnvironmentContext = {
  workingDirectory: "/home/user/project",
  isGitRepo: true,
  gitBranch: "main",
  platform: "linux",
  osVersion: "Ubuntu 24.04",
  date: "2026-02-26",
  model: "claude-sonnet-4-5",
};

describe("buildSystemPrompt", () => {
  it("should include provider base instructions (layer 1)", () => {
    const profile = createAnthropicProfile();
    const prompt = buildSystemPrompt(profile, testEnv, "");
    expect(prompt).toContain("coding agent");
  });

  it("should include environment context block (layer 2)", () => {
    const profile = createAnthropicProfile();
    const prompt = buildSystemPrompt(profile, testEnv, "");
    expect(prompt).toContain("<environment>");
    expect(prompt).toContain("Working directory: /home/user/project");
    expect(prompt).toContain("Is git repository: true");
    expect(prompt).toContain("Git branch: main");
    expect(prompt).toContain("Platform: linux");
    expect(prompt).toContain("OS version: Ubuntu 24.04");
    expect(prompt).toContain("Today's date: 2026-02-26");
    expect(prompt).toContain("Model: claude-sonnet-4-5");
    expect(prompt).toContain("</environment>");
  });

  it("should omit git branch when not present", () => {
    const profile = createAnthropicProfile();
    const envNoGit: EnvironmentContext = {
      ...testEnv,
      isGitRepo: false,
      gitBranch: undefined,
    };
    const prompt = buildSystemPrompt(profile, envNoGit, "");
    expect(prompt).not.toContain("Git branch:");
  });

  it("should include tool descriptions (layer 3)", () => {
    const profile = createAnthropicProfile();
    const prompt = buildSystemPrompt(profile, testEnv, "");
    expect(prompt).toContain("## Available Tools");
    expect(prompt).toContain("### read_file");
    expect(prompt).toContain("### edit_file");
    expect(prompt).toContain("### shell");
  });

  it("should include project docs (layer 4)", () => {
    const profile = createAnthropicProfile();
    const projectDocs = "# Project Guidelines\n\nAlways use TypeScript.";
    const prompt = buildSystemPrompt(profile, testEnv, projectDocs);
    expect(prompt).toContain("# Project Guidelines");
    expect(prompt).toContain("Always use TypeScript");
  });

  it("should truncate project docs at 32KB", () => {
    const profile = createAnthropicProfile();
    const largeDocs = "x".repeat(40_000); // 40KB
    const prompt = buildSystemPrompt(profile, testEnv, largeDocs);
    expect(prompt).toContain(
      "[Project instructions truncated at 32KB]",
    );
    // The docs portion should be at most 32KB + the truncation marker
    expect(prompt.length).toBeLessThan(40_000 + 5_000); // rough check
  });

  it("should include user instructions as the last layer (layer 5)", () => {
    const profile = createAnthropicProfile();
    const userInstructions = "Custom user instructions go here.";
    const prompt = buildSystemPrompt(
      profile,
      testEnv,
      "",
      userInstructions,
    );
    // User instructions should be at the very end
    expect(prompt).toContain(userInstructions);
    const lastIndex = prompt.lastIndexOf(userInstructions);
    expect(lastIndex).toBeGreaterThan(prompt.length / 2);
  });

  it("should not include user instructions if not provided", () => {
    const profile = createAnthropicProfile();
    const prompt = buildSystemPrompt(profile, testEnv, "");
    // Should still build without errors
    expect(prompt).toBeTruthy();
  });

  it("should have layers in the correct order", () => {
    const profile = createAnthropicProfile();
    const projectDocs = "PROJECT_DOCS_MARKER";
    const userInstructions = "USER_INSTRUCTIONS_MARKER";
    const prompt = buildSystemPrompt(
      profile,
      testEnv,
      projectDocs,
      userInstructions,
    );

    // Verify ordering: base < environment < tools < project docs < user instructions
    const baseIdx = prompt.indexOf("coding agent");
    const envIdx = prompt.indexOf("<environment>");
    const toolsIdx = prompt.indexOf("## Available Tools");
    const docsIdx = prompt.indexOf("PROJECT_DOCS_MARKER");
    const userIdx = prompt.indexOf("USER_INSTRUCTIONS_MARKER");

    expect(baseIdx).toBeLessThan(envIdx);
    expect(envIdx).toBeLessThan(toolsIdx);
    expect(toolsIdx).toBeLessThan(docsIdx);
    expect(docsIdx).toBeLessThan(userIdx);
  });
});
