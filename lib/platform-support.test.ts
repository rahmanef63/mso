import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORM_SUPPORT, platformSupport } from "./platform-support";

const ROOT = path.join(__dirname, "..");
const INSTALL_PAGE = fs.readFileSync(path.join(ROOT, "app/install/page.tsx"), "utf8");
const INSTALLER_PATH = path.join(ROOT, "scripts/install.sh");
const INSTALLER = fs.readFileSync(INSTALLER_PATH, "utf8");
const MACOS_INSTALLER = fs.readFileSync(path.join(ROOT, "scripts/install-macos.sh"), "utf8");
const TERMUX_INSTALLER = fs.readFileSync(path.join(ROOT, "scripts/install-termux.sh"), "utf8");
const WINDOWS_INSTALLER = fs.readFileSync(path.join(ROOT, "scripts/install-windows.ps1"), "utf8");

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function dispatcherSmoke(uname: string, extraEnv: Partial<NodeJS.ProcessEnv> = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mso-platform-dispatch-"));
  const log = path.join(tmp, "dispatch.log");
  fs.writeFileSync(path.join(tmp, "uname"), "#!/bin/sh\nprintf '%s\\n' \"$FAKE_UNAME\"\n", { mode: 0o755 });
  fs.writeFileSync(
    path.join(tmp, "bash"),
    `#!/bin/sh
[ "\${1:-}" = -n ] && exit 0
if grep -q 'macOS compatibility bootstrap' "\${1:-}" 2>/dev/null; then printf macos >"$MSO_TEST_DISPATCH_LOG"; fi
if grep -q 'MSO bootstrap for Termux/Android' "\${1:-}" 2>/dev/null; then printf android >"$MSO_TEST_DISPATCH_LOG"; fi
exit 0
`,
    { mode: 0o755 },
  );
  const result = spawnSync("/bin/bash", [INSTALLER_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...extraEnv,
      PATH: `${tmp}:${process.env.PATH ?? ""}`,
      FAKE_UNAME: uname,
      MSO_TEST_DISPATCH_LOG: log,
      MSO_INSTALL_RAW_BASE: `file://${path.join(ROOT, "scripts")}`,
    },
    encoding: "utf8",
  });
  const dispatched = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
  fs.rmSync(tmp, { recursive: true, force: true });
  return { ...result, dispatched };
}

describe("MSO platform support contract", () => {
  it("keeps every published machine/client platform visible", () => {
    expect(PLATFORM_SUPPORT.map((item) => item.id)).toEqual([
      "linux",
      "macos",
      "windows",
      "android",
      "ios",
    ]);
    expect(INSTALL_PAGE).toContain("PLATFORM_SUPPORT.map((platform)");
  });

  it("prevents macOS from silently disappearing from install UX", () => {
    const mac = platformSupport("macos");
    expect(mac.installCommand).toContain("scripts/install.sh");
    expect(mac.mode).toBe("linux-guest-host");
    expect(INSTALLER).toContain("Darwin)");
    expect(MACOS_INSTALLER).toContain("limactl");
  });

  it("keeps truthful host boundaries", () => {
    expect(platformSupport("linux").mode).toBe("native-host");
    expect(platformSupport("windows").mode).toBe("linux-guest-host");
    expect(platformSupport("android").mode).toBe("linux-guest-host");
    expect(platformSupport("ios").mode).toBe("client");
    expect(platformSupport("ios").installCommand).toBeUndefined();
    expect(WINDOWS_INSTALLER).toContain("WSL2");
  });

  it("pins compatibility bootstraps from the public dispatcher", () => {
    expect(INSTALLER).toContain('MACOS_SHA256="' + sha256(MACOS_INSTALLER) + '"');
    expect(INSTALLER).toContain('TERMUX_SHA256="' + sha256(TERMUX_INSTALLER) + '"');
    expect(INSTALLER).toContain("*/com.termux/files/usr)");
    expect(INSTALLER).toContain("MINGW*|MSYS*|CYGWIN*)");
  });

  it("keeps the Windows bootstrap structurally singular", () => {
    expect(WINDOWS_INSTALLER.split("$Script = @'").length - 1).toBe(1);
    expect(WINDOWS_INSTALLER.split("\n'@\n").length - 1).toBe(1);
    expect(WINDOWS_INSTALLER.split("Installing/updating MSO inside WSL2").length - 1).toBe(1);
    expect(WINDOWS_INSTALLER).toContain('Get-Command "wsl.exe"');
    expect(WINDOWS_INSTALLER).toContain('Where-Object { $_ -and ($_ -notlike "docker-desktop*") }');
  });

  it("prevents Termux recursion inside the Ubuntu guest", () => {
    expect(TERMUX_INSTALLER).toContain("unset PREFIX TERMUX_VERSION");
  });

  it("keeps guest-side shell variables literal until guest execution", () => {
    expect(MACOS_INSTALLER).toContain('export PATH="\\$HOME/.local/bin:\\$HOME/.bun/bin:\\$PATH"');
    expect(MACOS_INSTALLER).toContain('exec mso "\\$@"');
    expect(WINDOWS_INSTALLER).toContain("$Script = @'");
    expect(WINDOWS_INSTALLER).toContain('export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"');
  });

  it("actually routes Darwin and Termux through verified compatibility payloads", () => {
    const mac = dispatcherSmoke("Darwin");
    expect(mac.status, mac.stderr).toBe(0);
    expect(mac.dispatched).toBe("macos");

    const android = dispatcherSmoke("Linux", { PREFIX: "/data/data/com.termux/files/usr" });
    expect(android.status, android.stderr).toBe(0);
    expect(android.dispatched).toBe("android");
  });

  it("redirects Windows POSIX shells to the PowerShell/WSL2 entrypoint", () => {
    const windows = dispatcherSmoke("MINGW64_NT-10.0");
    expect(windows.status).toBe(64);
    expect(windows.stdout).toContain("install-windows.ps1");
    expect(windows.stdout).toContain("WSL2");
  });
});
