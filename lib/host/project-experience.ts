import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BOUNDED_READ, readBoundedRegularFile } from "./bounded-read";
import { resolveReadable } from "./paths";
import { childEnv } from "./child-env";
import { isCredentialPath } from "./path-credentials";
import { redactText } from "@/lib/security/redact-text";

const GIT_TIMEOUT_MS = 8_000;
const GIT_MAX_BYTES = 256 * 1024;
const KNOWLEDGE_REL = path.join(".mso", "KNOWLEDGE.md");
const MAX_KNOWLEDGE_BYTES = 10_000;
const SHA = /^[0-9a-f]{7,64}$/i;

type GitRun = { code: number; stdout: string; stderr: string };

async function git(projectPath: string, args: string[], maxBytes = GIT_MAX_BYTES): Promise<GitRun> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: projectPath,
      env: childEnv() as NodeJS.ProcessEnv,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", bytes = 0, settled = false;
    const finish = (error?: Error, result?: GitRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      error ? reject(error) : resolve(result!);
    };
    const take = (kind: "stdout" | "stderr", chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) return finish(new Error(`git output exceeded ${maxBytes} bytes`));
      if (kind === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => take("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => take("stderr", chunk));
    child.on("error", (error) => finish(new Error(`git failed to start: ${error.message}`)));
    child.on("close", (code) => finish(undefined, { code: code ?? 1, stdout, stderr }));
    const timer = setTimeout(() => finish(new Error(`git timed out after ${GIT_TIMEOUT_MS}ms`)), GIT_TIMEOUT_MS);
  });
}

function requireSha(value: string, field: string): string {
  if (!SHA.test(value)) throw new Error(`${field} must be a 7-64 character hexadecimal commit SHA`);
  return value;
}

export async function projectGitSnapshot(projectPath: string) {
  const result = await git(projectPath, ["status", "--short", "--branch"]);
  if (result.code !== 0) return { available: false, error: (result.stderr || result.stdout).trim().slice(0, 300) };
  const log = await git(projectPath, ["log", "-1", "--format=%H%x00%s%x00%aI%x00%an"]);
  const statusLines = result.stdout.split("\n").filter(Boolean);
  const changes = statusLines.slice(1, 101);
  const [sha = "", subject = "", date = "", author = ""] = log.code === 0 ? log.stdout.trim().split("\0") : [];
  return {
    available: true,
    branch: statusLines[0]?.replace(/^##\s*/, "") ?? "",
    clean: changes.length === 0,
    changes,
    head: sha ? { sha, subject, date, author } : undefined,
  };
}

export async function projectGitEdits(projectPath: string, options: { limit?: number; cursor?: string } = {}) {
  const limit = Math.min(Math.max(Math.round(options.limit ?? 20), 1), 50);
  const args = ["log", `--max-count=${limit + 1}`, "--format=%H%x00%h%x00%aI%x00%an%x00%s"];
  if (options.cursor) args.push(`${requireSha(options.cursor, "cursor")}^`);
  const result = await git(projectPath, args);
  if (result.code !== 0) throw new Error((result.stderr || result.stdout).trim().slice(0, 400) || "git log failed");
  const rows = result.stdout.split("\n").filter(Boolean).map((line) => {
    const [sha = "", shortSha = "", createdAt = "", author = "", subject = ""] = line.split("\0");
    return { sha, shortSha, createdAt, author, subject };
  });
  const hasMore = rows.length > limit;
  const edits = rows.slice(0, limit);
  return { edits, pagination: { hasMore, ...(hasMore && edits.length ? { nextCursor: edits.at(-1)!.sha } : {}) } };
}

export async function projectGitDiff(projectPath: string, options: { sha?: string; baseSha?: string; staged?: boolean } = {}) {
  const sha = options.sha ? requireSha(options.sha, "sha") : undefined;
  const baseSha = options.baseSha ? requireSha(options.baseSha, "base_sha") : undefined;
  const range = sha ? (baseSha ? `${baseSha}..${sha}` : `${sha}^..${sha}`) : undefined;
  const diffArgs = ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--unified=3"];
  const statArgs = ["diff", "--no-ext-diff", "--no-textconv", "--find-renames", "--numstat", "-z"];
  if (!range && options.staged) { diffArgs.push("--cached"); statArgs.push("--cached"); }
  if (range) { diffArgs.push(range); statArgs.push(range); }
  const stats = await git(projectPath, statArgs, 128 * 1024);
  if (stats.code !== 0) throw new Error((stats.stderr || stats.stdout).trim().slice(0, 400) || "git diff --numstat failed");
  const records = stats.stdout.split("\0");
  const files: Array<{file:string; previousFile?:string; added:number|null; deleted:number|null; redacted?:boolean}> = [];
  for (let index=0; index<records.length && records[index] && files.length<200; index+=1) {
    const [added="0",deleted="0",...name] = records[index].split("\t");
    const previousFile = name.join("\t") ? undefined : records[++index];
    const file = previousFile === undefined ? name.join("\t") : records[++index];
    if (!file) throw new Error("Invalid Git diff path metadata");
    const redacted = [file,previousFile].some(value=>value !== undefined && isCredentialPath(path.resolve(projectPath,value)));
    files.push({file,...(previousFile ? {previousFile} : {}),added:added==="-"?null:Number(added),deleted:deleted==="-"?null:Number(deleted),...(redacted?{redacted:true}:{})});
  }
  const readableFiles = files.filter((file) => !file.redacted);
  const diff = readableFiles.length ? await git(projectPath, [...diffArgs, "--", ...readableFiles.flatMap(({file,previousFile}) => (previousFile?[previousFile,file]:[file]).map(name=>`:(literal)${name}`))], 512 * 1024) : { code: 0, stdout: "", stderr: "" };
  if (diff.code !== 0) throw new Error(redactText((diff.stderr || diff.stdout).trim(), 400) || "git diff failed");
  const additions = files.reduce((sum, row) => sum + (row.added ?? 0), 0);
  const deletions = files.reduce((sum, row) => sum + (row.deleted ?? 0), 0);
  return {
    mode: range ? "commit" : options.staged ? "staged" : "working-tree",
    ...(sha ? { sha } : {}), ...(baseSha ? { baseSha } : {}),
    files, summary: { files: files.length, additions, deletions }, unifiedDiff: redactText(diff.stdout),
  };
}

export async function readProjectKnowledge(projectPath: string) {
  const root = await resolveReadable(projectPath);
  const directory = path.join(root, ".mso");
  const directoryStat = await fs.lstat(directory).catch(() => null);
  if (directoryStat && (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())) {
    throw new Error(`${KNOWLEDGE_REL} must be a regular non-symlink file in a real directory`);
  }
  const file = path.join(root, KNOWLEDGE_REL);
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat) return { exists: false, path: KNOWLEDGE_REL, content: "", bytes: 0, sha256: undefined };
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${KNOWLEDGE_REL} must be a regular non-symlink file`);
  const content = await readBoundedRegularFile(file, MAX_KNOWLEDGE_BYTES);
  if (content === null) throw new Error(`${KNOWLEDGE_REL} exceeds ${MAX_KNOWLEDGE_BYTES} bytes or is unreadable`);
  return { exists: true, path: KNOWLEDGE_REL, content, bytes: Buffer.byteLength(content, "utf8"), sha256: createHash("sha256").update(content).digest("hex") };
}

export async function detectProjectConvex(projectPath: string) {
  const packageRaw = await readBoundedRegularFile(path.join(projectPath, "package.json"), BOUNDED_READ.packageJson).catch(() => null);
  let dependency = false;
  if (packageRaw) {
    try {
      const pkg = JSON.parse(packageRaw) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
      dependency = typeof pkg.dependencies?.convex === "string" || typeof pkg.devDependencies?.convex === "string";
    } catch { /* project package metadata is optional */ }
  }
  const convexDir = await fs.lstat(path.join(projectPath, "convex")).catch(() => null);
  const envRaw = await readBoundedRegularFile(path.join(projectPath, ".env.local"), 64 * 1024).catch(() => null);
  const hasCloudDeployment = Boolean(envRaw && /^CONVEX_DEPLOYMENT\s*=/m.test(envRaw));
  const hasSelfHosted = Boolean(envRaw && /^CONVEX_SELF_HOSTED_URL\s*=/m.test(envRaw));
  const localCli = await fs.lstat(path.join(projectPath, "node_modules", ".bin", "convex")).catch(() => null);
  return {
    detected: dependency || Boolean(convexDir?.isDirectory()) || hasCloudDeployment || hasSelfHosted,
    dependency,
    convexDirectory: Boolean(convexDir?.isDirectory()),
    cliAvailable: Boolean(localCli?.isFile() || localCli?.isSymbolicLink()),
    configured: hasCloudDeployment || hasSelfHosted,
    mode: hasSelfHosted ? "self-hosted" : hasCloudDeployment ? "cloud" : "unconfigured",
  };
}

export const PROJECT_KNOWLEDGE_REL = KNOWLEDGE_REL;
export const PROJECT_KNOWLEDGE_MAX_BYTES = MAX_KNOWLEDGE_BYTES;
