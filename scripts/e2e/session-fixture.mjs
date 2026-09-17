import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
export async function seedSessionMonitor(env, count = 9) {
  const root = env.OS_AGENT_SESSIONS_DIR;
  if (!root || !env.OS_LOCAL_AGENT_PRESENCE_STORE) throw new Error("Synthetic session stores required");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const project = path.join(path.dirname(root), "session-project");
  await mkdir(path.join(project, "src"), { recursive: true, mode: 0o700 });
  const original = "export const value = 1;\n", current = "export const value = 2;\n", artifactFile = path.join(project, "src", "fixture.ts");
  await writeFile(artifactFile, original, { mode: 0o600 });
  const git = (...args) => execFileSync("git", args, { cwd: project, encoding: "utf8" }).trim();
  git("init", "-b", "main"); git("config", "user.email", "release-fixture@example.invalid"); git("config", "user.name", "MSO Release Fixture");
  git("add", "src/fixture.ts"); git("commit", "-m", "fixture artifact");
  const gitHead = git("rev-parse", "HEAD"), headBlob = git("rev-parse", "HEAD:src/fixture.ts"), worktreeSha256 = createHash("sha256").update(original).digest("hex");
  const artifactRevision = { version: 1, cwd: project, relativePath: "src/fixture.ts", repoRoot: project, repoRelativePath: "src/fixture.ts", gitHead, headBlob, worktreeBlob: headBlob, worktreeSha256, bytes: Buffer.byteLength(original), cleanAtCapture: true };
  await writeFile(artifactFile, current, { mode: 0o600 });
  const now = Date.now(), entries = [];
  for (let i = 0; i < count; i++) {
    const id = "20260909_120000_" + i.toString(16).padStart(8, "0"), at = new Date(now - i * 1000).toISOString();
    const principalHash = (i % 2 ? "b" : "a").repeat(64);
    const row = { id, principalHash, source: i % 2 ? "mcp" : "cli", name: "fixture-" + i,
      title: "Session fixture " + i, titleSource: "manual", createdAt: at, updatedAt: at,
      memorySnapshot: {}, history: ["PRIVATE_TRANSCRIPT_MUST_NOT_LEAK"], contextSummary: "PRIVATE_CONTEXT_MUST_NOT_LEAK",
      cwd: project,
      events: Array.from({ length: 25 }, (_, n) => ({ at: new Date(now - (24 - n) * 100).toISOString(),
        kind: "tool", tool: n === 0 ? "fs_write" : "exec_run", state: n === 0 ? "completed" : "completed",
        detail: n === 0 ? "src/fixture.ts token=FIXTURE_SECRET_MUST_NOT_LEAK" : "Verify fixture " + n + " token=FIXTURE_SECRET_MUST_NOT_LEAK", workflowId: "workflow-fixture",
        ...(n === 0 ? { artifactRevision } : {}) })),
      estimatedTokens: 0, lifetimeEstimatedTokens: 0, compactThresholdTokens: 700000, compactionCount: 0, archiveCount: 0 };
    await writeFile(path.join(root, id + ".json"), JSON.stringify(row), { mode: 0o600 });
    entries.push({ sessionId: id, principalHash, alias: "agent-" + String.fromCharCode(97 + i), instanceId: "fixture",
      state: i === 8 ? "ended" : "idle", lastSeenAt: at, leaseUntil: new Date(now + 300000).toISOString() });
  }
  await mkdir(path.dirname(env.OS_LOCAL_AGENT_PRESENCE_STORE), { recursive: true, mode: 0o700 });
  await writeFile(env.OS_LOCAL_AGENT_PRESENCE_STORE, JSON.stringify({ version: 1, entries }), { mode: 0o600 });
}
