// Forensic-shape contract for the audit trail. Complements audit.test.ts (which
// proves write semantics) by asserting that the JSONL payload itself ALWAYS
// carries the required forensic fields and NEVER smuggles plaintext credentials
// in target/detail. If a future writer leaks a token into `detail`, this test
// fails the build instead of leaking quietly to disk.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audit } from "./audit";

let logFile: string;

async function readEntries(): Promise<Record<string, unknown>[]> {
  const raw = await fs.readFile(logFile, "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function waitForLines(n: number, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const raw = await fs.readFile(logFile, "utf8").catch(() => "");
    if (raw.split("\n").filter(Boolean).length >= n) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-schema-"));
  logFile = path.join(dir, "audit.log");
  vi.stubEnv("OS_AUDIT_LOG", logFile);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(path.dirname(logFile), { recursive: true, force: true });
});

describe("audit JSONL schema contract", () => {
  it("every entry carries required fields with the expected types", async () => {
    // Mix of actions + actors + optional fields. All must satisfy the contract.
    audit({ action: "exec.run", actor: "device-A", target: "ls", ok: true });
    audit({ action: "fs.write", target: "/tmp/foo" });
    audit({ action: "auth.login", actor: "device-B", ip: "127.0.0.1", ok: true });
    audit({ action: "sys.cleanup", target: "apt-cache", detail: "freed 120MB" });
    await waitForLines(4);
    const entries = await readEntries();
    expect(entries).toHaveLength(4);
    for (const e of entries) {
      // ts: ISO8601 string parseable to a real Date.
      expect(typeof e.ts).toBe("string");
      expect(new Date(e.ts as string).toString()).not.toBe("Invalid Date");
      // action: required string.
      expect(typeof e.action).toBe("string");
      expect((e.action as string).length).toBeGreaterThan(0);
      // actor: string or null — never undefined (audit() normalises).
      expect(e.actor === null || typeof e.actor === "string").toBe(true);
      // ok defaults to true; type must always be boolean.
      expect(typeof e.ok).toBe("boolean");
    }
  });

  it("never persists a plaintext credential that a caller actually passed", async () => {
    // The trail is the last line of defense: a caller that stamps a token into
    // `target`/`detail`/`meta` must still land redacted on disk. Assert on the
    // SECRET VALUES, not on keyword patterns — a redacted line legitimately
    // contains the word "Bearer", so a /bearer\s+/i check would false-fail.
    const secret = ["sk", "live", "0123456789abcdef"].join("-");
    audit({
      action: "exec.run",
      actor: "device-1",
      target: `curl -H 'authorization: Bearer ${secret}' https://example.invalid`,
      detail: `failed with ${secret}`,
      ok: false,
      meta: { url: `https://example.invalid/?key=${secret}` },
    });
    audit({ action: "fs.write", target: "/home/user/notes.md", ok: true });
    await waitForLines(2);
    const raw = await fs.readFile(logFile, "utf8");
    expect(raw).toContain("[redacted]");
    expect(raw).not.toContain(secret);
    // Ordinary text an operator needs to read survives.
    expect(raw).toContain("/home/user/notes.md");
  });
});
