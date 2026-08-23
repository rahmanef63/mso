import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("mobile feature navigation contract", () => {
  it("has one shell-owned root contract for iOS and Android", () => {
    for (const path of [
      "frontend/slices/appshell/components/shells/ios/ios-feature-header.tsx",
      "frontend/slices/appshell/components/shells/android/android-feature-header.tsx",
    ]) {
      const code = src(path);
      expect(code).toContain('aria-label={`Back to ${backLabel}`}');
      expect(code).toContain('aria-label="Ask AI"');
      expect(code).toContain("{title}");
      expect(code).toContain("{backLabel}");
    }
  });

  it("does not allow feature slices to bypass shell mobile navigation", () => {
    const types = src("frontend/slices/appshell/lib/types.ts");
    const settings = src("frontend/slices/os-settings/index.ts");
    expect(types).not.toContain("ownsMobileNavigation");
    expect(settings).not.toContain("ownsMobileNavigation");
  });

  it("moves app quick actions into the AI drawer instead of a second top-right action", () => {
    const ios = src("frontend/slices/appshell/components/mobile-shell.tsx");
    const android = src("frontend/slices/appshell/components/shells/android/android-shell.tsx");
    const ai = src("frontend/slices/appshell/features/inspector/components/alfa-sheet.tsx");
    expect(ios).not.toContain("AppActionsSheet");
    expect(android).not.toContain("AppActionsSheet");
    expect(ai).toContain('data-slot="mobile-ai-actions"');
  });
});
