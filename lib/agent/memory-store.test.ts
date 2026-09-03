import { afterAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-agent-memory-p1-"));
process.env.OS_AGENT_MEMORY_DIR = root;
afterAll(async () => { delete process.env.OS_AGENT_MEMORY_DIR; await fs.rm(root, { recursive: true, force: true }); });
vi.resetModules();
const store = await import("./memory-store");

function dirFor(principal: string) {
  const key = createHash("sha256").update(principal).digest("hex").slice(0, 32);
  return path.join(root, key);
}

async function writeLegacy(principal: string, document: "USER.md" | "MEMORY.md", body: string) {
  const dir = dirFor(principal); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(dir, document), body, { mode: 0o600 });
}

describe("typed provenance-aware agent memory", () => {
  it("keeps legacy Markdown readable and seeds it into the structured ledger on first write", async () => {
    const principal = "memory:legacy";
    await writeLegacy(principal, "USER.md", "## Locale\nIndonesia\n\n## Editor\nVS Code\n");
    const before = await store.readAgentMemory(principal);
    expect(before.user).toContain("## Locale\nIndonesia");
    expect(before.schemaVersion).toBeUndefined();

    const after = await store.rememberAgentMemory(principal, "MEMORY.md", "Deploy rule", "Verify before ship", {
      kind: "procedural", provenance: { authority: "explicit", channel: "mcp" },
    });
    expect(after.schemaVersion).toBe(1);
    expect(after.user).toContain("## Editor\nVS Code");
    expect(after.memory).toContain("## Deploy rule\nVerify before ship");
    const ledger = JSON.parse(await fs.readFile(path.join(dirFor(principal), "records-v1.json"), "utf8"));
    expect(ledger.records).toHaveLength(3);
    expect(ledger.records[0].provenance.authority).toBe("migration");
  });

  it("supersedes a resolved value while preserving provenance/history", async () => {
    const principal = "memory:replace";
    await store.rememberAgentMemory(principal, "USER.md", "Primary stack", "Next.js", { provenance: { authority: "explicit", channel: "mcp", sessionHash: "abc123" } });
    await store.rememberAgentMemory(principal, "USER.md", "Primary stack", "SvelteKit", { kind: "semantic", confidence: 0.95, provenance: { authority: "explicit", channel: "mcp", sessionHash: "def456" } });
    const current = await store.queryAgentMemory(principal, { query: "primary stack" });
    expect(current.records).toHaveLength(1);
    expect(current.records[0].record.value).toBe("SvelteKit");
    expect(current.records[0].record.provenance.sessionHash).toBe("def456");
    const history = await store.queryAgentMemory(principal, { query: "stack", includeHistory: true, limit: 10 });
    expect(history.records).toHaveLength(2);
    expect(history.records.some((row) => row.record.supersededBy)).toBe(true);
    expect((await store.readAgentMemory(principal)).user).toContain("## Primary stack\nSvelteKit");
  });

  it("keeps parallel claims and resolves conflicts by authority, confidence, then recency", async () => {
    const principal = "memory:conflict";
    await store.rememberAgentMemory(principal, "MEMORY.md", "Release region", "Singapore", { mode: "claim", confidence: 0.7, provenance: { authority: "observed", channel: "system" } });
    await store.rememberAgentMemory(principal, "MEMORY.md", "Release region", "Jakarta", { mode: "claim", confidence: 0.6, provenance: { authority: "explicit", channel: "mcp" } });
    const result = await store.queryAgentMemory(principal, { query: "release region" });
    expect(result.records[0].record.value).toBe("Jakarta");
    expect(result.records[0].conflicts.map((row) => row.value)).toContain("Singapore");
  });

  it("resolves future supersession without erasing the currently valid fact early", async () => {
    const principal = "memory:temporal";
    const now = new Date(); const tomorrow = new Date(now.getTime() + 86_400_000); const later = new Date(now.getTime() + 2 * 86_400_000);
    await store.rememberAgentMemory(principal, "USER.md", "Office", "Jakarta", { validFrom: new Date(now.getTime() - 60_000).toISOString() });
    await store.rememberAgentMemory(principal, "USER.md", "Office", "Singapore", { validFrom: tomorrow.toISOString() });
    const before = await store.queryAgentMemory(principal, { query: "office", at: now.toISOString() });
    const after = await store.queryAgentMemory(principal, { query: "office", at: later.toISOString() });
    expect(before.records[0].record.value).toBe("Jakarta");
    expect(after.records[0].record.value).toBe("Singapore");
  });

  it("forgets scheduled future claims so a deleted key cannot resurrect later", async () => {
    const principal = "memory:forget-future";
    const now = Date.now(), tomorrow = new Date(now + 86_400_000), later = new Date(now + 2 * 86_400_000);
    await store.rememberAgentMemory(principal, "USER.md", "Office", "Jakarta", {
      validFrom: new Date(now - 60_000).toISOString(),
    });
    await store.rememberAgentMemory(principal, "USER.md", "Office", "Singapore", { validFrom: tomorrow.toISOString() });
    await store.forgetAgentMemory(principal, "USER.md", "Office");
    expect((await store.queryAgentMemory(principal, { query: "office" })).records).toHaveLength(0);
    expect((await store.queryAgentMemory(principal, { query: "office", at: later.toISOString() })).records).toHaveLength(0);
    const history = await store.queryAgentMemory(principal, { query: "office", includeHistory: true, limit: 10 });
    expect(history.records).toHaveLength(2);
    expect(history.records.every((row) => row.record.retractedAt)).toBe(true);
  });

  it("forgets current claims without rewriting already-finished historical evidence", async () => {
    const principal = "memory:forget-history";
    const now = Date.now(), old = new Date(now - 3 * 86_400_000), recent = new Date(now - 86_400_000);
    await store.rememberAgentMemory(principal, "MEMORY.md", "Region", "Jakarta", { validFrom: old.toISOString() });
    await store.rememberAgentMemory(principal, "MEMORY.md", "Region", "Singapore", { validFrom: recent.toISOString() });
    await store.forgetAgentMemory(principal, "MEMORY.md", "Region");
    const history = await store.queryAgentMemory(principal, { query: "region", includeHistory: true, limit: 10 });
    const jakarta = history.records.find((row) => row.record.value === "Jakarta")?.record;
    const singapore = history.records.find((row) => row.record.value === "Singapore")?.record;
    expect(jakarta?.supersededAt).toBe(recent.toISOString());
    expect(jakarta?.retractedAt).toBeUndefined();
    expect(singapore?.retractedAt).toBeTruthy();
  });

  it("retracts active claims on forget and keeps ledger/doc permissions private", async () => {
    const principal = "memory:forget";
    await store.rememberAgentMemory(principal, "MEMORY.md", "Temporary note", "Delete me");
    await store.forgetAgentMemory(principal, "MEMORY.md", "Temporary note");
    expect((await store.queryAgentMemory(principal, { query: "temporary" })).records).toHaveLength(0);
    expect((await store.readAgentMemory(principal)).memory).not.toContain("Temporary note");
    for (const name of ["records-v1.json", "MEMORY.md"]) {
      const stat = await fs.stat(path.join(dirFor(principal), name)); expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it("rejects invalid confidence and invalid temporal windows", async () => {
    await expect(store.rememberAgentMemory("memory:bad", "MEMORY.md", "Bad", "x", { confidence: 1.2 })).rejects.toThrow(/confidence/);
    await expect(store.rememberAgentMemory("memory:bad", "MEMORY.md", "Bad", "x", { validFrom: "2026-09-02T00:00:00Z", validUntil: "2026-09-01T00:00:00Z" })).rejects.toThrow(/valid_until/);
  });
});
