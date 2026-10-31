import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Eager bundle boundaries", () => {
  it("keeps heavy auth panels out of the main auth barrel", () => {
    const authBarrel = readFileSync("frontend/slices/auth/index.ts", "utf8");
    const authPanels = readFileSync("frontend/slices/auth/panels.ts", "utf8");

    // Main barrel keeps only session + gate
    expect(authBarrel).toContain("AuthGate");
    expect(authBarrel).toContain("SessionProvider");
    expect(authBarrel).not.toContain("LoginScreen");
    expect(authBarrel).not.toContain("LoginCard");
    expect(authBarrel).not.toContain("DevicesPanel");
    expect(authBarrel).not.toContain("ServerLoginPage");

    // Panels subpath exports them
    expect(authPanels).toContain("LoginScreen");
    expect(authPanels).toContain("LoginCard");
    expect(authPanels).toContain("DevicesPanel");
    expect(authPanels).toContain("ServerLoginPage");
  });

  it("keeps Alfa/chat out of the main appshell barrel and isolates in alfa subpath", () => {
    const appshellBarrel = readFileSync("frontend/slices/appshell/index.ts", "utf8");
    const alfaBarrel = readFileSync("frontend/slices/appshell/alfa.ts", "utf8");

    // Main barrel keeps CopyButton and tiny alfa-loader, but NO Alfa components/stores
    expect(appshellBarrel).toContain("CopyButton");
    expect(appshellBarrel).toContain("registerAlfaLoader");
    expect(appshellBarrel).not.toContain("AlfaThread");
    expect(appshellBarrel).not.toContain("ChatComposer");
    expect(appshellBarrel).not.toContain("alfa-run-state");
    expect(appshellBarrel).not.toContain("alfa-approval-policy");
    expect(appshellBarrel).not.toContain("alfa-work-context");

    // Alfa subpath exports them
    expect(alfaBarrel).toContain("AlfaThread");
    expect(alfaBarrel).toContain("ChatComposer");
    expect(alfaBarrel).toContain("alfa-run-state");
  });

  it("defers widgets and shortcut-help while keeping lock-screen eager for security boundary", () => {
    const widgetsIndex = readFileSync("frontend/slices/appshell/features/widgets/index.ts", "utf8");
    const shortcutIndex = readFileSync("frontend/slices/appshell/features/shortcut-help/index.ts", "utf8");
    const lockIndex = readFileSync("frontend/slices/appshell/features/lock-screen/index.ts", "utf8");
    const lockScreenSource = readFileSync("frontend/slices/appshell/features/lock-screen/components/lock-screen.tsx", "utf8");

    expect(widgetsIndex).toContain("DeferredDesktopWidgets");
    expect(widgetsIndex).toContain("DeferredMobileWidgets");
    expect(shortcutIndex).toContain("DeferredShortcutHelp");

    // Security invariant: lock-screen remains eagerly mounted to preserve idle auto-lock
    // as enforced by frontend/slices/organization/bundle-boundary.test.ts
    expect(lockIndex).toContain('from "./components/lock-screen"');
    expect(lockScreenSource).toContain("autoLockMinutes");
    expect(lockScreenSource).toContain("setTimeout(lock");
  });
});
