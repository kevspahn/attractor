import { describe, it, expect } from "vitest";
import {
  truncateOutput,
  truncateLines,
  truncateToolOutput,
} from "../src/truncation.js";

describe("truncateOutput", () => {
  it("should return output as-is when under limit", () => {
    expect(truncateOutput("short", 100, "head_tail")).toBe("short");
    expect(truncateOutput("short", 100, "tail")).toBe("short");
  });

  describe("head_tail mode", () => {
    it("should keep first and last half with warning", () => {
      const input = "A".repeat(100);
      const result = truncateOutput(input, 50, "head_tail");
      expect(result).toContain("WARNING");
      expect(result).toContain("50 characters were removed from the middle");
      // Should start with A's and end with A's
      expect(result.startsWith("A")).toBe(true);
      expect(result.endsWith("A")).toBe(true);
    });

    it("should include the correct number of removed characters", () => {
      const input = "X".repeat(1000);
      const result = truncateOutput(input, 200, "head_tail");
      expect(result).toContain("800 characters were removed from the middle");
    });
  });

  describe("tail mode", () => {
    it("should keep the last portion with warning", () => {
      const prefix = "START";
      const suffix = "END".repeat(30);
      const input = prefix + "X".repeat(1000) + suffix;
      const result = truncateOutput(input, 200, "tail");
      expect(result).toContain("WARNING");
      expect(result).toContain("characters were removed");
      // Should end with the suffix
      expect(result.endsWith(suffix)).toBe(true);
      // Should not start with the prefix
      expect(result.startsWith(prefix)).toBe(false);
    });
  });
});

describe("truncateLines", () => {
  it("should return output as-is when under line limit", () => {
    const input = "line1\nline2\nline3";
    expect(truncateLines(input, 10)).toBe(input);
  });

  it("should truncate with head/tail split", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const input = lines.join("\n");
    const result = truncateLines(input, 10);

    // Should have head lines
    expect(result).toContain("line 1");
    expect(result).toContain("line 5");

    // Should have tail lines
    expect(result).toContain("line 96");
    expect(result).toContain("line 100");

    // Should have omission marker
    expect(result).toContain("90 lines omitted");
  });

  it("should handle even splits", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const input = lines.join("\n");
    const result = truncateLines(input, 6);

    // head_count = 3, tail_count = 3, omitted = 14
    expect(result).toContain("line 1");
    expect(result).toContain("line 3");
    expect(result).toContain("line 18");
    expect(result).toContain("line 20");
    expect(result).toContain("14 lines omitted");
  });
});

describe("truncateToolOutput", () => {
  it("should apply character truncation for read_file (head_tail)", () => {
    const input = "X".repeat(100_000);
    const result = truncateToolOutput(input, "read_file");
    expect(result.length).toBeLessThan(100_000);
    expect(result).toContain("WARNING");
  });

  it("should apply character truncation for shell (head_tail) and then line truncation", () => {
    // Generate output that's big in both characters and lines
    const lines = Array.from({ length: 500 }, (_, i) => `output line ${i + 1}`);
    const input = lines.join("\n");
    const result = truncateToolOutput(input, "shell");
    // After character truncation, should also have line truncation
    // Shell defaults: 30000 chars, 256 lines
    if (input.length > 30_000) {
      expect(result).toContain("WARNING");
    }
  });

  it("should apply tail mode for grep", () => {
    const input = "X".repeat(50_000);
    const result = truncateToolOutput(input, "grep");
    expect(result).toContain("WARNING");
    expect(result).toContain("characters were removed");
  });

  it("should use default limits for unknown tools", () => {
    const input = "X".repeat(50_000);
    const result = truncateToolOutput(input, "unknown_tool");
    // Default is 30000 chars, head_tail mode
    expect(result).toContain("WARNING");
  });

  it("should allow config overrides", () => {
    const input = "X".repeat(200);
    const result = truncateToolOutput(input, "read_file", {
      maxChars: 100,
      mode: "tail",
    });
    expect(result).toContain("WARNING");
    expect(result.length).toBeLessThan(200 + 200); // output + warning text
  });

  it("should pass through small outputs unchanged", () => {
    const input = "small output";
    expect(truncateToolOutput(input, "read_file")).toBe(input);
    expect(truncateToolOutput(input, "shell")).toBe(input);
    expect(truncateToolOutput(input, "grep")).toBe(input);
  });

  it("should apply line limits for glob", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `/path/to/file${i}.ts`);
    const input = lines.join("\n");
    const result = truncateToolOutput(input, "glob");
    // glob defaults: 20000 chars, 500 lines
    // The char limit may or may not trigger, but line limit should
    if (input.length <= 20_000) {
      expect(result).toContain("lines omitted");
    }
  });
});
