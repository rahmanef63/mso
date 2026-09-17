import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("organization/workflow owner file inputs", () => {
  it.each(["organization", "workflows"])("preserves quoted @file input for %s", (name) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "mso-cli-input-"));
    try {
      const file = path.join(root, "input with spaces.json");
      writeFileSync(file, JSON.stringify({ label: "owner fixture" }));
      const script = path.join(__dirname, "cli", name + ".sh");
      const code = 'set -euo pipefail; source "$1"; jpost(){ printf "%s" "$2"; }; die(){ exit 2; }; if [ "$2" = organization ]; then run_org replace rev1 "@$3"; else run_workflow create --input "@$3"; fi';
      const result = spawnSync("bash", ["-c", code, "fixture", script, name, file], { encoding: "utf8" });
      expect(result.status).toBe(0);
      const body = JSON.parse(result.stdout);
      expect(name === "organization" ? body.chart : body.graph).toEqual({ label: "owner fixture" });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
