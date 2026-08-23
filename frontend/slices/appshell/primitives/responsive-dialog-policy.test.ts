import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("cross-shell modal policy", () => {
  it("routes feature forms and confirms through ResponsiveDialog/FormDrawer", () => {
    const root = join(process.cwd(), "frontend", "slices");
    const allowed = new Set([
      "appshell/features/force-quit/force-quit.tsx", // macOS-only native Force Quit window
      "appshell/primitives/responsive-dialog-parts.tsx",
      "appshell/primitives/responsive-dialog-shell.tsx",
    ]);
    const offenders = walk(root)
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => [relative(root, file).replaceAll("\\", "/"), readFileSync(file, "utf8")] as const)
      .filter(([rel, src]) => !allowed.has(rel) && /from ["']@\/components\/ui\/(dialog|alert-dialog)["']/.test(src))
      .map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });
});
