import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
export async function seedSessionMonitor(env, count = 9) {
  const root = env.OS_AGENT_SESSIONS_DIR;
  if (!root || !env.OS_LOCAL_AGENT_PRESENCE_STORE) throw new Error("Synthetic session stores required");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const now = Date.now(), entries = [];
  for (let i = 0; i < count; i++) {
    const id = "20260909_120000_" + i.toString(16).padStart(8, "0"), at = new Date(now - i * 1000).toISOString();
    const principalHash = (i % 2 ? "b" : "a").repeat(64);
    const row = { id, principalHash, source: i % 2 ? "mcp" : "cli", name: "fixture-" + i,
      title: "Session fixture " + i, titleSource: "manual", createdAt: at, updatedAt: at,
      memorySnapshot: {}, history: ["PRIVATE_TRANSCRIPT_MUST_NOT_LEAK"], contextSummary: "PRIVATE_CONTEXT_MUST_NOT_LEAK",
      events: Array.from({ length: 25 }, (_, n) => ({ at: new Date(now - (24 - n) * 100).toISOString(),
        kind: "tool", tool: "exec_run", state: n === 0 ? "failed" : "completed",
        detail: "Verify fixture " + n + " token=FIXTURE_SECRET_MUST_NOT_LEAK", workflowId: "workflow-fixture" })),
      estimatedTokens: 0, lifetimeEstimatedTokens: 0, compactThresholdTokens: 700000, compactionCount: 0, archiveCount: 0 };
    await writeFile(path.join(root, id + ".json"), JSON.stringify(row), { mode: 0o600 });
    entries.push({ sessionId: id, principalHash, alias: "agent-" + String.fromCharCode(97 + i), instanceId: "fixture",
      state: i === 8 ? "ended" : "idle", lastSeenAt: at, leaseUntil: new Date(now + 300000).toISOString() });
  }
  await mkdir(path.dirname(env.OS_LOCAL_AGENT_PRESENCE_STORE), { recursive: true, mode: 0o700 });
  await writeFile(env.OS_LOCAL_AGENT_PRESENCE_STORE, JSON.stringify({ version: 1, entries }), { mode: 0o600 });
}
