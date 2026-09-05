// Every knob the code reads must be documented where someone would look for it.
//
// CLAUDE.md carries this as a chore ("still grep process.env before adding a new
// one"), and the chore had already slipped: `OS_CODEX_BUILTIN_TOOLS` — which turns
// on provider-run tools that BILL to the owner's account — was readable by the code
// and absent from `.env.example`. A var nobody can find is a var nobody can turn
// off. This is that grep, run by the suite instead of by memory.
//
// The allowlist below is the other half of the contract: vars that are deliberately
// NOT in .env.example because you never set them by hand. Each one carries the
// reason, so adding to this list is a decision rather than a way to silence a test.
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "..", "..");

/** Not documented in .env.example, on purpose. */
const NOT_A_KNOB: Record<string, string> = {
  // Injected by the framework or the runtime.
  NEXT_RUNTIME: "set by Next itself",
  NEXT_PUBLIC_BUILD_ID: "injected by next.config.mjs at build time",
  MSO_RUNTIME_INSTANCE_ID: "injected by the installer-managed service to prove restart readiness",
  // Private launcher-to-agent handoff. scripts/mso-cli-agent.sh owns these; users
  // should configure the public CLI knobs instead of persisting these in .env.local.
  MSO_AGENT_BASE: "internal mso-cli-agent launcher handoff for the selected loopback API base",
  MSO_AGENT_CLI: "internal mso-cli-agent launcher handoff for the canonical CLI path",
  MSO_AGENT_JAR: "internal mso-cli-agent launcher handoff for the authenticated cookie jar",
  MSO_AGENT_ORIGIN: "internal mso-cli-agent launcher handoff for the request Origin header",
  MSO_MAINTENANCE_LOCKED: "internal maintenance-lock.sh child handoff; never persist or set this as user configuration",
  MSO_AGENT_VERSION: "internal mso-cli-agent launcher handoff for banner metadata",
  // Standard terminal convention inherited from the invoking shell, not MSO config.
  NO_COLOR: "standard terminal color convention inherited from the caller",
  VITEST: "set by the test runner",
  // The OS gives these to every process.
  SHELL: "the OS's",
  HOME: "the OS's",
  XDG_RUNTIME_DIR: "set by logind, or by the unit — see lib/managed-apps/user-bus.ts",
  // systemd's, read by instrumentation for the watchdog handshake.
  NOTIFY_SOCKET: "systemd's",
  WATCHDOG_USEC: "systemd's",
  // Test + tooling only, never part of a deployment.
  E2E_BASE_URL: "test harness",
  E2E_PASSWORD: "test harness",
  E2E_DEVICE: "test harness",
  E2E_HEADED: "test harness",
  E2E_PREVIEW_DIR: "test harness",
  MSO_RUNTIME_PROC_ROOT: "test-only fake /proc root for live-runtime ownership tests",
  OS_MEDIA_BASE: "scripts/gen-readme-media.mjs only",
  OS_MEDIA_DEVICE: "scripts/gen-readme-media.mjs only",
};

function usedEnvNames(): string[] {
  const files = execSync("git ls-files --cached --others --exclude-standard '*.ts' '*.tsx' '*.mjs'", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    // A test may stub anything, so .test files do not count as "the app reads it".
    // The e2e HARNESSES do count — they are committed code, and the vars they read
    // are exactly the ones that belong in NOT_A_KNOB rather than in .env.example.
    .filter((f) => !f.includes(".test."))
    // `git ls-files --cached` still reports tracked paths deleted in the working tree.
    // Ignore those so pre-commit verification can validate intentional file retirement.
    .filter((f) => existsSync(path.join(ROOT, f)));
  const names = new Set<string>();
  for (const file of files) {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z_0-9]{2,})/g)) names.add(m[1]);
    // `process.env["X"]` and destructuring are not used here; if they appear, this
    // regex stops seeing them — which is why the reconciliation lives in a test that
    // someone will read, not in a silent script.
  }
  return [...names].sort();
}

describe(".env.example documents every knob", () => {
  const example = readFileSync(path.join(ROOT, ".env.example"), "utf8");
  const documented = new Set(
    [...example.matchAll(/^#?\s*([A-Z][A-Z_0-9]+)=/gm)].map((m) => m[1]),
  );

  it("has a line for each env var the app reads", () => {
    const missing = usedEnvNames().filter((n) => !documented.has(n) && !(n in NOT_A_KNOB));
    expect(missing, "add these to .env.example, or to NOT_A_KNOB with a reason").toEqual([]);
  });

  it("keeps the exemption list honest — every entry is still read somewhere", () => {
    const used = new Set(usedEnvNames());
    // An exemption for a var the code no longer reads is stale lore that outlives
    // the reason it was written.
    const stale = Object.keys(NOT_A_KNOB).filter((n) => !used.has(n));
    expect(stale, "these are exempted but no longer read — drop them").toEqual([]);
  });
});
