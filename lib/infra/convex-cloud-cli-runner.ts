import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { childEnv } from "@/lib/host/child-env";
import { resolveReadable } from "@/lib/host/paths";
import { IntegrationError } from "./identity";

export type ConvexCliResult = {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type RunConvexCli = (
  executable: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; timeoutMs: number },
) => Promise<ConvexCliResult>;

const MAX_CLI_OUTPUT = 64 * 1024;
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024 * 1024;

function appendBounded(current: string, chunk: Buffer | string): string {
  const text = current + chunk.toString();
  return text.length <= MAX_CLI_OUTPUT
    ? text
    : text.slice(text.length - MAX_CLI_OUTPUT);
}

export function redactConvexCliText(text: string, deployKey: string): string {
  if (!text) return "";
  return text
    .split(deployKey)
    .join("[REDACTED_DEPLOY_KEY]")
    .replace(
      /(?:prod|dev|preview|project):[A-Za-z0-9:_-]+\|[A-Za-z0-9+/=_-]{16,}/g,
      "[REDACTED_DEPLOY_KEY]",
    )
    .slice(-8_000);
}

export const runConvexCli: RunConvexCli = async (
  executable,
  args,
  options,
) =>
  new Promise<ConvexCliResult>((resolve, reject) => {
    const started = Date.now();
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end();
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk);
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, options.timeoutMs);
    child.once("error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stdout,
        stderr,
        durationMs: Date.now() - started,
      });
    });
  });

export async function convexProjectContext(projectPath: unknown) {
  if (typeof projectPath !== "string" || !projectPath.trim())
    throw new IntegrationError("invalid_project_path");
  const project = await resolveReadable(projectPath.trim()).catch(() => {
    throw new IntegrationError("invalid_project_path");
  });
  const stat = await fs.stat(project).catch(() => null);
  if (!stat?.isDirectory()) throw new IntegrationError("invalid_project_path");
  if (typeof process.getuid === "function" && stat.uid !== process.getuid())
    throw new IntegrationError("invalid_project_path");

  const convexDir = path.join(project, "convex");
  if (!(await fs.stat(convexDir).catch(() => null))?.isDirectory())
    throw new IntegrationError("convex_project_required", 409);

  const executable = path.join(project, "node_modules", ".bin", "convex");
  const cli = await fs.stat(executable).catch(() => null);
  if (!cli?.isFile())
    throw new IntegrationError("convex_cli_required", 409);

  return { project, executable };
}

export async function convexSnapshotContext(snapshotPath: unknown) {
  if (typeof snapshotPath !== "string" || !snapshotPath.trim())
    throw new IntegrationError("invalid_snapshot_path");
  const snapshot = await resolveReadable(snapshotPath.trim()).catch(() => {
    throw new IntegrationError("invalid_snapshot_path");
  });
  if (!snapshot.toLowerCase().endsWith(".zip"))
    throw new IntegrationError("convex_snapshot_zip_required");

  const handle = await fs
    .open(snapshot, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    .catch(() => {
      throw new IntegrationError("invalid_snapshot_path");
    });
  let stageDir = "";
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SNAPSHOT_BYTES)
      throw new IntegrationError("invalid_snapshot_path");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid())
      throw new IntegrationError("invalid_snapshot_path");

    const head = Buffer.alloc(4);
    const first = await handle.read(head, 0, 4, 0);
    if (
      first.bytesRead < 4 ||
      head[0] !== 0x50 ||
      head[1] !== 0x4b ||
      ![0x03, 0x05, 0x07].includes(head[2])
    )
      throw new IntegrationError("convex_snapshot_zip_required");

    // Import from a private copy produced from the same already-open descriptor that
    // we validate and hash. This closes the path TOCTOU window: replacing the user
    // path after validation cannot change the bytes later consumed by the Convex CLI.
    stageDir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-convex-snapshot-"));
    await fs.chmod(stageDir, 0o700);
    const stagedSnapshot = path.join(stageDir, "snapshot.zip");
    const staged = await fs.open(
      stagedSnapshot,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    const hash = createHash("sha256");
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    try {
      while (offset < stat.size) {
        const requested = Math.min(chunk.length, stat.size - offset);
        const { bytesRead } = await handle.read(chunk, 0, requested, offset);
        if (bytesRead <= 0) throw new IntegrationError("invalid_snapshot_path");
        const view = chunk.subarray(0, bytesRead);
        hash.update(view);
        let written = 0;
        while (written < bytesRead) {
          const result = await staged.write(
            view,
            written,
            bytesRead - written,
            offset + written,
          );
          if (result.bytesWritten <= 0)
            throw new IntegrationError("invalid_snapshot_path");
          written += result.bytesWritten;
        }
        offset += bytesRead;
      }
      await staged.sync();
    } finally {
      await staged.close().catch(() => undefined);
    }

    const after = await handle.stat();
    if (
      after.dev !== stat.dev ||
      after.ino !== stat.ino ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    )
      throw new IntegrationError("invalid_snapshot_path");

    return {
      snapshot,
      stagedSnapshot,
      size: stat.size,
      sha256: hash.digest("hex"),
      cleanup: async () => {
        await fs.rm(stageDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (stageDir) await fs.rm(stageDir, { recursive: true, force: true });
    throw error;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export function convexCliEnv(deployKey: string): Record<string, string> {
  const env = childEnv();
  delete env.CONVEX_DEPLOYMENT;
  delete env.CONVEX_SELF_HOSTED_URL;
  delete env.CONVEX_SELF_HOSTED_ADMIN_KEY;
  delete env.CONVEX_OVERRIDE_ACCESS_TOKEN;
  env.CONVEX_DEPLOY_KEY = deployKey;
  env.CI = "1";
  return env;
}

export function throwConvexCliFailure(
  operation: "deploy" | "import",
  result: ConvexCliResult,
  deployKey: string,
): never {
  const redacted = redactConvexCliText(
    [result.stderr, result.stdout].filter(Boolean).join("\n"),
    deployKey,
  );
  const error = new IntegrationError(
    operation === "deploy"
      ? "convex_cloud_deploy_failed"
      : "convex_cloud_import_failed",
    502,
  );
  Object.assign(error, {
    detail: redacted || `convex ${operation} exited ${result.code}`,
  });
  throw error;
}
