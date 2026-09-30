/* ContextMenuHost + fleet-wide call-site audit (vitest, node env — no DOM
   renderer is installed and this round may not add deps, so these are
   source-level guards; see context-menu.test.ts for the same rationale).

   The bug these lock down: ContextMenu's open effect is torn down when its
   `onClose` prop changes identity, and the teardown used to close an open
   submenu + yank focus back to the trigger. ContextMenuHost is mounted around
   the WHOLE desktop, so it re-renders on every window-store patch — an inline
   `onClose={() => setMenu(null)}` therefore killed an open Workspace submenu
   whenever any window was opened, minimized or focused. Two belts: the effect
   split inside ContextMenu, and stable callbacks at every call site. */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SLICE = resolve(__dirname, "../..");
const host = readFileSync(resolve(__dirname, "context-menu-host.tsx"), "utf8");

// Every `<ContextMenu ...>` / `<ShellContextMenu ...>` element in the slice,
// as { file, tag, props } — props is the raw text up to the self-closing `/>`.
function callSites() {
  const files = readdirSync(SLICE, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".tsx"));
  return files.flatMap((f) => {
    const src = readFileSync(resolve(SLICE, f), "utf8");
    // Lookahead on space/newline so prose mentions like "<ContextMenu>" in a
    // doc comment (lib/context-zone.tsx) aren't mistaken for a real element.
    return [...src.matchAll(/<(Shell)?ContextMenu(?=[ \n])/g)].map((m) => {
      const start = m.index;
      const end = src.indexOf("/>", start);
      return { file: f, tag: m[0].slice(1), props: src.slice(start, end === -1 ? start + 400 : end) };
    });
  });
}

describe("ContextMenuHost", () => {
  it("hands ContextMenu a useCallback-stable onClose, never an inline closure", () => {
    expect(host).toMatch(/const close = useCallback\(\(\) => setMenu\(null\), \[\]\);/);
    expect(host).toMatch(/onClose=\{close\}/);
    expect(host).not.toMatch(/onClose=\{\(\) =>/);
  });

  it("keeps the onContextMenu handler stable too (one listener for the whole surface)", () => {
    expect(host).toMatch(/const onContextMenu = useCallback\(/);
    expect(host).toMatch(/\},\s*\[shell, surface\],\s*\);/);
  });

  it("leaves descendants marked for native context menus untouched before collecting zones or registry items", () => {
    const guard = host.indexOf("if (nativeContextMenu || !target) return;");
    expect(guard).toBeGreaterThan(-1);
    expect(host).toContain('e.nativeEvent.composedPath().some((node) =>');
    expect(guard).toBeLessThan(host.indexOf("collectZones(target, base)"));
    expect(guard).toBeLessThan(host.indexOf("getContextMenuItems(base)"));
  });

  // onClose was only the loudest of the three props. `pos` and `items` were still
  // rebuilt inline every render (`pos={menu ? { x: menu.x, y: menu.y } : null}`,
  // `items={menu?.items ?? []}`); harmless only because ContextMenu's destructive
  // effect keys on primitive coords. Keep all three stable so that one dep array is
  // not the only belt: `pos` nests inside the state object, `items` falls back to a
  // shared NO_ITEMS const.
  it("nests pos in the state object and shares one empty-items const", () => {
    expect(host).toMatch(/type Menu = \{ pos: \{ x: number; y: number \}; items: MenuItem\[\] \} \| null;/);
    expect(host).toMatch(/^const NO_ITEMS: MenuItem\[\] = \[\];$/m);
    expect(host).toMatch(/setMenu\(\{ pos: \{ x: e\.clientX, y: e\.clientY \}, items \}\)/);
    expect(host).toMatch(/pos=\{menu\?\.pos \?\? null\}/);
    expect(host).toMatch(/items=\{menu\?\.items \?\? NO_ITEMS\}/);
  });

  it("passes no freshly-allocated object or array to ContextMenu", () => {
    const el = host.slice(host.indexOf("<ContextMenu"));
    const props = el.slice(0, el.indexOf("/>"));
    // A literal in any prop = a new identity per render of the whole desktop.
    for (const bad of [/=\{\{/, /\?\? \[\]/, /\?\? \{\}/, /=\{\[/, /\{ x: menu/]) expect(props).not.toMatch(bad);
  });
});

describe("every ContextMenu call site in the appshell slice", () => {
  const sites = callSites();

  it("finds the known call sites (guards the scanner itself)", () => {
    expect(sites.length).toBeGreaterThanOrEqual(9);
    expect(sites.some((s) => s.file.endsWith("context-menu-host.tsx"))).toBe(true);
    expect(sites.some((s) => s.tag === "ShellContextMenu")).toBe(true);
  });

  it("passes a stable onClose reference — no inline arrow functions", () => {
    const bad = sites.filter((s) => /onClose=\{\s*\(\s*\)\s*=>/.test(s.props)).map((s) => `${s.file} <${s.tag}>`);
    expect(bad).toEqual([]);
  });

  it("passes an onClose at all (an undefined handler leaves the menu unclosable)", () => {
    const missing = sites.filter((s) => !/onClose=\{/.test(s.props)).map((s) => `${s.file} <${s.tag}>`);
    expect(missing).toEqual([]);
  });
});
