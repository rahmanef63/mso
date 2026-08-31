import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const FIXTURE = path.join(process.cwd(), "scripts/test-fixtures/install-runtime-abort-recovery.sh");
const roots: string[] = [];

function runCleanup(mode: "pre" | "post") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-install-abort-"));
  roots.push(root);
  const capture = path.join(root, "calls.log");
  const fd = fs.openSync(capture, "w+");
  try {
    const out = spawnSync("bash", [FIXTURE, mode], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe", fd],
    });
    const size = fs.fstatSync(fd).size;
    const bytes = Buffer.alloc(size);
    if (size > 0) fs.readSync(fd, bytes, 0, size, 0);
    return { out, calls: bytes.toString("utf8") };
  } finally {
    fs.closeSync(fd);
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("installer abort recovery", () => {
  it("restores the known-good service and fallbacks when aborting before mutation", () => {
    const { out, calls } = runCleanup("pre");
    expect(out.status).toBe(0);
    expect(calls).toContain("release-runtime");
    expect(calls).toContain("sudo systemctl start mso.service");
    expect(calls).toContain("restore-fallbacks");
    expect(calls).toContain("release-update");
  });

  it("does not restart any runtime after installer mutation has started", () => {
    const { out, calls } = runCleanup("post");
    expect(out.status).toBe(0);
    expect(calls).toContain("release-runtime");
    expect(calls).toContain("release-update");
    expect(calls).not.toContain("systemctl start mso.service");
    expect(calls).not.toContain("restore-fallbacks");
  });
});
