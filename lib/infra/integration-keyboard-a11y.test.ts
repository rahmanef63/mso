import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
  it("targets a focusable element that is not the whole-shell wrapper", () => {
    const osRoot = read("app/os-root.tsx");
    expect(osRoot, "the old target wrapped the menu bar, so it skipped nothing").not.toContain('href="#main-content"');
    expect(osRoot).toContain('href="#shell-main"');
  });

  it.each([
    ["frontend/slices/appshell/components/shells/macos/macos-shell.tsx", "macos"],
    ["frontend/slices/appshell/components/shells/windows/windows-shell.tsx", "windows"],
    ["frontend/slices/appshell/components/mobile-shell.tsx", "mobile"],
  ])("%s provides the target and a main landmark", (file) => {
    const src = read(file);
    expect(src, `${file} must carry the skip target`).toContain('id="shell-main"');
    expect(src, `${file} must declare the primary region`).toContain('role="main"');
    // tabIndex -1 makes it focusable by the hash jump without adding a tab stop of its own.
    expect(src).toMatch(/tabIndex=\{-1\}/);
  });
});

describe("integrations sidebar keyboard behaviour", () => {
  const src = read("lib/infra/connection-ui.ts");

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
