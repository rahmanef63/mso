import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { childEnv } from "@/lib/host/child-env";
import { resolveCwd } from "@/lib/host/exec";
import { redactText } from "@/lib/security/redact-text";
import { resolveSessionArtifactCandidate } from "./session-artifact-path";
import { ARTIFACT_FILE_LIMIT, authorizeArtifactPath, readArtifactFile as regularFileInfo } from "./session-artifact-read";
import type { AgentSessionArtifactRevision, AgentSessionEvent } from "./session-types";

const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_FILE_BYTES = ARTIFACT_FILE_LIMIT;
const MAX_SNAPSHOT_TEXT = 128 * 1024;
const MAX_DIFF_BYTES = 256 * 1024;
const GIT_TIMEOUT_MS = 5_000;

type GitResult = { code: number; stdout: Buffer; stderr: Buffer };

async function git(cwd: string, args: string[], maxBytes = MAX_DIFF_BYTES): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, env: childEnv() as NodeJS.ProcessEnv, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let bytes = 0, settled = false;
    const timer = setTimeout(() => finish(new Error(`git timed out after ${GIT_TIMEOUT_MS}ms`)), GIT_TIMEOUT_MS);
    const finish = (error?: Error, result?: GitResult) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      error ? reject(error) : resolve(result!);
    };
    const take = (target: Buffer[], chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) return finish(new Error(`git output exceeded ${maxBytes} bytes`));
      target.push(Buffer.from(chunk));
    };
    child.stdout.on("data", (chunk: Buffer) => take(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => take(stderr, chunk));
    child.on("error", (error) => finish(new Error(`git failed to start: ${error.message}`)));
    child.on("close", (code) => finish(undefined, { code: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
}

function safeRel(value: string): boolean {
  return Boolean(value && !path.isAbsolute(value) && value !== ".." && !value.startsWith("../") && !value.includes("\0"));
}

function parseLsTree(buffer: Buffer, wanted: string): string | undefined {
  const body = buffer.toString("utf8");
  for (const row of body.split("\0")) {
    if (!row) continue;
    const tab = row.indexOf("\t");
    if (tab < 0) continue;
    const meta = row.slice(0, tab).split(" "), file = row.slice(tab + 1);
    if (file === wanted && meta[1] === "blob" && OID.test(meta[2] || "")) return meta[2]!.toLowerCase();
  }
  return undefined;
}

function toolWorthCapturing(event: Pick<AgentSessionEvent, "kind" | "tool">): boolean {
  if (event.kind !== "tool") return false;
  const tool = (event.tool || "").toLowerCase();
  return /(?:^|_)(?:write|delete|move|copy|patch|edit)(?:$|_)/.test(tool) || /^(?:exec(?:_|\.)|terminal|shell|project_script_run)/.test(tool);
}

/** Capture proof metadata only. No source body is persisted into the session record. */
export async function captureSessionArtifactRevision(event: Pick<AgentSessionEvent, "kind" | "tool" | "detail">, cwd?: string): Promise<AgentSessionArtifactRevision | undefined> {
  if (!cwd || !toolWorthCapturing(event)) return undefined;
  const dir = await resolveCwd(cwd).catch(() => null);
  if (!dir) return undefined;
  const candidate = resolveSessionArtifactCandidate(event.detail, dir);
  if (!candidate || !await authorizeArtifactPath(candidate.path)) return undefined;
  const current = await regularFileInfo(candidate.path);
  const base: AgentSessionArtifactRevision = {
    version: 1, cwd: dir, relativePath: candidate.relativePath,
    ...(current ? { worktreeSha256: current.sha256, bytes: current.size } : {}),
  };
  try {
    const rootResult = await git(dir, ["rev-parse", "--show-toplevel", "HEAD"], 16 * 1024);
    if (rootResult.code !== 0) return base;
    const [rootRaw = "", headRaw = ""] = rootResult.stdout.toString("utf8").trim().split("\n");
    const repoRoot = await resolveCwd(rootRaw).catch(() => null);
    const head = headRaw.trim().toLowerCase();
    if (!repoRoot || !OID.test(head)) return base;
    const repoRel = path.relative(repoRoot, candidate.path).replaceAll(path.sep, "/");
    if (!safeRel(repoRel)) return base;
    const tree = await git(repoRoot, ["ls-tree", "-z", "HEAD", "--", repoRel], 32 * 1024);
    const headBlob = tree.code === 0 ? parseLsTree(tree.stdout, repoRel) : undefined;
    // Git blob IDs are content hashes; compute from the already-read bytes instead
    // of spawning diff/hash-object or running repository filters for every event.
    const worktreeBlob = current ? createHash(head.length === 64 ? "sha256" : "sha1")
      .update(`blob ${current.size}\0`).update(current.bytes).digest("hex") : undefined;
    const cleanAtCapture = Boolean(current && headBlob && headBlob === worktreeBlob);
    return {
      ...base, repoRoot, repoRelativePath: repoRel, gitHead: head,
      ...(headBlob ? { headBlob } : {}), ...(worktreeBlob ? { worktreeBlob } : {}), cleanAtCapture,
    };
  } catch { return base; }
}

export function validSessionArtifactRevision(value: unknown): value is AgentSessionArtifactRevision {
  if (!value || typeof value !== "object") return false;
  const row = value as AgentSessionArtifactRevision;
  if (row.version !== 1 || typeof row.cwd !== "string" || row.cwd.length > 4096 || typeof row.relativePath !== "string" || row.relativePath.length > 4096 || !safeRel(row.relativePath)) return false;
  if (row.repoRoot !== undefined && (typeof row.repoRoot !== "string" || row.repoRoot.length > 4096)) return false;
  if (row.repoRelativePath !== undefined && (typeof row.repoRelativePath !== "string" || row.repoRelativePath.length > 4096 || !safeRel(row.repoRelativePath))) return false;
  for (const oid of [row.gitHead, row.headBlob, row.worktreeBlob]) if (oid !== undefined && (typeof oid !== "string" || !OID.test(oid))) return false;
  if (row.worktreeSha256 !== undefined && (typeof row.worktreeSha256 !== "string" || !SHA256.test(row.worktreeSha256))) return false;
  if (row.bytes !== undefined && (!Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > MAX_FILE_BYTES)) return false;
  if (row.cleanAtCapture !== undefined && typeof row.cleanAtCapture !== "boolean") return false;
  return true;
}

type ExactSnapshot = { bytes: Buffer; source: "git-blob" | "current-match"; blobOid?: string };

async function exactSnapshot(revision: AgentSessionArtifactRevision, current: Awaited<ReturnType<typeof regularFileInfo>>): Promise<ExactSnapshot | null> {
  if (current && revision.worktreeSha256 && current.sha256 === revision.worktreeSha256) return { bytes: current.bytes, source: "current-match" };
  const repoRoot = revision.repoRoot ? await resolveCwd(revision.repoRoot).catch(() => null) : null;
  if (!repoRoot) return null;
  const candidates = [revision.cleanAtCapture ? revision.headBlob : undefined, revision.worktreeBlob].filter((oid, index, rows): oid is string => Boolean(oid && rows.indexOf(oid) === index));
  for (const oid of candidates) {
    if (!OID.test(oid)) continue;
    const kind = await git(repoRoot, ["cat-file", "-t", oid], 1024).catch(() => null);
    if (kind?.code !== 0 || kind.stdout.toString("utf8").trim() !== "blob") continue;
    const blob = await git(repoRoot, ["cat-file", "blob", oid], MAX_FILE_BYTES + 1024).catch(() => null);
    if (!blob || blob.code !== 0 || blob.stdout.length > MAX_FILE_BYTES) continue;
    if (revision.worktreeSha256 && createHash("sha256").update(blob.stdout).digest("hex") !== revision.worktreeSha256) continue;
    return { bytes: blob.stdout, source: "git-blob", blobOid: oid };
  }
  return null;
}

async function unifiedDiff(relativePath: string, historical: Buffer, current: Buffer): Promise<{ text: string; changed: boolean } | null> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-artifact-diff-"));
  await fs.chmod(root, 0o700).catch(() => undefined);
  const oldFile = path.join(root, `${randomUUID()}.old`);
  const currentPath = path.join(root, `${randomUUID()}.new`);
  try {
    await fs.writeFile(oldFile, historical, { mode: 0o600, flag: "wx" });
    await fs.writeFile(currentPath, current, { mode: 0o600, flag: "wx" });
    const result = await git(root, ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--unified=3", "--", oldFile, currentPath], MAX_DIFF_BYTES).catch(() => null);
    if (!result || (result.code !== 0 && result.code !== 1)) return null;
    let text = result.stdout.toString("utf8");
    text = text.replaceAll(oldFile, `a/${relativePath}`).replaceAll(currentPath, `b/${relativePath}`);
    return { text, changed: result.code === 1 };
  } finally { await fs.rm(root, { recursive: true, force: true }).catch(() => undefined); }
}

export async function resolveArtifactRevisionView(revision: AgentSessionArtifactRevision | undefined) {
  if (!revision || !validSessionArtifactRevision(revision)) return {
    capture: { state: "legacy" as const, exactAtCapture: false },
    current: { available: false as const },
    historical: { available: false as const, reason: "no_capture_proof" },
    diff: { available: false as const, reason: "no_capture_proof" },
  };
  const captureCwd = await resolveCwd(revision.cwd).catch(() => null);
  if (!captureCwd) return {
    capture: { state: "captured" as const, exactAtCapture: Boolean(revision.cleanAtCapture && revision.headBlob), sha256: revision.worktreeSha256, bytes: revision.bytes, gitHead: revision.gitHead, gitBlob: revision.cleanAtCapture ? revision.headBlob : undefined },
    current: { available: false as const }, historical: { available: false as const, reason: "capture_root_unavailable" }, diff: { available: false as const, reason: "capture_root_unavailable" },
  };
  const currentPath = path.resolve(captureCwd, revision.relativePath);
  const relCheck = path.relative(captureCwd, currentPath);
  if (!relCheck || relCheck === ".." || relCheck.startsWith(`..${path.sep}`) || path.isAbsolute(relCheck)) throw new Error("artifact revision escaped capture root");
  if (!await authorizeArtifactPath(currentPath)) return {
    capture: { state: "captured" as const, exactAtCapture: false },
    current: { available: false as const },
    historical: { available: false as const, reason: "path_unavailable" },
    diff: { available: false as const, reason: "path_unavailable" },
  };
  const current = await regularFileInfo(currentPath);
  const historical = await exactSnapshot(revision, current);
  const snapshotSha = historical ? createHash("sha256").update(historical.bytes).digest("hex") : undefined;
  const diff = historical && current ? await unifiedDiff(revision.relativePath, historical.bytes, current.bytes) : null;
  return {
    capture: {
      state: "captured" as const, exactAtCapture: Boolean(revision.cleanAtCapture && revision.headBlob), sha256: revision.worktreeSha256, bytes: revision.bytes,
      ...(revision.gitHead ? { gitHead: revision.gitHead } : {}), ...(revision.cleanAtCapture && revision.headBlob ? { gitBlob: revision.headBlob } : {}),
    },
    current: current ? { available: true as const, path: currentPath, sha256: current.sha256, bytes: current.size, matchesCapture: Boolean(revision.worktreeSha256 && current.sha256 === revision.worktreeSha256) } : { available: false as const },
    historical: historical ? {
      available: true as const, exact: true as const, source: historical.source, sha256: snapshotSha!, bytes: historical.bytes.length,
      ...(historical.blobOid ? { blobOid: historical.blobOid } : {}),
      ...(historical.bytes.length <= MAX_SNAPSHOT_TEXT ? { content: redactText(historical.bytes.toString("utf8")), previewRedacted: true, truncated: false } : { previewRedacted: true, truncated: true }),
    } : { available: false as const, reason: "exact_snapshot_unavailable" },
    diff: diff ? { available: true as const, changed: diff.changed, unifiedDiff: redactText(diff.text), previewRedacted: true } : { available: false as const, reason: historical ? "current_file_unavailable" : "exact_snapshot_unavailable" },
  };
}
