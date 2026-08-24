import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// This suite tests both single-origin and split-origin installs. Production may
// legitimately export NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE, so pin the default
// test graph to single-origin BEFORE static imports evaluate origin.ts. Individual
// split-origin tests reset modules and stub their own template explicitly.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE = "";
});

vi.mock("server-only", () => ({}));
vi.mock("./manager", () => ({ getManagedApp: vi.fn() }));
vi.mock("./jobs", () => ({ startManagedAppJob: vi.fn() }));

import { startManagedAppJob } from "./jobs";
import { getManagedApp } from "./manager";
import { startInstall } from "./install";
import { providersFor } from "./providers";
import type { ManagedAppView } from "./types";

const mockStart = vi.mocked(startManagedAppJob);
const mockGet = vi.mocked(getManagedApp);

const view = (installed: boolean): ManagedAppView =>
  ({
    id: "openclaw",
    name: "OpenClaw",
    description: "",
    installed,
    installationType: installed ? "systemd" : "not-installed",
    state: installed ? "running" : "not-installed",
    healthy: null,
    version: null,
    dashboardAvailable: false,
    publicDashboardUrl: null,
    diagnostic: null,
    supportedActions: [],
  }) as ManagedAppView;

/** The options the job layer was actually handed. */
const started = () => mockStart.mock.calls[0]![0];

beforeEach(() => {
  mockStart.mockReset();
  mockGet.mockReset();
  mockStart.mockResolvedValue({} as never);
  mockGet.mockResolvedValue(view(false));
});

describe("install job options", () => {
  it("spawns the tracked script with the app id and nothing else", async () => {
    await startInstall("openclaw");
    const { argv, kind, applicationId } = started();
    expect(kind).toBe("install");
    expect(applicationId).toBe("openclaw");
    expect(argv).toHaveLength(2);
    expect(argv![0]).toMatch(/scripts\/managed-app-install$/);
    expect(argv![1]).toBe("openclaw");
  });

  it("defaults the gateway to loopback, not this host's lan", async () => {
    // A fresh install on someone else's machine must not publish an agent
    // gateway to their network because THIS box happens to need it.
    await startInstall("openclaw");
    expect(started().env?.MSO_INSTALL_GATEWAY_BIND).toBe("loopback");
  });

  it("tells the installer which origin MSO will frame it from", async () => {
    // OpenClaw's Control UI rejects the socket when the browser origin is not on its
    // allowlist, which reads as a broken dashboard on a gateway that is fine.
    // origin.ts reads the template at module load, so this needs a fresh graph.
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", "{id}.mso.rahmanef.com");
    const fresh = await import("./install");
    await fresh.startInstall("openclaw");
    expect(started().env?.MSO_INSTALL_APP_ORIGIN).toBe("https://openclaw.mso.rahmanef.com");
    vi.unstubAllEnvs();
  });

  it("sends no origin at all in single-origin mode, rather than a broken one", async () => {
    await startInstall("openclaw");
    expect(started().env).not.toHaveProperty("MSO_INSTALL_APP_ORIGIN");
  });

  it("refuses a bind mode that is not one of systemd-openclaw's own", async () => {
    await expect(startInstall("openclaw", { bind: "0.0.0.0" })).rejects.toThrow(/unsupported gateway bind/);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("refuses to install over an app that is already there", async () => {
    // Re-running an installer restarts services under whoever is using them.
    mockGet.mockResolvedValue(view(true));
    await expect(startInstall("openclaw")).rejects.toThrow(/already installed/);
    expect(mockStart).not.toHaveBeenCalled();
  });
});

describe("the API key never reaches anything that is persisted", () => {
  const KEY = "sk-ant-notarealkey00000000000000";

  it("carries the key in the environment and NOT in argv", async () => {
    // argv is stored in the job record, returned by the jobs API, and written to
    // the audit log verbatim. env is none of those: job-child.ts merges it into
    // the child's environment and drops it. This is the whole reason the install
    // is a script rather than an argv built here.
    await startInstall("openclaw", { provider: "anthropic", apiKey: KEY });
    const { argv, env } = started();
    expect(JSON.stringify(argv)).not.toContain(KEY);
    expect(env?.ANTHROPIC_API_KEY).toBe(KEY);
    expect(env?.MSO_INSTALL_API_KEY).toBe(KEY);
    expect(env?.MSO_INSTALL_PROVIDER).toBe("anthropic");
  });

  it("sends no key material at all when none was given", async () => {
    await startInstall("openclaw");
    const { env } = started();
    expect(env).not.toHaveProperty("MSO_INSTALL_API_KEY");
    expect(env).not.toHaveProperty("MSO_INSTALL_PROVIDER");
  });

  it("treats whitespace as no key rather than as a key", async () => {
    await startInstall("openclaw", { provider: "anthropic", apiKey: "   " });
    expect(started().env).not.toHaveProperty("MSO_INSTALL_API_KEY");
  });

  it("refuses a key with a control character in it", async () => {
    // The only shape that could break the environment block. Everything else is
    // opaque credential material and is not inspected.
    await expect(startInstall("openclaw", { provider: "anthropic", apiKey: "sk-a\nb" })).rejects.toThrow(/API key/);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("refuses a provider the app cannot use, instead of installing without one", async () => {
    // Nous is Hermes-only. Silently dropping it would install an app the
    // operator believes is configured.
    await expect(startInstall("openclaw", { provider: "nous", apiKey: KEY })).rejects.toThrow(/not supported/);
    await expect(startInstall("openclaw", { provider: "made-up", apiKey: KEY })).rejects.toThrow(/unsupported provider/);
    expect(mockStart).not.toHaveBeenCalled();
  });
});

describe("the provider table and the install script agree", () => {
  // The drift this catches: providers.ts is the dropdown AND the route's
  // allowlist, but the flag each one maps to lives in bash. Adding a provider in
  // TypeScript alone gives an operator a choice that installs with no provider
  // and no error — the script's `*)` arm just warns onto a transcript nobody
  // reads. This test is the only thing that couples the two files.
  const script = readFileSync(path.join(process.cwd(), "scripts", "managed-app-install"), "utf8");

  it("puts the MSO origin on OpenClaw's Control UI allowlist, and only that origin", () => {
    // A wildcard here would let any page in the browser drive the agent.
    const openclaw = script.slice(script.indexOf("install_openclaw() {"), script.indexOf("openclaw_bin() {"));
    expect(openclaw).toContain("gateway.controlUi.allowedOrigins");
    expect(openclaw).toContain("$APP_ORIGIN");
    expect(openclaw).not.toContain('"*"');
  });

  it("has a case arm for every provider offered for OpenClaw", () => {
    for (const provider of providersFor("openclaw")) {
      expect(script, `no '${provider.id})' arm in managed-app-install`).toMatch(new RegExp(`^\\s*${provider.id}\\)`, "m"));
    }
  });

  it("passes Hermes' key through the environment only — it takes no key flag", () => {
    // Hermes reads the env var itself (`setup --non-interactive` = "use
    // defaults/env vars"), so nothing about it should ever build a key argv.
    // Bounded at the NEXT function definition, not at the last one in the file:
    // the openclaw arm legitimately builds key flags, and a slice that reached it
    // would fail this test for the wrong reason.
    const hermes = script.slice(script.indexOf("install_hermes() {"), script.indexOf("hermes_cmd() {"));
    expect(hermes).toContain("setup --non-interactive");
    expect(hermes).not.toMatch(/--\w[\w-]*-api-key/);
  });

  it("resolves the Hermes launcher by explicit path before trusting PATH", () => {
    // The bug this pins, which cost three consecutive failed installs on 2026-07-29:
    // `~/.local/bin` is NOT on the PATH a systemd service inherits, so `command -v hermes`
    // misses the installer's real launcher. The next candidate down,
    // ~/.hermes/hermes-agent/hermes, has a `#!/usr/bin/env python3` shebang and runs the
    // SYSTEM python, which has no `dotenv` — every install died on
    // "ModuleNotFoundError: No module named 'dotenv'" with a fully populated venv sitting
    // right there. So the explicit launcher paths must be tried FIRST, and that bare entry
    // point must never be a candidate at all.
    const resolver = script.slice(script.indexOf("hermes_cmd() {"));
    const localBin = resolver.indexOf('$HOME/.local/bin/hermes');
    const viaPath = resolver.indexOf('command -v hermes');
    expect(localBin, "~/.local/bin/hermes is not a candidate").toBeGreaterThan(-1);
    expect(localBin, "PATH is consulted before the explicit launcher").toBeLessThan(viaPath);
    expect(resolver, "the venv interpreter is the required floor").toContain("venv/bin/python");
    expect(resolver, "the system-python entry point must never be a candidate").not.toContain("hermes-agent/hermes");
  });

  it("installs the DASHBOARD unit, not just the gateway", () => {
    // The gateway is messaging plumbing and binds nothing on 9119, so an install that
    // stopped there left MSO framing a connection refused —
    // {"error":"managed application upstream unavailable"} — on a Hermes it had just
    // reported as installed and running. The unit name is the one catalog.ts probes
    // first, and `hermes serve` is not a substitute: it 404s the web UI by design.
    const hermes = script.slice(script.indexOf("install_hermes() {"), script.indexOf("hermes_cmd() {"));
    expect(hermes).toContain("gateway install");
    expect(hermes).toContain("hermes-dashboard.service");
    expect(hermes).toMatch(/dashboard --no-open/);
    expect(hermes).not.toMatch(/\bserve --port/);
  });

  it("never lets the install script run something that can prompt", () => {
    // The job layer gives its child no stdin, so a prompt does not hang — it
    // EOFs and the install dies half-done, which is worse.
    expect(script).toMatch(/--non-interactive/);
    expect(script).not.toMatch(/\bread -[rp]\b/);
  });
});
