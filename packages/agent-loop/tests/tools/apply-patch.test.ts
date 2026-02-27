import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { LocalExecutionEnvironment } from "../../src/execution-env.js";
import { applyPatchTool } from "../../src/tools/apply-patch.js";

describe("apply_patch tool", () => {
  let tmpDir: string;
  let env: LocalExecutionEnvironment;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "patch-test-"));
    env = new LocalExecutionEnvironment(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should add a new file", async () => {
    const filePath = path.join(tmpDir, "new_file.py");
    const patch = `*** Begin Patch
*** Add File: ${filePath}
+def greet(name):
+    return f"Hello, {name}!"
*** End Patch`;

    const result = await applyPatchTool.executor({ patch }, env);
    expect(result).toContain("Added file");

    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toContain("def greet(name):");
    expect(content).toContain('return f"Hello, {name}!"');
  });

  it("should delete a file", async () => {
    const filePath = path.join(tmpDir, "to_delete.txt");
    await fs.writeFile(filePath, "delete me\n");

    const patch = `*** Begin Patch
*** Delete File: ${filePath}
*** End Patch`;

    const result = await applyPatchTool.executor({ patch }, env);
    expect(result).toContain("Deleted file");

    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it("should update a file with a single hunk", async () => {
    const filePath = path.join(tmpDir, "main.py");
    await fs.writeFile(
      filePath,
      'def main():\n    print("Hello")\n    return 0\n',
    );

    const patch = `*** Begin Patch
*** Update File: ${filePath}
@@ def main():
     print("Hello")
-    return 0
+    print("World")
+    return 1
*** End Patch`;

    const result = await applyPatchTool.executor({ patch }, env);
    expect(result).toContain("Updated file");

    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toContain('print("Hello")');
    expect(content).toContain('print("World")');
    expect(content).toContain("return 1");
    expect(content).not.toContain("return 0");
  });

  it("should update a file with multiple hunks", async () => {
    const filePath = path.join(tmpDir, "config.py");
    await fs.writeFile(
      filePath,
      'DEFAULT_TIMEOUT = 30\n\ndef load_config():\n    config = {}\n    config["debug"] = False\n    return config\n',
    );

    const patch = `*** Begin Patch
*** Update File: ${filePath}
@@ DEFAULT_TIMEOUT = 30
-DEFAULT_TIMEOUT = 30
+DEFAULT_TIMEOUT = 60
@@ def load_config():
     config = {}
-    config["debug"] = False
+    config["debug"] = True
*** End Patch`;

    const result = await applyPatchTool.executor({ patch }, env);
    expect(result).toContain("Updated file");

    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toContain("DEFAULT_TIMEOUT = 60");
    expect(content).toContain('config["debug"] = True');
    expect(content).not.toContain("DEFAULT_TIMEOUT = 30");
    expect(content).not.toContain("False");
  });

  it("should rename a file (move to)", async () => {
    const oldPath = path.join(tmpDir, "old_name.py");
    const newPath = path.join(tmpDir, "new_name.py");
    await fs.writeFile(oldPath, "import os\nimport sys\nimport old_dep\n");

    const patch = `*** Begin Patch
*** Update File: ${oldPath}
*** Move to: ${newPath}
@@ import os
 import sys
-import old_dep
+import new_dep
*** End Patch`;

    const result = await applyPatchTool.executor({ patch }, env);
    expect(result).toContain("renamed");

    // New file should exist with updated content
    const content = await fs.readFile(newPath, "utf-8");
    expect(content).toContain("import new_dep");
    expect(content).not.toContain("import old_dep");

    // Old file should be gone
    const oldExists = await fs.access(oldPath).then(() => true).catch(() => false);
    expect(oldExists).toBe(false);
  });

  it("should handle multiple operations in one patch", async () => {
    const addPath = path.join(tmpDir, "added.txt");
    const delPath = path.join(tmpDir, "deleted.txt");
    await fs.writeFile(delPath, "to be deleted\n");

    const patch = `*** Begin Patch
*** Add File: ${addPath}
+new content
*** Delete File: ${delPath}
*** End Patch`;

    const result = await applyPatchTool.executor({ patch }, env);
    expect(result).toContain("Added file");
    expect(result).toContain("Deleted file");

    const addedContent = await fs.readFile(addPath, "utf-8");
    expect(addedContent).toContain("new content");

    const delExists = await fs.access(delPath).then(() => true).catch(() => false);
    expect(delExists).toBe(false);
  });

  it("should error on empty patch", async () => {
    await expect(
      applyPatchTool.executor(
        { patch: "*** Begin Patch\n*** End Patch" },
        env,
      ),
    ).rejects.toThrow("no operations");
  });

  it("should error on missing Begin Patch marker", async () => {
    await expect(
      applyPatchTool.executor(
        { patch: "no begin marker\n*** End Patch" },
        env,
      ),
    ).rejects.toThrow("Begin Patch");
  });
});
