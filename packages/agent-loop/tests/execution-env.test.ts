import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { LocalExecutionEnvironment } from "../src/execution-env.js";

describe("LocalExecutionEnvironment", () => {
  let tmpDir: string;
  let env: LocalExecutionEnvironment;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-loop-test-"));
    env = new LocalExecutionEnvironment(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ----------------------------------------------------------------
  // readFile
  // ----------------------------------------------------------------
  describe("readFile", () => {
    it("should read file with line numbers", async () => {
      await fs.writeFile(path.join(tmpDir, "test.txt"), "hello\nworld\n");
      const result = await env.readFile(path.join(tmpDir, "test.txt"));
      expect(result).toBe("1 | hello\n2 | world");
    });

    it("should pad line numbers for larger files", async () => {
      const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`);
      await fs.writeFile(path.join(tmpDir, "multi.txt"), lines.join("\n") + "\n");
      const result = await env.readFile(path.join(tmpDir, "multi.txt"));
      // Line numbers should be padded to 2 digits
      expect(result).toContain(" 1 | line 1");
      expect(result).toContain("15 | line 15");
    });

    it("should support offset (1-based)", async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
      await fs.writeFile(path.join(tmpDir, "offset.txt"), lines.join("\n") + "\n");
      const result = await env.readFile(path.join(tmpDir, "offset.txt"), 5);
      expect(result).toContain("5 | line 5");
      // Lines before offset should not appear (check that "| line 1\n" is absent)
      expect(result).not.toContain("| line 1\n");
      expect(result).not.toContain("| line 4\n");
    });

    it("should support limit", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
      await fs.writeFile(path.join(tmpDir, "limit.txt"), lines.join("\n") + "\n");
      const result = await env.readFile(path.join(tmpDir, "limit.txt"), 1, 3);
      const outputLines = result.split("\n");
      expect(outputLines).toHaveLength(3);
      expect(result).toContain("1 | line 1");
      expect(result).toContain("3 | line 3");
    });

    it("should detect binary files", async () => {
      const buf = Buffer.alloc(100);
      buf[10] = 0; // null byte
      buf.write("hello", 0);
      await fs.writeFile(path.join(tmpDir, "binary.bin"), buf);
      await expect(env.readFile(path.join(tmpDir, "binary.bin"))).rejects.toThrow(
        "binary file",
      );
    });

    it("should throw for non-existent file", async () => {
      await expect(
        env.readFile(path.join(tmpDir, "nonexistent.txt")),
      ).rejects.toThrow();
    });
  });

  // ----------------------------------------------------------------
  // readFileRaw
  // ----------------------------------------------------------------
  describe("readFileRaw", () => {
    it("should read raw file content without line numbers", async () => {
      await fs.writeFile(path.join(tmpDir, "raw.txt"), "hello\nworld\n");
      const result = await env.readFileRaw(path.join(tmpDir, "raw.txt"));
      expect(result).toBe("hello\nworld\n");
    });

    it("should detect binary files", async () => {
      const buf = Buffer.alloc(100);
      buf[10] = 0;
      await fs.writeFile(path.join(tmpDir, "binary.bin"), buf);
      await expect(env.readFileRaw(path.join(tmpDir, "binary.bin"))).rejects.toThrow(
        "binary file",
      );
    });
  });

  // ----------------------------------------------------------------
  // writeFile
  // ----------------------------------------------------------------
  describe("writeFile", () => {
    it("should write file content", async () => {
      const filePath = path.join(tmpDir, "output.txt");
      await env.writeFile(filePath, "hello world");
      const content = await fs.readFile(filePath, "utf-8");
      expect(content).toBe("hello world");
    });

    it("should create parent directories", async () => {
      const filePath = path.join(tmpDir, "deep", "nested", "dir", "file.txt");
      await env.writeFile(filePath, "nested content");
      const content = await fs.readFile(filePath, "utf-8");
      expect(content).toBe("nested content");
    });

    it("should overwrite existing files", async () => {
      const filePath = path.join(tmpDir, "overwrite.txt");
      await env.writeFile(filePath, "original");
      await env.writeFile(filePath, "updated");
      const content = await fs.readFile(filePath, "utf-8");
      expect(content).toBe("updated");
    });
  });

  // ----------------------------------------------------------------
  // fileExists
  // ----------------------------------------------------------------
  describe("fileExists", () => {
    it("should return true for existing file", async () => {
      await fs.writeFile(path.join(tmpDir, "exists.txt"), "yes");
      expect(await env.fileExists(path.join(tmpDir, "exists.txt"))).toBe(true);
    });

    it("should return false for non-existent file", async () => {
      expect(await env.fileExists(path.join(tmpDir, "nope.txt"))).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // execCommand
  // ----------------------------------------------------------------
  describe("execCommand", () => {
    it("should execute a basic command", async () => {
      const result = await env.execCommand("echo hello");
      expect(result.stdout.trim()).toBe("hello");
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should capture stderr", async () => {
      const result = await env.execCommand("echo error >&2");
      expect(result.stderr.trim()).toBe("error");
    });

    it("should return non-zero exit code", async () => {
      const result = await env.execCommand("exit 42");
      expect(result.exitCode).toBe(42);
    });

    it("should timeout long-running commands", async () => {
      const result = await env.execCommand("sleep 30", { timeoutMs: 500 });
      expect(result.timedOut).toBe(true);
    }, 10000);

    it("should filter sensitive environment variables", async () => {
      // Set a sensitive env var
      process.env.MY_API_KEY = "secret123";
      try {
        const result = await env.execCommand("echo $MY_API_KEY");
        // The variable should be filtered out, so output should be empty
        expect(result.stdout.trim()).toBe("");
      } finally {
        delete process.env.MY_API_KEY;
      }
    });

    it("should inherit PATH", async () => {
      const result = await env.execCommand("echo $PATH");
      expect(result.stdout.trim()).not.toBe("");
    });

    it("should use specified working directory", async () => {
      const subDir = path.join(tmpDir, "subdir");
      await fs.mkdir(subDir);
      // Use realpath because macOS has /var -> /private/var symlink
      const realSubDir = await fs.realpath(subDir);
      const result = await env.execCommand("pwd", { workingDir: subDir });
      expect(result.stdout.trim()).toBe(realSubDir);
    });

    it("should apply extra environment variables", async () => {
      const result = await env.execCommand("echo $MY_CUSTOM_VAR", {
        envVars: { MY_CUSTOM_VAR: "custom_value" },
      });
      expect(result.stdout.trim()).toBe("custom_value");
    });
  });

  // ----------------------------------------------------------------
  // listDirectory
  // ----------------------------------------------------------------
  describe("listDirectory", () => {
    it("should list directory entries", async () => {
      await fs.writeFile(path.join(tmpDir, "a.txt"), "");
      await fs.mkdir(path.join(tmpDir, "subdir"));

      const entries = await env.listDirectory(tmpDir);
      expect(entries.length).toBeGreaterThanOrEqual(2);
      const names = entries.map((e) => e.name);
      expect(names).toContain("a.txt");
      expect(names).toContain("subdir");

      const fileEntry = entries.find((e) => e.name === "a.txt");
      expect(fileEntry?.isFile).toBe(true);
      expect(fileEntry?.isDirectory).toBe(false);

      const dirEntry = entries.find((e) => e.name === "subdir");
      expect(dirEntry?.isDirectory).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // metadata
  // ----------------------------------------------------------------
  describe("metadata", () => {
    it("should return working directory", () => {
      expect(env.workingDirectory()).toBe(tmpDir);
    });

    it("should return platform", () => {
      expect(env.platform()).toBe(process.platform);
    });
  });

  // ----------------------------------------------------------------
  // glob
  // ----------------------------------------------------------------
  describe("glob", () => {
    it("should find files matching pattern", async () => {
      await fs.writeFile(path.join(tmpDir, "a.ts"), "");
      await fs.writeFile(path.join(tmpDir, "b.ts"), "");
      await fs.writeFile(path.join(tmpDir, "c.js"), "");

      const matches = await env.glob("*.ts", tmpDir);
      expect(matches).toHaveLength(2);
      expect(matches.some((m) => m.endsWith("a.ts"))).toBe(true);
      expect(matches.some((m) => m.endsWith("b.ts"))).toBe(true);
    });

    it("should return empty array for no matches", async () => {
      const matches = await env.glob("*.xyz", tmpDir);
      expect(matches).toEqual([]);
    });
  });
});
