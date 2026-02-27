/**
 * LocalExecutionEnvironment: default implementation that runs on the local machine.
 */

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { glob as fsGlob } from "node:fs";

import type {
  ExecutionEnvironment,
  ExecResult,
  ExecOptions,
  DirEntry,
  GrepOptions,
} from "./types.js";

/** Patterns for environment variables that should be excluded from child processes. */
const SENSITIVE_VAR_PATTERNS = [
  /_API_KEY$/i,
  /_SECRET$/i,
  /_TOKEN$/i,
  /_PASSWORD$/i,
  /_CREDENTIAL$/i,
];

/** Environment variables that are always inherited. */
const ALWAYS_INHERIT = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "TERM",
  "TMPDIR",
  "GOPATH",
  "CARGO_HOME",
  "NVM_DIR",
  "RUSTUP_HOME",
  "PYENV_ROOT",
]);

/**
 * Filter environment variables: exclude sensitive ones, always include safe ones.
 */
function filterEnvVars(
  env: NodeJS.ProcessEnv,
  extra?: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;

    // Always include safe variables
    if (ALWAYS_INHERIT.has(key)) {
      result[key] = value;
      continue;
    }

    // Exclude sensitive variables
    const isSensitive = SENSITIVE_VAR_PATTERNS.some((pattern) =>
      pattern.test(key),
    );
    if (!isSensitive) {
      result[key] = value;
    }
  }

  // Merge in extra env vars (these override everything)
  if (extra) {
    Object.assign(result, extra);
  }

  return result;
}

/**
 * Check if buffer content looks like a binary file by looking for null bytes.
 */
function isBinaryContent(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export class LocalExecutionEnvironment implements ExecutionEnvironment {
  private _workingDirectory: string;

  constructor(workingDirectory?: string) {
    this._workingDirectory = workingDirectory ?? process.cwd();
  }

  workingDirectory(): string {
    return this._workingDirectory;
  }

  platform(): string {
    return process.platform;
  }

  private _resolve(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    return path.resolve(this._workingDirectory, filePath);
  }

  async readFileRaw(filePath: string): Promise<string> {
    const resolved = this._resolve(filePath);
    const buffer = await fs.readFile(resolved);
    if (isBinaryContent(buffer)) {
      throw new Error(`Cannot read binary file: ${filePath}`);
    }
    return buffer.toString("utf-8");
  }

  async readFile(
    filePath: string,
    offset?: number,
    limit?: number,
  ): Promise<string> {
    const resolved = this._resolve(filePath);
    const buffer = await fs.readFile(resolved);

    if (isBinaryContent(buffer)) {
      throw new Error(
        `Cannot read binary file: ${filePath}`,
      );
    }

    const content = buffer.toString("utf-8");
    const allLines = content.split("\n");
    // Remove trailing empty line from final newline
    if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
      allLines.pop();
    }

    const startIdx = offset ? offset - 1 : 0; // offset is 1-based
    const maxLines = limit ?? 2000;
    const selectedLines = allLines.slice(startIdx, startIdx + maxLines);
    const startLine = startIdx + 1;

    const maxLineNum = startLine + selectedLines.length - 1;
    const padWidth = String(maxLineNum).length;

    return selectedLines
      .map((line, i) => {
        const lineNum = String(startLine + i).padStart(padWidth, " ");
        return `${lineNum} | ${line}`;
      })
      .join("\n");
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const resolved = this._resolve(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");
  }

  async fileExists(filePath: string): Promise<boolean> {
    const resolved = this._resolve(filePath);
    try {
      await fs.access(resolved);
      return true;
    } catch {
      return false;
    }
  }

  async listDirectory(dirPath: string, depth?: number): Promise<DirEntry[]> {
    const resolved = this._resolve(dirPath);
    const maxDepth = depth ?? 1;
    const entries: DirEntry[] = [];

    async function walk(dir: string, currentDepth: number): Promise<void> {
      if (currentDepth > maxDepth) return;

      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        entries.push({
          name: currentDepth === 1 ? item.name : path.relative(resolved, path.join(dir, item.name)),
          isDirectory: item.isDirectory(),
          isFile: item.isFile(),
        });

        if (item.isDirectory() && currentDepth < maxDepth) {
          await walk(path.join(dir, item.name), currentDepth + 1);
        }
      }
    }

    await walk(resolved, 1);
    return entries;
  }

  async execCommand(
    command: string,
    options?: ExecOptions,
  ): Promise<ExecResult> {
    const timeoutMs = options?.timeoutMs ?? 10000;
    const workingDir = options?.workingDir
      ? this._resolve(options.workingDir)
      : this._workingDirectory;
    const envVars = filterEnvVars(process.env, options?.envVars);

    return new Promise<ExecResult>((resolve) => {
      const start = Date.now();
      let stdoutChunks: Buffer[] = [];
      let stderrChunks: Buffer[] = [];
      let timedOut = false;
      let settled = false;

      const child = spawn("bash", ["-c", command], {
        cwd: workingDir,
        env: envVars,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
          stderr: Buffer.concat(stderrChunks).toString("utf-8"),
          exitCode,
          durationMs,
          timedOut,
        });
      };

      child.on("close", (code) => {
        finish(code ?? 1);
      });

      child.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({
            stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
            stderr: err.message,
            exitCode: 1,
            durationMs: Date.now() - start,
            timedOut: false,
          });
        }
      });

      const timer = setTimeout(() => {
        timedOut = true;
        // Send SIGTERM to process group
        try {
          if (child.pid) {
            process.kill(-child.pid, "SIGTERM");
          }
        } catch {
          // Process may already be dead
        }
        // Wait 2 seconds, then SIGKILL
        setTimeout(() => {
          try {
            if (child.pid) {
              process.kill(-child.pid, "SIGKILL");
            }
          } catch {
            // Process may already be dead
          }
        }, 2000);
      }, timeoutMs);
    });
  }

  async grep(
    pattern: string,
    searchPath?: string,
    options?: GrepOptions,
  ): Promise<string> {
    const resolved = searchPath
      ? this._resolve(searchPath)
      : this._workingDirectory;

    // Build grep command - prefer rg if available, fall back to grep
    const args: string[] = [];
    let cmd: string;

    // Check if rg is available
    const rgCheck = await this.execCommand("command -v rg", {
      timeoutMs: 2000,
    });
    const useRg = rgCheck.exitCode === 0;

    if (useRg) {
      cmd = "rg";
      args.push("-n"); // line numbers
      if (options?.caseInsensitive) args.push("-i");
      if (options?.globFilter) args.push("--glob", options.globFilter);
      if (options?.maxResults)
        args.push("--max-count", String(options.maxResults));
      args.push("--", pattern, resolved);
    } else {
      cmd = "grep";
      args.push("-rn"); // recursive + line numbers
      if (options?.caseInsensitive) args.push("-i");
      if (options?.globFilter) args.push("--include", options.globFilter);
      args.push("--", pattern, resolved);
    }

    const maxResults = options?.maxResults ?? 100;
    const fullCmd = `${cmd} ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")} | head -n ${maxResults}`;

    const result = await this.execCommand(fullCmd, { timeoutMs: 10000 });

    // grep returns exit code 1 for no matches, which is not an error
    if (result.exitCode > 1) {
      throw new Error(
        `grep failed (exit ${result.exitCode}): ${result.stderr}`,
      );
    }

    return result.stdout;
  }

  async glob(pattern: string, basePath?: string): Promise<string[]> {
    const resolved = basePath
      ? this._resolve(basePath)
      : this._workingDirectory;

    return new Promise<string[]>((resolve, reject) => {
      fsGlob(pattern, { cwd: resolved }, (err, matches) => {
        if (err) {
          reject(err);
          return;
        }

        // Convert to absolute paths and sort by mtime (newest first)
        const absolutePaths = matches.map((m) => path.resolve(resolved, m));

        // Get stats for sorting by mtime
        const withStats: Array<{ path: string; mtime: number }> = [];
        let pending = absolutePaths.length;

        if (pending === 0) {
          resolve([]);
          return;
        }

        for (const p of absolutePaths) {
          fsSync.stat(p, (statErr, stats) => {
            if (!statErr && stats) {
              withStats.push({ path: p, mtime: stats.mtimeMs });
            } else {
              // Include even if stat fails, with 0 mtime
              withStats.push({ path: p, mtime: 0 });
            }
            pending--;
            if (pending === 0) {
              // Sort by mtime descending (newest first)
              withStats.sort((a, b) => b.mtime - a.mtime);
              resolve(withStats.map((w) => w.path));
            }
          });
        }
      });
    });
  }
}
