import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { childEnv } from "./child-env";
import { HostError } from "./host-error";

const runFile = promisify(execFile);
const MAX_OUTPUT = 256 * 1024;

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await runFile("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: MAX_OUTPUT,
      env: childEnv() as NodeJS.ProcessEnv,
    });
    return stdout.trim();
  } catch (error) {
    const row = error as { stderr?: string; stdout?: string };
    const detail = String(row.stderr || row.stdout || (error instanceof Error ? error.message : error)).trim().slice(0, 500);
    throw new HostError(detail ? `Git workspace operation failed: ${detail}` : "Git workspace operation failed");
  }
}

function safeSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 42);
  return slug || "project";
}

function worktreeRoot(): string {
  const configured = process.env.MSO_AGENT_WORKTREE_ROOT?.trim();
  if (configured) return configured.replace(/^~(?=$|\/)/, os.homedir());
  return path.join(os.homedir(), ".cache", "mso-worktrees");
}

export type PreparedProjectWorktree = {
  canonicalPath: string;
  workspacePath: string;
  branch: string;
  baseCommit: string;
  created: boolean;
};

/**
 * Create one task-owned linked worktree from a clean canonical checkout.
 *
 * This helper intentionally does NOT integrate, delete, reset or stash anything.
 * If the canonical tree is dirty it fails closed so one workflow never "helps"
 * another by hiding or committing its source state.
 */
export async function prepareProjectWorktree(projectPath: string): Promise<PreparedProjectWorktree> {
  // Runtime host paths are policy-guarded inputs, never deploy-time project assets.
  const canonicalPath = await fs.realpath(projectPath).catch(() => null);
  if (!canonicalPath) throw new HostError("Project path does not exist");
  const top = await git(canonicalPath, ["rev-parse", "--show-toplevel"]);
  const topReal = await fs.realpath(/* turbopackIgnore: true */ top).catch(() => top);
  if (topReal !== canonicalPath) throw new HostError("Source isolation requires the exact Git project root");

  const marker = await fs.lstat(path.join(canonicalPath, ".git")).catch(() => null);
  if (marker?.isFile()) {
    const branch = await git(canonicalPath, ["branch", "--show-current"]);
    const baseCommit = await git(canonicalPath, ["rev-parse", "HEAD"]);
    return { canonicalPath, workspacePath: canonicalPath, branch, baseCommit, created: false };
  }
  if (!marker?.isDirectory() || marker.isSymbolicLink()) throw new HostError("Source isolation requires a normal Git checkout");

  const dirty = await git(canonicalPath, ["status", "--porcelain"]);
  if (dirty) throw new HostError("Canonical project has uncommitted work; preserve its owner before starting another source-changing workflow");
  const baseCommit = await git(canonicalPath, ["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/.test(baseCommit)) throw new HostError("Could not prove the canonical Git commit");

  const root = path.resolve(/* turbopackIgnore: true */ worktreeRoot());
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const rootReal = await fs.realpath(/* turbopackIgnore: true */ root);
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const slug = safeSlug(path.basename(canonicalPath));
  const workspacePath = path.join(rootReal, `${slug}-${token}`);
  const branch = `agent/${slug}-${token}`;
  if (await fs.lstat(workspacePath).catch(() => null)) throw new HostError("Generated agent worktree path already exists");

  await git(canonicalPath, ["worktree", "add", "--no-track", "-b", branch, workspacePath, baseCommit]);
  const workspaceReal = await fs.realpath(workspacePath).catch(() => null);
  if (!workspaceReal || workspaceReal !== workspacePath) throw new HostError("Created worktree could not be verified");
  const [workspaceTop, workspaceHead, workspaceStatus] = await Promise.all([
    git(workspacePath, ["rev-parse", "--show-toplevel"]),
    git(workspacePath, ["rev-parse", "HEAD"]),
    git(workspacePath, ["status", "--porcelain"]),
  ]);
  if (await fs.realpath(workspaceTop) !== workspacePath || workspaceHead !== baseCommit || workspaceStatus) {
    throw new HostError("Created worktree failed identity/cleanliness verification; preserve it for inspection");
  }
  return { canonicalPath, workspacePath, branch, baseCommit, created: true };
}

/** Remove only a freshly-created workspace that still has zero unique bytes/commits.
 * Used for workflow-start rollback; integration cleanup remains explicit. */
export async function discardPreparedProjectWorktree(worktree: PreparedProjectWorktree): Promise<boolean> {
  if (!worktree.created || worktree.workspacePath === worktree.canonicalPath) return false;
  const workspaceStat = await fs.lstat(worktree.workspacePath).catch(() => null);
  if (!workspaceStat?.isDirectory() || workspaceStat.isSymbolicLink()) return false;
  const [head, status, branch] = await Promise.all([
    git(worktree.workspacePath, ["rev-parse", "HEAD"]),
    git(worktree.workspacePath, ["status", "--porcelain"]),
    git(worktree.workspacePath, ["branch", "--show-current"]),
  ]);
  if (head !== worktree.baseCommit || status || branch !== worktree.branch) return false;
  await git(worktree.canonicalPath, ["worktree", "remove", worktree.workspacePath]);
  await git(worktree.canonicalPath, ["branch", "-D", worktree.branch]);
  return true;
}

export async function discardWorkflowWorktreeIfUnchanged(input: { canonicalPath: string; workspacePath: string; baseCommit?: string }): Promise<boolean> {
  const canonicalPath = await fs.realpath(input.canonicalPath).catch(() => null);
  const workspacePath = await fs.realpath(input.workspacePath).catch(() => null);
  if (!canonicalPath || !workspacePath || canonicalPath === workspacePath) return false;
  const root = await fs.realpath(/* turbopackIgnore: true */ path.resolve(/* turbopackIgnore: true */ worktreeRoot())).catch(() => null);
  if (!root) return false;
  const rel = path.relative(root, workspacePath);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const [head, status, branch] = await Promise.all([
    git(workspacePath, ["rev-parse", "HEAD"]),
    git(workspacePath, ["status", "--porcelain"]),
    git(workspacePath, ["branch", "--show-current"]),
  ]);
  if (!branch.startsWith("agent/") || status || (input.baseCommit && head !== input.baseCommit)) return false;
  await git(canonicalPath, ["worktree", "remove", workspacePath]);
  await git(canonicalPath, ["branch", "-D", branch]);
  return true;
}

function insideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Resolve only MSO-owned linked-worktree paths back to their canonical checkout.
 * This is the explicit exception that lets project-scoped tools operate on a task
 * workspace without making arbitrary hidden directories globally resolvable. */
export async function linkedWorkflowWorktreeCanonicalPath(candidatePath: string): Promise<string | null> {
  const root = await fs.realpath(/* turbopackIgnore: true */ path.resolve(/* turbopackIgnore: true */ worktreeRoot())).catch(() => null);
  const candidate = await fs.realpath(candidatePath).catch(() => null);
  if (!root || !candidate || candidate === root || !insideRoot(root, candidate)) return null;
  const marker = await fs.lstat(path.join(candidate, ".git")).catch(() => null);
  if (!marker?.isFile() || marker.isSymbolicLink()) return null;
  const commonRaw = await git(candidate, ["rev-parse", "--git-common-dir"]).catch(() => "");
  if (!commonRaw) return null;
  const common = await fs.realpath(path.resolve(candidate, commonRaw)).catch(() => null);
  if (!common || path.basename(common) !== ".git") return null;
  const canonical = await fs.realpath(path.dirname(common)).catch(() => null);
  if (!canonical || canonical === candidate) return null;
  const canonicalMarker = await fs.lstat(path.join(canonical, ".git")).catch(() => null);
  if (!canonicalMarker?.isDirectory() || canonicalMarker.isSymbolicLink()) return null;
  return canonical;
}
