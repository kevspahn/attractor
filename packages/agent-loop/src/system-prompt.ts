/**
 * System prompt assembly.
 *
 * Assembles the 5-layer system prompt per spec Section 6:
 *
 * 1. Provider-specific base instructions (from profile.buildSystemPrompt)
 * 2. Environment context block
 * 3. Tool descriptions (from profile.tools())
 * 4. Project-specific docs (passed in, truncated at 32KB)
 * 5. User instructions override (appended last)
 */

import type { ProviderProfile, EnvironmentContext } from "./profiles/types.js";

/** Maximum size for project docs in the system prompt (32KB). */
const MAX_PROJECT_DOCS_BYTES = 32 * 1024;

/**
 * Build the environment context block for the system prompt.
 */
function buildEnvironmentBlock(env: EnvironmentContext): string {
  const lines: string[] = [
    "<environment>",
    `Working directory: ${env.workingDirectory}`,
    `Is git repository: ${env.isGitRepo}`,
  ];

  if (env.gitBranch) {
    lines.push(`Git branch: ${env.gitBranch}`);
  }

  lines.push(
    `Platform: ${env.platform}`,
    `OS version: ${env.osVersion}`,
    `Today's date: ${env.date}`,
    `Model: ${env.model}`,
    "</environment>",
  );

  return lines.join("\n");
}

/**
 * Format tool descriptions for inclusion in the system prompt.
 */
function buildToolDescriptions(profile: ProviderProfile): string {
  const tools = profile.tools();
  if (tools.length === 0) return "";

  const lines = ["## Available Tools", ""];
  for (const tool of tools) {
    lines.push(`### ${tool.name}`);
    lines.push(tool.description);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Truncate project docs to the 32KB budget.
 */
function truncateProjectDocs(docs: string): string {
  if (docs.length <= MAX_PROJECT_DOCS_BYTES) {
    return docs;
  }
  return (
    docs.substring(0, MAX_PROJECT_DOCS_BYTES) +
    "\n[Project instructions truncated at 32KB]"
  );
}

/**
 * Assemble the full system prompt from all 5 layers.
 *
 * @param profile The provider profile (supplies base prompt and tools)
 * @param env Runtime environment context
 * @param projectDocs Project-specific documentation (AGENTS.md, CLAUDE.md, etc.)
 * @param userInstructions Optional user instruction override (highest priority)
 * @returns The assembled system prompt string
 */
export function buildSystemPrompt(
  profile: ProviderProfile,
  env: EnvironmentContext,
  projectDocs: string,
  userInstructions?: string,
): string {
  const sections: string[] = [];

  // Layer 1: Provider-specific base instructions
  const basePrompt = profile.buildSystemPrompt(env, projectDocs);
  if (basePrompt) {
    sections.push(basePrompt);
  }

  // Layer 2: Environment context
  sections.push(buildEnvironmentBlock(env));

  // Layer 3: Tool descriptions
  const toolDescs = buildToolDescriptions(profile);
  if (toolDescs) {
    sections.push(toolDescs);
  }

  // Layer 4: Project-specific docs (truncated at 32KB)
  if (projectDocs) {
    sections.push(truncateProjectDocs(projectDocs));
  }

  // Layer 5: User instructions override (appended last)
  if (userInstructions) {
    sections.push(userInstructions);
  }

  return sections.join("\n\n");
}
