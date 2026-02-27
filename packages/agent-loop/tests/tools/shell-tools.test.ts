import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { LocalExecutionEnvironment } from "../../src/execution-env.js";
import { shellTool } from "../../src/tools/shell.js";

describe("Shell tool", () => {
  let tmpDir: string;
  let env: LocalExecutionEnvironment;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "shell-tool-test-"));
    env = new LocalExecutionEnvironment(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should execute a basic command and return output", async () => {
    const result = await shellTool.executor({ command: "echo hello" }, env);
    expect(result).toContain("hello");
    expect(result).toContain("exit_code: 0");
  });

  it("should include stderr in output", async () => {
    const result = await shellTool.executor(
      { command: "echo error >&2" },
      env,
    );
    expect(result).toContain("[stderr]");
    expect(result).toContain("error");
  });

  it("should include exit code", async () => {
    const result = await shellTool.executor({ command: "exit 1" }, env);
    expect(result).toContain("exit_code: 1");
  });

  it("should include duration", async () => {
    const result = await shellTool.executor({ command: "echo fast" }, env);
    expect(result).toMatch(/duration: \d+ms/);
  });

  it("should handle timeout", async () => {
    const result = await shellTool.executor(
      { command: "sleep 30", timeout_ms: 500 },
      env,
    );
    expect(result).toContain("timed out");
  }, 10000);

  it("should execute in the working directory", async () => {
    const result = await shellTool.executor({ command: "pwd" }, env);
    expect(result).toContain(tmpDir);
  });
});
