import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ArtifactStore } from "../../src/state/artifact-store.js";

describe("ArtifactStore", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = undefined;
  });

  it("stores and retrieves in-memory artifacts", () => {
    const store = new ArtifactStore();
    const data = { code: "console.log('hello')", language: "javascript" };

    const info = store.store("artifact-1", "code-output", data);
    expect(info.id).toBe("artifact-1");
    expect(info.name).toBe("code-output");
    expect(info.isFileBacked).toBe(false);
    expect(info.sizeBytes).toBeGreaterThan(0);

    const retrieved = store.retrieve("artifact-1");
    expect(retrieved).toEqual(data);
  });

  it("has checks existence", () => {
    const store = new ArtifactStore();
    expect(store.has("missing")).toBe(false);

    store.store("exists", "test", { value: 1 });
    expect(store.has("exists")).toBe(true);
  });

  it("list returns all artifact info", () => {
    const store = new ArtifactStore();
    store.store("a1", "first", { x: 1 });
    store.store("a2", "second", { x: 2 });

    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list.map((i) => i.id).sort()).toEqual(["a1", "a2"]);
  });

  it("remove deletes an artifact", () => {
    const store = new ArtifactStore();
    store.store("a1", "test", { data: true });
    expect(store.has("a1")).toBe(true);

    store.remove("a1");
    expect(store.has("a1")).toBe(false);
  });

  it("clear removes all artifacts", () => {
    const store = new ArtifactStore();
    store.store("a1", "first", { x: 1 });
    store.store("a2", "second", { x: 2 });

    store.clear();
    expect(store.list()).toHaveLength(0);
    expect(store.has("a1")).toBe(false);
    expect(store.has("a2")).toBe(false);
  });

  it("throws on retrieving non-existent artifact", () => {
    const store = new ArtifactStore();
    expect(() => store.retrieve("missing")).toThrow("Artifact not found");
  });

  it("file-backs large artifacts when baseDir is set", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "attractor-artifact-test-"));
    // Use a very low threshold so our test data triggers file-backing
    const store = new ArtifactStore(tmpDir, 10);

    const data = { large: "This is a larger payload that exceeds the threshold" };
    const info = store.store("big-artifact", "large-data", data);

    expect(info.isFileBacked).toBe(true);
    expect(info.sizeBytes).toBeGreaterThan(10);

    // File should exist
    const artifactPath = path.join(tmpDir, "artifacts", "big-artifact.json");
    expect(fs.existsSync(artifactPath)).toBe(true);

    // Retrieval should work
    const retrieved = store.retrieve("big-artifact");
    expect(retrieved).toEqual(data);
  });

  it("does not file-back when no baseDir is set", () => {
    // No baseDir, even large data stays in memory
    const store = new ArtifactStore(undefined, 10);
    const data = { large: "This exceeds the threshold but has no baseDir" };
    const info = store.store("big", "data", data);

    expect(info.isFileBacked).toBe(false);
    expect(store.retrieve("big")).toEqual(data);
  });

  it("remove cleans up file-backed artifact files", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "attractor-artifact-test-"));
    const store = new ArtifactStore(tmpDir, 10);

    store.store("fb-artifact", "test", { data: "file-backed content for testing" });
    const artifactPath = path.join(tmpDir, "artifacts", "fb-artifact.json");
    expect(fs.existsSync(artifactPath)).toBe(true);

    store.remove("fb-artifact");
    expect(fs.existsSync(artifactPath)).toBe(false);
  });

  it("rejects path traversal in artifact IDs", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "attractor-artifact-test-"));
    const store = new ArtifactStore(tmpDir, 10);

    const data = { payload: "This exceeds the threshold to trigger file-backing" };
    expect(() => store.store("../../etc/malicious", "exploit", data)).toThrow(
      'Invalid artifact ID: "../../etc/malicious"',
    );
  });

  it("stores artifacts with different data types", () => {
    const store = new ArtifactStore();

    store.store("string-data", "text", "simple string");
    expect(store.retrieve("string-data")).toBe("simple string");

    store.store("number-data", "count", 42);
    expect(store.retrieve("number-data")).toBe(42);

    store.store("array-data", "list", [1, 2, 3]);
    expect(store.retrieve("array-data")).toEqual([1, 2, 3]);
  });
});
