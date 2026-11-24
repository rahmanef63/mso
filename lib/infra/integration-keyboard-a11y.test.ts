import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONNECTION_MANAGER_SCRIPT } from "./connection-ui";

// Four keyboard defects found by a browser audit of the integrations page. All four are the kind
// that pass every unit test: they are about what the DOM does when you press keys, not about what
// the code says.
//
//   1. the skip link pointed at #main-content, which wraps the menu bar, so skipping to it skipped
//      nothing, and the target was not focusable
//   2. the closed mobile drawer was only translated off-screen, so its 30 items stayed in the tab
//      order and a keyboard user passed 31 invisible stops before reaching the toggle
//   3. the full-screen backdrop is a Tab stop, but the Escape handler lived on the panel, so Escape
//      did nothing while focus was on it
//   4. the "More" popover is a <details> with no Escape and no outside-click close, so Tab left it
//      open over the next card

const read = (p: string) => readFileSync(p, "utf8");

describe("skip link reaches the primary content", () => {
  it("targets a focusable main landmark in the Svelte 5 shell", () => {
    const route = read("frontend/svelte/src/routes/+page.svelte");
    expect(route).toContain("WorkspaceRoot");
    const root = read("frontend/svelte/src/lib/shell/WorkspaceRoot.svelte");
    expect(root).toContain('href="#main-content"');
    expect(root).toContain('id="main-content"');
    expect(root).toContain('tabindex="-1"');
  });
});

describe("integrations sidebar keyboard behaviour", () => {
  const src = CONNECTION_MANAGER_SCRIPT;

  it("makes the closed drawer inert so its items leave the tab order", () => {
    expect(src, "a translated-off-screen drawer is still focusable").toContain("sidebarPanel.inert=!sidebarOpen");
  });

  it("lets the backdrop answer Escape, not just the panel", () => {
    expect(src).toContain("sidebarBackdrop.addEventListener");
  });

  it("closes the More popover on Escape and on an outside click", () => {
    expect(src).toContain('more.addEventListener("keydown"');
    expect(src).toContain('more.addEventListener("toggle"');
    expect(src).toMatch(/more\.open=false/);
  });
});
