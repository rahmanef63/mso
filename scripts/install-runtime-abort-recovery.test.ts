import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const HELPER = path.join(process.cwd(), "scripts/lib/install-runtime-lifecycle.sh");
const roots: string[] = [];

function runCleanup(mutationStarted: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-install-abort-"));
  roots.push(root);
  const capture = path.join(root, "capture");
  const script = `
set -euo pipefail
DIR=/tmp; PORT=4005; DO_SERVICE=1; SERVICE=mso.service
die(){ echo "die:$*" >&2; exit 1; }
sudo_do(){ printf 'sudo %s\n' "$*" >> ${JSON.stringify(capture)}; }
systemd_ready(){ return 0; }
. ${JSON.stringify(HELPER)}
runtime_exclusion_release(){ echo release-runtime >> ${JSON.stringify(capture)}; }
update_gateway_restore_all(){ echo restore-fallbacks >> ${JSON.stringify(capture)}; }
update_lock_release(){ echo release-update >> ${JSON.stringify(capture)}; }
INSTALL_RUNTIME_LIFECYCLE=1
INSTALL_RUNTIME_SERVICE_STOPPED=1
${mutationStarted ? "install_runtime_lifecycle_mark_mutation_started" : ""}
install_runtime_lifecycle_cleanup
`;
  const out = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  return { out, calls: fs.existsSync(capture) ? fs.readFileSync(capture, "utf8") : "" };
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("installer abort recovery", () => {
  it("restores the known-good service and fallbacks when aborting before mutation", () => {
    const { out, calls } = runCleanup(false);
    expect(out.status).toBe(0);
    expect(calls).toContain("release-runtime");
    expect(calls).toContain("sudo systemctl start mso.service");
    expect(calls).toContain("restore-fallbacks");
    expect(calls).toContain("release-update");
  });

  it("does not restart any runtime after installer mutation has started", () => {
    const { out, calls } = runCleanup(true);
    expect(out.status).toBe(0);
    expect(calls).toContain("release-runtime");
    expect(calls).toContain("release-update");
    expect(calls).not.toContain("systemctl start mso.service");
    expect(calls).not.toContain("restore-fallbacks");
  });
});
