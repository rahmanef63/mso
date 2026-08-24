// Argv is the security boundary of this feature: everything else in the
// subsystem refuses to touch upstream state, and these arrays are the one place
// that asks an upstream to rewrite itself. Each expectation below is pinned to
// a real `--help` or a real installed source on this host, quoted in the test.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { assertBranch, assertChannel, assertTag, updateAdapter, UNINSTALL_PREVIEW_FLAG } = await import("./update-cli");
const { parseHermesCheck } = await import("./update-probe");

const HERMES = "/usr/local/bin/hermes";
const OPENCLAW = "/home/rahman/.local/bin/openclaw";
const result = (stdout: string, code = 0) => ({ code, stdout, stderr: "" });

describe("the argv each CLI actually gets", () => {
  it("builds the Hermes update exactly, and never its own backup flags", () => {
    const argv = updateAdapter("hermes").updateArgv(HERMES, {});
    expect(argv).toEqual([HERMES, "update", "--yes"]);
    // --backup / --no-backup are the operator's `updates.pre_update_backup`
    // setting; MSO overriding it in either direction is not MSO's call.
    expect(argv).not.toContain("--no-backup");
    expect(argv).not.toContain("--backup");
  });

  it("pins a Hermes update to a branch as two argv elements", () => {
    expect(updateAdapter("hermes").updateArgv(HERMES, { branch: "release/2026-07" })).toEqual([
      HERMES,
      "update",
      "--yes",
      "--branch",
      "release/2026-07",
    ]);
  });

  it("builds the OpenClaw update without --json, so the transcript is not empty for twenty minutes", () => {
    // dist/update-cli-CnCrJkiC.js: `info: (msg) => { if (!params.opts.json)
    // defaultRuntime.log(msg); }` — --json silences every progress line.
    expect(updateAdapter("openclaw").updateArgv(OPENCLAW, {})).toEqual([OPENCLAW, "update", "--yes"]);
  });

  it("uses --dry-run --json for a preview, and passes channel/tag/no-restart through", () => {
    expect(updateAdapter("openclaw").updateArgv(OPENCLAW, { dryRun: true })).toEqual([OPENCLAW, "update", "--yes", "--dry-run", "--json"]);
    expect(updateAdapter("openclaw").updateArgv(OPENCLAW, { channel: "beta", noRestart: true })).toEqual([
      OPENCLAW,
      "update",
      "--yes",
      "--channel",
      "beta",
      "--no-restart",
    ]);
    // Restart is the default: the package flow verifies the restarted service
    // reports the new version before it succeeds (docs/cli/update.md).
    expect(updateAdapter("openclaw").updateArgv(OPENCLAW, {})).not.toContain("--no-restart");
  });

  it("refuses an option the app has no flag for instead of dropping it", () => {
    expect(() => updateAdapter("hermes").updateArgv(HERMES, { dryRun: true })).toThrow("dry run is not supported for hermes");
    expect(() => updateAdapter("hermes").updateArgv(HERMES, { channel: "beta" })).toThrow("not supported");
    expect(() => updateAdapter("hermes").updateArgv(HERMES, { tag: "latest" })).toThrow("not supported");
    expect(() => updateAdapter("openclaw").updateArgv(OPENCLAW, { branch: "main" })).toThrow("not supported");
  });

  it("keeps a preview's confirmation flag in the ONE order upstream makes safe", () => {
    // The reviewer's ask — "do not send --yes with a preview" — is not
    // implementable: BOTH CLIs refuse a headless uninstall without it, preview
    // included. `hermes uninstall` hits `_require_tty()` before it ever reads
    // --dry-run unless --yes was passed (main.py:4670 → :480) and jobs spawn
    // with stdin closed; `openclaw uninstall --non-interactive` errors
    // "requires --yes" at :83, before it reads dryRun at :143. So the pair
    // stands, the flag order is pinned here, and update.ts is what stops
    // trusting `--dry-run` blindly (it re-checks the installed CLI's --help).
    expect(updateAdapter("hermes").uninstallArgv(HERMES, true)).toEqual([HERMES, "uninstall", "--yes", "--dry-run"]);
    expect(updateAdapter("openclaw").uninstallArgv(OPENCLAW, true).at(-1)).toBe(UNINSTALL_PREVIEW_FLAG);
    // A preview differs from the real thing by exactly one element.
    for (const id of ["hermes", "openclaw"] as const) {
      const real = updateAdapter(id).uninstallArgv("/bin/x", false);
      expect(updateAdapter(id).uninstallArgv("/bin/x", true)).toEqual([...real, UNINSTALL_PREVIEW_FLAG]);
    }
  });

  it("builds the two uninstalls in the form each CLI accepts without a prompt", () => {
    // hermes_cli/uninstall.py: --yes takes the non-interactive path; without
    // --full it keeps ~/.hermes.
    const hermes = updateAdapter("hermes").uninstallArgv(HERMES, false);
    expect(hermes).toEqual([HERMES, "uninstall", "--yes"]);
    expect(hermes).not.toContain("--full");

    // dist/uninstall-CU8IZGSh.js: --non-interactive without --yes exits 1, and
    // with no scope it exits 1 too ("requires explicit scopes").
    const openclaw = updateAdapter("openclaw").uninstallArgv(OPENCLAW, true);
    expect(openclaw).toEqual([OPENCLAW, "uninstall", "--non-interactive", "--yes", "--service", "--state", "--dry-run"]);
    expect(openclaw).not.toContain("--all");
    expect(openclaw).not.toContain("--workspace"); // the operator's own agent files
  });
});

describe("a rejected channel, tag or branch never reaches argv", () => {
  it("takes the four documented channels and nothing else", () => {
    for (const channel of ["stable", "extended-stable", "beta", "dev"]) expect(assertChannel(channel)).toBe(channel);
    for (const bad of ["nightly", "STABLE", "beta ", "", "stable;dev"]) expect(() => assertChannel(bad)).toThrow("unsupported update channel");
    expect(() => updateAdapter("openclaw").updateArgv(OPENCLAW, { channel: "nightly" })).toThrow("unsupported update channel");
  });

  it("takes a dist-tag or an exact version, never a package spec", () => {
    expect(assertTag("2026.7.1-2")).toBe("2026.7.1-2");
    expect(assertTag("beta")).toBe("beta");
    // `--tag main` maps to github:openclaw/openclaw#main, and the flag accepts
    // any spec — which would make one API call an "install a stranger's code
    // as this user" button. Pinning a released version is the rollback story.
    for (const bad of ["main", "github:evil/openclaw#main", "file:/tmp/x", "../../etc", "latest;rm -rf /"]) {
      expect(() => assertTag(bad)).toThrow("unsupported update tag");
    }
    expect(() => updateAdapter("openclaw").updateArgv(OPENCLAW, { tag: "github:evil/openclaw#main" })).toThrow("unsupported update tag");
  });

  it("takes a git branch name and nothing that could be an option or a traversal", () => {
    expect(assertBranch("main")).toBe("main");
    for (const bad of ["--force", "../main", "a//b", "x.lock", "main;reboot", ""]) expect(() => assertBranch(bad)).toThrow("unsupported update branch");
    expect(() => updateAdapter("hermes").updateArgv(HERMES, { branch: "--force" })).toThrow("unsupported update branch");
  });

  it("validates a rollback pin with the same rules as an update option", () => {
    expect(updateAdapter("openclaw").pin?.("2026.7.1-2")).toEqual(["--tag", "2026.7.1-2"]);
    expect(() => updateAdapter("openclaw").pin?.("github:evil/x#main")).toThrow("unsupported update tag");
  });

  it("offers Hermes NO rollback pin, because its pin would stash the restore", () => {
    // `--branch` is a checkout switch, and `hermes update` stashes local changes
    // first (main.py:7053). A rollback restores ~/.hermes — the checkout minus
    // the `.git` the backup prunes — so the tree is dirty against an unchanged
    // HEAD and the pin would stash exactly what was just restored. There is no
    // argv for that, by construction.
    expect(updateAdapter("hermes").pin).toBeNull();
    // The branch flag itself is untouched: it is still a per-UPDATE option.
    expect(updateAdapter("hermes").updateArgv(HERMES, { branch: "main" })).toContain("--branch");
  });
});

describe("reading what Hermes says back", () => {
  it("reads the shallow-clone 'update available' form this host prints", () => {
    const parsed = parseHermesCheck(result("→ Fetching from upstream...\n→ Fetching from origin...\n⚕ Update available (behind origin/main).\n  Run 'hermes update' to install.\n"));
    expect(parsed.updateAvailable).toBe(true);
    expect(parsed.channel).toMatchObject({ value: "main", kind: "branch", switchable: false });
    expect(parsed.error).toBeNull();
  });

  it("reads the counted form and the up-to-date form", () => {
    expect(parseHermesCheck(result("⚕ Update available: 3 commits behind origin/main.\n")).updateAvailable).toBe(true);
    const clean = parseHermesCheck(result("→ Fetching from upstream...\n✓ Already up to date.\n"));
    expect(clean.updateAvailable).toBe(false);
    expect(clean.channel.value).toBeNull(); // it did not say which ref; do not guess
  });

  it("reports a failure as unknown, never as 'no update'", () => {
    const offline = parseHermesCheck(result("→ Fetching from upstream...\n✗ Network error — cannot reach the remote repository.\n", 1));
    expect(offline.updateAvailable).toBeNull();
    expect(offline.error).toContain("Network error");
    // A non-zero exit with no ✗ line is still a failure we have no wording for.
    expect(parseHermesCheck(result("", 1)).updateAvailable).toBeNull();
  });
});

describe("the 9Router wrapper argv", () => {
  const NINE = "/home/rahman/projects/mso/scripts/managed-app-9router";

  it("builds update and uninstall in the wrapper's own grammar", () => {
    expect(updateAdapter("9router").updateArgv(NINE, {})).toEqual([NINE, "update", "--yes"]);
    expect(updateAdapter("9router").uninstallArgv(NINE, false)).toEqual([NINE, "uninstall", "--yes"]);
    expect(updateAdapter("9router").uninstallArgv(NINE, true)).toEqual([NINE, "uninstall", "--yes", UNINSTALL_PREVIEW_FLAG]);
  });

  it("refuses every option the single-tag Docker flow cannot honour", () => {
    for (const options of [{ dryRun: true }, { channel: "beta" }, { tag: "latest" }, { branch: "main" }, { noRestart: true }]) {
      expect(() => updateAdapter("9router").updateArgv(NINE, options)).toThrow("not supported for 9router");
    }
    expect(updateAdapter("9router").pin).toBeNull();
  });
});
