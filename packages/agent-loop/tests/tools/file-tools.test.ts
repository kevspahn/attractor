import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { LocalExecutionEnvironment } from "../../src/execution-env.js";
import { readFileTool } from "../../src/tools/read-file.js";
import { writeFileTool } from "../../src/tools/write-file.js";
import { editFileTool } from "../../src/tools/edit-file.js";

describe("File tools", () => {
  let tmpDir: string;
  let env: LocalExecutionEnvironment;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-tools-test-"));
    env = new LocalExecutionEnvironment(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ----------------------------------------------------------------
  // read_file
  // ----------------------------------------------------------------
  describe("read_file tool", () => {
    it("should read a file with line numbers", async () => {
      const filePath = path.join(tmpDir, "test.txt");
      await fs.writeFile(filePath, "line 1\nline 2\nline 3\n");

      const result = await readFileTool.executor(
        { file_path: filePath },
        env,
      );
      expect(result).toContain("1 | line 1");
      expect(result).toContain("2 | line 2");
      expect(result).toContain("3 | line 3");
    });

    it("should support offset and limit", async () => {
      const filePath = path.join(tmpDir, "multi.txt");
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
      await fs.writeFile(filePath, lines.join("\n") + "\n");

      const result = await readFileTool.executor(
        { file_path: filePath, offset: 5, limit: 3 },
        env,
      );
      expect(result).toContain("5 | line 5");
      expect(result).toContain("7 | line 7");
      expect(result).not.toContain("line 4");
      expect(result).not.toContain("line 8");
    });

    it("should error on non-existent file", async () => {
      await expect(
        readFileTool.executor(
          { file_path: path.join(tmpDir, "nope.txt") },
          env,
        ),
      ).rejects.toThrow();
    });
  });

  // ----------------------------------------------------------------
  // write_file
  // ----------------------------------------------------------------
  describe("write_file tool", () => {
    it("should write a file and return confirmation", async () => {
      const filePath = path.join(tmpDir, "new.txt");
      const result = await writeFileTool.executor(
        { file_path: filePath, content: "hello world" },
        env,
      );

      expect(result).toContain("Successfully wrote");
      expect(result).toContain("11 bytes");

      const content = await fs.readFile(filePath, "utf-8");
      expect(content).toBe("hello world");
    });

    it("should create parent directories", async () => {
      const filePath = path.join(tmpDir, "a", "b", "c", "file.txt");
      await writeFileTool.executor(
        { file_path: filePath, content: "deep" },
        env,
      );
      const content = await fs.readFile(filePath, "utf-8");
      expect(content).toBe("deep");
    });
  });

  // ----------------------------------------------------------------
  // edit_file
  // ----------------------------------------------------------------
  describe("edit_file tool", () => {
    it("should replace a unique occurrence", async () => {
      const filePath = path.join(tmpDir, "edit.txt");
      await fs.writeFile(filePath, "hello world\ngoodbye world\n");

      const result = await editFileTool.executor(
        {
          file_path: filePath,
          old_string: "hello world",
          new_string: "hi there",
        },
        env,
      );

      expect(result).toContain("Successfully replaced 1 occurrence");
      const content = await fs.readFile(filePath, "utf-8");
      expect(content).toContain("hi there");
      expect(content).toContain("goodbye world");
    });

    it("should error when old_string is not found", async () => {
      const filePath = path.join(tmpDir, "edit2.txt");
      await fs.writeFile(filePath, "hello world\n");

      await expect(
        editFileTool.executor(
          {
            file_path: filePath,
            old_string: "nonexistent text",
            new_string: "replacement",
          },
          env,
        ),
      ).rejects.toThrow("old_string not found");
    });

    it("should error when old_string is not unique and replace_all is false", async () => {
      const filePath = path.join(tmpDir, "dup.txt");
      await fs.writeFile(filePath, "abc\nabc\nabc\n");

      await expect(
        editFileTool.executor(
          {
            file_path: filePath,
            old_string: "abc",
            new_string: "xyz",
          },
          env,
        ),
      ).rejects.toThrow("not unique");
    });

    it("should replace all occurrences when replace_all is true", async () => {
      const filePath = path.join(tmpDir, "dup2.txt");
      await fs.writeFile(filePath, "abc\nabc\nabc\n");

      const result = await editFileTool.executor(
        {
          file_path: filePath,
          old_string: "abc",
          new_string: "xyz",
          replace_all: true,
        },
        env,
      );

      expect(result).toContain("3 occurrences");
      const content = await fs.readFile(filePath, "utf-8");
      expect(content).not.toContain("abc");
      expect(content.split("xyz").length - 1).toBe(3);
    });

    it("should handle multiline replacements", async () => {
      const filePath = path.join(tmpDir, "multi.txt");
      await fs.writeFile(filePath, "function hello() {\n  return 1;\n}\n");

      await editFileTool.executor(
        {
          file_path: filePath,
          old_string: "function hello() {\n  return 1;\n}",
          new_string: "function hello() {\n  return 42;\n}",
        },
        env,
      );

      const content = await fs.readFile(filePath, "utf-8");
      expect(content).toContain("return 42");
    });
  });
});
