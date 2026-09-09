// Unit tests for the append-only JSONL audit trail (lib/host/audit.ts).
// Each test points OS_AUDIT_LOG at a fresh file in os.tmpdir() and cleans up after.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audit, readAuditTail } from "./audit";

let logFile: string;

async function readLines(): Promise<string[]> {
  const raw = await fs.readFile(logFile, "utf8").catch(() => "");
  return raw.split("\n").filter(Boolean);
}

async function waitForLines(n: number, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if ((await readLines()).length >= n) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-test-"));
  logFile = path.join(dir, "audit.log");
  vi.stubEnv("OS_AUDIT_LOG", logFile);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(path.dirname(logFile), { recursive: true, force: true });
});

describe("audit() append-only JSONL", () => {
  it("appends one valid JSON object terminated by newline", async () => {
    audit({ action: "exec.run", actor: "device-1", target: "echo hi", ok: true });
    await waitForLines(1);
    const raw = await fs.readFile(logFile, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    const lines = raw.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const obj = JSON.parse(lines[0]);
    expect(obj.action).toBe("exec.run");
    expect(obj.actor).toBe("device-1");
    expect(obj.target).toBe("echo hi");
    expect(obj.ok).toBe(true);
    expect(typeof obj.ts).toBe("string");
    // ts is an ISO8601 timestamp.
    expect(new Date(obj.ts).toString()).not.toBe("Invalid Date");
  });

  it("includes every required field even when caller omits optionals", async () => {
    audit({ action: "fs.write", target: "/tmp/x" });
    await waitForLines(1);
    const obj = JSON.parse((await readLines())[0]);
    expect(obj).toMatchObject({
      action: "fs.write",
      target: "/tmp/x",
      actor: null,
      ip: null,
      ok: true,
    });
  });

  // audit() now chains writes onto a single serialized promise queue, so even
  // bursty parallel callers land in STRICT submission order — the forensic
  // trail reads the way callers expect, without each caller needing to await.
  it("preserves strict submission order under bursty calls", async () => {
    const N = 25;
    // Fire-and-forget burst — no awaits between calls.
    for (let i = 0; i < N; i++) audit({ action: "exec.run", detail: `n=${i}` });
    await waitForLines(N);
    const lines = await readLines();
    expect(lines).toHaveLength(N);
    const details = lines.map((line) => JSON.parse(line).detail);
    expect(details).toEqual(Array.from({ length: N }, (_, i) => `n=${i}`));
  });

  it("preserves order under strictly sequential awaited calls", async () => {
    // When the caller awaits between calls, the trail IS in order — useful
    // contract for forensic reads when callers chain.
    for (let i = 0; i < 5; i++) {
      audit({ action: "exec.run", detail: `seq=${i}` });
      await waitForLines(i + 1);
    }
    const lines = await readLines();
    expect(lines.map((l) => JSON.parse(l).detail)).toEqual(["seq=0", "seq=1", "seq=2", "seq=3", "seq=4"]);
  });

  it("truncates oversized target + detail rather than writing huge lines", async () => {
    const big = "x".repeat(1000);
    audit({ action: "exec.run", target: big, detail: big });
    await waitForLines(1);
    const obj = JSON.parse((await readLines())[0]);
    expect(obj.target.length).toBeLessThan(big.length);
    expect(obj.target.endsWith("…")).toBe(true);
    // detail truncated at 256 < target's 512 cap.
    expect(obj.detail.length).toBeLessThan(obj.target.length);
  });

  it("clamps oversized meta string values so one bad caller can't bloat the log", async () => {
    const big = "y".repeat(1000);
    audit({ action: "exec.run", meta: { url: big, code: 7, ok: true } });
    await waitForLines(1);
    const obj = JSON.parse((await readLines())[0]);
    // String clamped at 256 + ellipsis (≤259 chars).
    expect(typeof obj.meta.url).toBe("string");
    expect(obj.meta.url.length).toBeLessThanOrEqual(259);
    expect(obj.meta.url.length).toBeLessThan(big.length);
    expect(obj.meta.url.endsWith("…")).toBe(true);
    // Non-string scalars untouched.
    expect(obj.meta.code).toBe(7);
    expect(obj.meta.ok).toBe(true);
  });

  it("creates the log directory if missing (mkdir recursive)", async () => {
    // Point at a deeper, not-yet-existing nested path.
    const deep = path.join(path.dirname(logFile), "a", "b", "c", "audit.log");
    vi.stubEnv("OS_AUDIT_LOG", deep);
    audit({ action: "auth.login", actor: "d1" });
    // Wait for the file to materialize via fire-and-forget mkdir+append.
    const deadline = Date.now() + 2000;
    let raw = "";
    while (Date.now() < deadline) {
      raw = await fs.readFile(deep, "utf8").catch(() => "");
      if (raw) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const obj = JSON.parse(raw.split("\n").filter(Boolean)[0]);
    expect(obj.action).toBe("auth.login");
  });

  it("does NOT throw when the write fails — fire-and-forget contract", async () => {
    // Point at a path whose parent is a regular file → mkdir fails.
    const blocker = path.join(path.dirname(logFile), "blocker");
    await fs.writeFile(blocker, "x");
    vi.stubEnv("OS_AUDIT_LOG", path.join(blocker, "audit.log"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => audit({ action: "exec.run" })).not.toThrow();
    // The unhandled rejection is caught + logged; allow the microtask to flush.
    await new Promise((r) => setTimeout(r, 100));
    errSpy.mockRestore();
  });
});

describe("readAuditTail", () => {
  it("returns [] when the log doesn't exist yet", async () => {
    vi.stubEnv("OS_AUDIT_LOG", path.join(path.dirname(logFile), "nope.log"));
    expect(await readAuditTail()).toEqual([]);
  });

  it("returns newest-first and respects the prefix filter", async () => {
    // Sequential awaits → strict order in the log → strict order in the tail.
    audit({ action: "exec.run", detail: "a" });
    await waitForLines(1);
    audit({ action: "fs.delete", detail: "b" });
    await waitForLines(2);
    audit({ action: "exec.run", detail: "c" });
    await waitForLines(3);
    const all = await readAuditTail();
    expect(all[0].detail).toBe("c"); // newest-first
    const onlyExec = await readAuditTail({ prefix: "exec." });
    expect(onlyExec.every((e) => e.action.startsWith("exec."))).toBe(true);
    expect(onlyExec).toHaveLength(2);
  });
});

describe("test-run guard", () => {
  it("never appends to the default ~/.mso/audit.log from a test", async () => {
    // Regression: dispatch.test.ts exercised the MCP dispatcher, the dispatcher
    // audits, and two lines landed in the owner's real trail. Any suite that
    // forgets to stub OS_AUDIT_LOG now writes nowhere instead of into their log.
    vi.stubEnv("OS_AUDIT_LOG", "");
    const home = path.join(os.homedir(), ".mso", "audit.log");
    const marker = `vitest-audit-guard-${process.pid}-${Date.now()}`;
    await audit({ action: "exec.run", target: marker });
    const after = await fs.readFile(home, "utf8").catch(() => "");
    // The live MSO server may legitimately append unrelated audit entries while
    // this suite runs. Assert on this test's unique marker rather than requiring
    // the owner's whole forensic log to remain byte-identical.
    expect(after).not.toContain(marker);
  });
});
