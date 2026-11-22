import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guards that a merged fix cannot be silently deleted by a later PR.
//
// Why this file exists: #248 fixed four integration-UI defects with tests. PR #249 (unrelated
// feature work) overwrote two of those files with stale copies, reverting the code AND the tests
// that pinned it, so the gate stayed green while three of the four fixes were gone:
//
//   alertdialog on the confirmation dialog   -> missing
//   .transfer-error styling                  -> missing
//   role="alert" on the transfer error       -> missing
//
// Found by a browser audit, not by CI. These assertions read the source files directly and name the
// behaviour, so deleting the behaviour fails here even if the file is replaced wholesale.

const read = (p: string) => readFileSync(p, "utf8");

describe("integration UI fixes that must not regress", () => {
  it("confirmation dialog stays keyboard-operable and announced", () => {
    const src = read("lib/infra/connection-ui.ts");
    expect(src, "a destructive confirm must be an alertdialog").toContain('setAttribute("role","alertdialog")');
    expect(src, "assistive tech needs the dialog named").toContain('setAttribute("aria-labelledby"');
    expect(src, "Escape must cancel").toMatch(/event\.key==="Escape"/);
    expect(src, "focus must be restored to the trigger").toContain("document.activeElement");
  });

  it("transfer errors stay visible and announced", () => {
    const src = read("lib/infra/portable/ui.ts");
    expect(src, "the error needs a role so it is announced").toContain("role");
    const style = read("lib/infra/portable/ui.ts");
    expect(style, "the error class needs styling, not body text").toContain(".transfer-error{");
  });

  it("status badges wrap rather than overflow", () => {
    const css = read("lib/infra/connection-ui-style.ts");
    const state = css.match(/\.integration \.connection-state\{([^}]*)\}/)?.[1] ?? "";
    expect(state, "nowrap pushed the badge out of the card").not.toContain("white-space:nowrap");
    expect(state, "long labels must be able to wrap").toContain("overflow-wrap");
  });

  it("the sidebar search stays above the iOS auto-zoom threshold", () => {
    const css = read("lib/infra/connection-ui-style.ts");
    const search = css.match(/\.integration \.integration-sidebar-header>input\[type=search\]\{([^}]*)\}/)?.[1] ?? "";
    expect(search, "12px makes Safari zoom and never zoom back").not.toContain("font-size:var(--type-caption)");
    expect(search).toContain("font-size:var(--type-body)");
  });

  it("the lock curtain stays deferred while its timer stays eager", () => {
    // Deferred for bundle reasons in #222; the invariant is that the timer is mounted from the
    // provider, not from the deferred component.
    expect(read("frontend/slices/appshell/provider/app-shell.tsx")).toContain("useIdleAutoLock()");
    expect(read("frontend/slices/appshell/lib/use-idle-auto-lock.ts")).toContain("setTimeout(lock");
  });
});
