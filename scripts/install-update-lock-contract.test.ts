import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("installer update transaction ordering", () => {
  it("acquires the checkout transaction lock before fetch/checkout mutation", () => {
    const core = fs.readFileSync(path.join(ROOT, "scripts/install-core.sh"), "utf8");
    const acquire = core.indexOf("\ninstall_early_update_lock_acquire\n");
    const fetch = core.indexOf('git -C "$DIR" fetch --quiet origin "$REF"');
    const checkout = core.indexOf('git -C "$DIR" checkout --quiet FETCH_HEAD');
    expect(acquire).toBeGreaterThan(0);
    expect(fetch).toBeGreaterThan(acquire);
    expect(checkout).toBeGreaterThan(fetch);
  });

  it("hands the pre-checkout lock FD to the post-checkout lifecycle", () => {
    const helper = fs.readFileSync(path.join(ROOT, "scripts/lib/install-runtime-lifecycle.sh"), "utf8");
    expect(helper).toContain('UPDATE_LOCK_FD="$INSTALL_EARLY_UPDATE_LOCK_FD"');
    expect(helper).toContain('[ "$UPDATE_LOCK_HELD" = 1 ] || update_lock_acquire');
  });
  it("does not require the private-state helper from the pre-upgrade checkout", () => {
    const core = fs.readFileSync(path.join(ROOT, "scripts/install-core.sh"), "utf8");
    expect(core).not.toContain('$DIR/scripts/lib/private-state.sh');
    expect(core).toContain("install_private_state_dir()");
    expect(core).toContain("install_private_state_ensure_file()");
  });

});
