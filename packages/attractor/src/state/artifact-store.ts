/**
 * ArtifactStore — named, typed storage for large stage outputs.
 *
 * In-memory for data < FILE_BACKING_THRESHOLD (100KB),
 * file-backed for larger data.
 *
 * See spec Section 5.5.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Default threshold: 100KB */
const FILE_BACKING_THRESHOLD = 100 * 1024;

export interface ArtifactInfo {
  id: string;
  name: string;
  sizeBytes: number;
  storedAt: string;
  isFileBacked: boolean;
}

export class ArtifactStore {
  private artifacts: Map<string, { info: ArtifactInfo; data: unknown }> = new Map();
  private baseDir: string | undefined;
  private threshold: number;

  constructor(baseDir?: string, threshold: number = FILE_BACKING_THRESHOLD) {
    this.baseDir = baseDir;
    this.threshold = threshold;
  }

  /**
   * Store an artifact. Returns metadata about the stored artifact.
   */
  store(artifactId: string, name: string, data: unknown): ArtifactInfo {
    const serialized = JSON.stringify(data);
    const sizeBytes = Buffer.byteLength(serialized, "utf-8");
    const isFileBacked = sizeBytes > this.threshold && this.baseDir !== undefined;

    let storedData: unknown;

    if (isFileBacked) {
      const artifactsDir = path.join(this.baseDir!, "artifacts");
      if (!fs.existsSync(artifactsDir)) {
        fs.mkdirSync(artifactsDir, { recursive: true });
      }
      const filePath = path.join(artifactsDir, `${artifactId}.json`);
      fs.writeFileSync(filePath, serialized, "utf-8");
      storedData = filePath;
    } else {
      storedData = data;
    }

    const info: ArtifactInfo = {
      id: artifactId,
      name,
      sizeBytes,
      storedAt: new Date().toISOString(),
      isFileBacked,
    };

    this.artifacts.set(artifactId, { info, data: storedData });
    return info;
  }

  /**
   * Retrieve an artifact by ID.
   */
  retrieve(artifactId: string): unknown {
    const entry = this.artifacts.get(artifactId);
    if (!entry) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    if (entry.info.isFileBacked) {
      const filePath = entry.data as string;
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw);
    }

    return entry.data;
  }

  /**
   * Check if an artifact exists.
   */
  has(artifactId: string): boolean {
    return this.artifacts.has(artifactId);
  }

  /**
   * List all artifact metadata.
   */
  list(): ArtifactInfo[] {
    return Array.from(this.artifacts.values()).map((entry) => entry.info);
  }

  /**
   * Remove an artifact by ID.
   */
  remove(artifactId: string): void {
    const entry = this.artifacts.get(artifactId);
    if (entry?.info.isFileBacked) {
      const filePath = entry.data as string;
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    this.artifacts.delete(artifactId);
  }

  /**
   * Remove all artifacts.
   */
  clear(): void {
    for (const [id] of this.artifacts) {
      this.remove(id);
    }
  }
}
