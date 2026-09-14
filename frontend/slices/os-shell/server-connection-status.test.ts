import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("shell-native server status", () => {
  it("is a manifest feature rather than a global fixed banner", () => {
    const auth = read("frontend/slices/auth/components/auth-gate.tsx");
    const manifest = read("frontend/slices/os-shell/shell.manifest.ts");
    expect(auth).not.toContain("SessionModeBanner");
    expect(auth).not.toContain('aria-label="Server connection mode"');
    expect(manifest).toContain("serverConnectionStatusFeature");
    expect(fs.existsSync(path.join(root, "frontend/slices/auth/components/session-mode-banner.tsx"))).toBe(false);
  });

  it("exposes one native host in every shell family", () => {
    const hosts = [
      ["frontend/slices/appshell/components/menu-bar-status.tsx", 'data-status-placement="menu-bar"'],
      ["frontend/slices/appshell/components/shells/windows/taskbar.tsx", 'data-status-placement="taskbar"'],
      ["frontend/slices/appshell/components/mobile-shell.tsx", 'data-status-placement="ios-status-bar"'],
      ["frontend/slices/appshell/components/shells/android/android-shell.tsx", 'data-status-placement="android-status-bar"'],
      ["frontend/slices/appshell/components/shells/dashboard/dashboard-shell.tsx", 'data-status-placement="dashboard-header"'],
    ] as const;
    for (const [file, marker] of hosts) {
      const source = read(file);
      expect(source).toContain(marker);
      expect(source).toContain('region="systemStatus"');
    }
  });
});
