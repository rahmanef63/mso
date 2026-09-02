import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

const BOOTSTRAP = path.join(__dirname, "../scripts/install.sh");
const CORE = path.join(__dirname, "../scripts/install-core.sh");
const PHASES = ["cli.sh", "runtime-build.sh", "service.sh", "finalize.sh"].map((name) =>
  path.join(__dirname, "../scripts/install", name),
);
const installerSource = () => [CORE, ...PHASES].map((file) => fs.readFileSync(file, "utf8")).join("\n");

describe("one-line installer contract", () => {
  it("is valid bash and documents onboarding controls", () => {
    expect(() => execFileSync("bash", ["-n", BOOTSTRAP])).not.toThrow();
    expect(() => execFileSync("bash", ["-n", CORE])).not.toThrow();
    for (const phase of PHASES) expect(() => execFileSync("bash", ["-n", phase])).not.toThrow();
    const help = execFileSync("bash", [CORE, "--help"], { encoding: "utf8" });
    expect(help).toContain("--onboard");
    expect(help).toContain("--no-onboard");
    expect(help).toContain("-y, --yes");
  });

  it("downloads and verifies the complete installer core before executing any payload bytes", () => {
    const bootstrap = fs.readFileSync(BOOTSTRAP, "utf8");
    const core = fs.readFileSync(CORE);
    expect(Buffer.byteLength(bootstrap)).toBeLessThan(4096);
    expect(bootstrap).toContain("scripts/install-core.sh");
    expect(bootstrap).toContain("installer payload is unexpectedly short");
    expect(bootstrap).toContain("EOF marker missing");
    expect(bootstrap).toContain('bash -n "$TMP_INSTALLER"');
    expect(bootstrap).toContain('exec bash /proc/self/fd/3 "$@"');
    const declared = bootstrap.match(/CORE_SHA256="([0-9a-f]{64})"/)?.[1];
    expect(declared).toBe(crypto.createHash("sha256").update(core).digest("hex"));
    expect(core.toString("utf8").trimEnd().endsWith("# MSO_INSTALLER_CORE_EOF")).toBe(true);
  });

  it("installs the fail-closed trap as the first executable bootstrap statement", () => {
    const bootstrap = fs.readFileSync(BOOTSTRAP, "utf8");
    const lines = bootstrap.split(/\r?\n/);
    expect(lines[0]).toBe("#!/usr/bin/env bash");
    expect(lines[1]).toMatch(/^trap .* EXIT$/);

    // Regression for the real review reproducer: once the shebang has been read,
    // every later syntactically complete prefix is already guarded.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mso-bootstrap-early-prefix-"));
    try {
      const prefix = path.join(dir, "install.sh");
      fs.writeFileSync(prefix, `${lines.slice(0, 16).join("\n")}\n`);
      const result = spawnSync("bash", [prefix], { encoding: "utf8" });
      expect(result.status).toBe(97);
      expect(result.stderr).toContain("before verified-core handoff");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a syntactically complete bootstrap prefix before the final exec handoff", () => {
    const bootstrap = fs.readFileSync(BOOTSTRAP, "utf8");
    const cutoff = bootstrap.indexOf('exec bash /proc/self/fd/3 "$@"');
    expect(cutoff).toBeGreaterThan(0);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mso-bootstrap-prefix-"));
    try {
      const truncated = path.join(dir, "install.sh");
      // Stop after TMP_INSTALLER='' — a syntactically complete prefix that used to
      // be able to return 0 when a completion marker was set before handoff.
      fs.writeFileSync(truncated, bootstrap.slice(0, cutoff));
      const result = spawnSync("bash", [truncated, "--help"], {
        encoding: "utf8",
        env: { ...process.env, MSO_INSTALL_CORE_URL: `file://${CORE}` },
      });
      expect(result.status).toBe(97);
      expect(result.stderr).toContain("before verified-core handoff");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs the verified local core and rejects a syntactically complete truncated payload", () => {
    const env = { ...process.env, MSO_INSTALL_CORE_URL: `file://${CORE}` };
    const help = execFileSync("bash", [BOOTSTRAP, "--help"], { encoding: "utf8", env });
    expect(help).toContain("mso installer");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mso-installer-truncated-"));
    try {
      const truncated = path.join(dir, "install-core.sh");
      const source = fs.readFileSync(CORE);
      fs.writeFileSync(truncated, source.subarray(0, Math.min(22000, source.length - 1)));
      const result = spawnSync("bash", [BOOTSTRAP, "--help"], {
        encoding: "utf8",
        env: { ...process.env, MSO_INSTALL_CORE_URL: `file://${truncated}` },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/incomplete|hash mismatch|unexpectedly short/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the controlling tty after curl|bash and never stdin for onboarding", () => {
    const src = installerSource();
    expect(src).toContain("[ -r /dev/tty ] && [ -w /dev/tty ]");
    expect(src).toContain('onboard </dev/tty >/dev/tty 2>/dev/tty');
    expect(src).toContain('ONBOARD_MODE=auto');
    expect(src).toContain('FRESH_INSTALL=1');
  });

  it("installs the CLI before dependencies, build, and service setup and proves it against the invoking PATH", () => {
    const src = installerSource();
    expect(src.indexOf("# ---- CLI on PATH")).toBeLessThan(src.indexOf("INSTALL_PHASE=dependencies"));
    expect(src.indexOf("# ---- CLI on PATH")).toBeLessThan(src.indexOf("INSTALL_PHASE=build"));
    expect(src.indexOf("# ---- CLI on PATH")).toBeLessThan(src.indexOf("# ---- systemd unit ----"));
    expect(src).toContain('PARENT_PATH="${PATH:-}"');
    expect(src).toContain('PARENT_CWD="$PWD"');
    expect(src).toContain('normalize_parent_path()');
    expect(src).toContain('PARENT_PATH_RESOLVED="$(normalize_parent_path "$PARENT_PATH" "$PARENT_CWD")"');
    expect(src).toContain('SYSTEM_BIN_DIR="${MSO_SYSTEM_BIN_DIR:-/usr/local/bin}"');
    expect(src).toContain('PATH="$PARENT_PATH_RESOLVED" command -v mso');
    expect(src).toContain('"$BIN_DIR/mso" -h');
    expect(src).toContain("# >>> mso cli >>>");
    expect(src).toContain('export PATH="$BIN_DIR:$PATH"');
    expect(src).toContain('custom MSO_BIN_DIR is not persisted automatically');
    expect(src).toContain("ensure_cli_tools()");
    expect(src).toContain("curl jq coreutils util-linux");
    expect(src).toContain("sha256sum flock");
    expect(src).toContain('[ -x "$BIN_DIR/mso" ]');
    expect(src).toContain('CLI launcher self-check failed');
  });

  it("holds the checkout runtime lifecycle across dependency/build and service refresh", () => {
    const src = installerSource();
    const begin = src.indexOf("install_runtime_lifecycle_begin");
    const deps = src.indexOf("INSTALL_PHASE=dependencies");
    const build = src.indexOf('node "$NEXT_BIN" build');
    const service = src.indexOf("# ---- systemd unit ----");
    const finish = src.indexOf("install_runtime_lifecycle_finish");
    expect(begin).toBeGreaterThan(0);
    expect(begin).toBeLessThan(deps);
    expect(deps).toBeLessThan(build);
    expect(build).toBeLessThan(service);
    expect(service).toBeLessThan(finish);
    expect(src).toContain('trap install_runtime_lifecycle_cleanup EXIT');
    expect(src).toContain('scripts/lib/install-runtime-lifecycle.sh');
  });

  it("bypasses Bun bin remapping for production build and repairs only a missing package payload", () => {
    const src = installerSource();
    expect(src).toContain('NEXT_BIN="$DIR/node_modules/next/dist/bin/next"');
    expect(src).toContain('node "$NEXT_BIN" build');
    expect(src).not.toMatch(/^\s*bun run build\s*$/m);
    expect(src).toContain('if [ ! -f "$NEXT_BIN" ]; then');
    expect(src).toContain("bun install --force --frozen-lockfile || bun install --force");
    expect(src.indexOf('if [ ! -f "$NEXT_BIN" ]; then')).toBeGreaterThan(src.indexOf("bun install --frozen-lockfile || bun install"));
  });

  it("requires systemd as PID 1 before service setup and gates onboarding on verified health", () => {
    const src = installerSource();
    expect(src).toContain("systemd_ready()");
    expect(src).toContain("/proc/1/comm");
    expect(src).toContain('= "systemd"');
    expect(src).toContain("WSL detected without systemd as PID 1");
    expect(src).toContain("SERVICE_READY=1");
    expect(src).toContain("SERVICE_ATTEMPTED=1");
    expect(src).toContain('elif [ "$SERVICE_ATTEMPTED" -eq 1 ]; then');
    expect(src.indexOf('elif [ "$SERVICE_ATTEMPTED" -eq 1 ]; then')).toBeLessThan(src.indexOf('elif is_wsl; then'));
    expect(src).toContain('RUNTIME_INSTANCE_ID="$(rand_hex 16)"');
    expect(src).toContain('Environment=MSO_RUNTIME_INSTANCE_ID=$RUNTIME_INSTANCE_ID');
    expect(src).toContain('[ "$now_instance" = "$RUNTIME_INSTANCE_ID" ]');
    expect(src).toContain('[ "$RUN_ONBOARD" -eq 1 ] && [ "$SERVICE_READY" -eq 1 ]');
  });

  it("verifies a commit-pinned Bun bootstrap before execution", () => {
    const src = installerSource();
    expect(src).toMatch(/BUN_BOOTSTRAP_COMMIT="[0-9a-f]{40}"/);
    expect(src).toMatch(/BUN_BOOTSTRAP_SHA256="[0-9a-f]{64}"/);
    expect(src).toContain('raw.githubusercontent.com/oven-sh/bun/$BUN_BOOTSTRAP_COMMIT/src/cli/install.sh');
    expect(src).toContain('sha256sum "$bootstrap"');
    expect(src).toContain('[ "$actual" = "$BUN_BOOTSTRAP_SHA256" ]');
    expect(src).not.toContain('https://bun.sh/install | bash');
  });
});
