import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
const script = path.resolve("scripts/cli/memory-backup.sh");
function run(...args: string[]) {
  return spawnSync("bash", ["-c", 'source "$1"; shift; jget() { printf "%s" "$1"; }; jpost() { printf "%s" "$2"; }; die() { exit 2; }; mso_memory_backup "$@"', "test", script, ...args], { encoding: "utf8" });
}
describe("memory backup history CLI", () => {
  it("reads the first and subsequent pages using the existing transport", () => {
    expect(run("history").stdout).toBe("/api/v1/sys/memory-backup?view=history");
    const sha = "a".repeat(64);
    expect(run("history", "12", sha).stdout).toBe(`/api/v1/sys/memory-backup?view=history&offset=12&revision=${sha}`);
  });
  it("rejects malformed pagination and requires explicit mutation confirmation", () => {
    for (const args of [["history", "1"], ["history", "-1", "a".repeat(64)], ["history", "1", "not-a-revision"], ["create"], ["verify", "id", "sha"]]) expect(run(...args).status).not.toBe(0);
  });
  it("describes history and local-only limitations in help", () => {
    const result = run("--help"); expect(result.status).toBe(0); expect(result.stdout).toContain("history [offset revision]"); expect(result.stdout).toContain("not a full VPS/database or offsite backup");
  });
});
