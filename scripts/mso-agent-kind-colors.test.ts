import { describe, expect, it, beforeEach } from "vitest";
import { applyTheme, C, kindColor } from "./mso-agent-theme.mjs";
import { menuLines } from "./mso-agent-composer-ui.mjs";

// The menu carries four kinds of row and they used to look identical: a single blue for the active row
// and nothing for the rest. Colour is now semantic (a hue per kind) AND symbolic (a glyph per kind),
// because colour alone disappears under NO_COLOR, the mono theme, or a captured frame.

const plain = (value: any) => String(value).replace(/\x1b\[[0-9;]*m/g, "");
const hues = (line: any) => [...String(line).matchAll(/\x1b\[38;2;(\d+;\d+;\d+)m/g)].map((m) => m[1]);

// Colour depends on a TTY, and the test host is not one.
const forceColor = () => { Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true }); };

describe("kind colours", () => {
  beforeEach(() => { forceColor(); applyTheme("dark"); });

  it("gives every row kind its own hue", () => {
    const agent = kindColor("agent", C);
    const plugin = kindColor("plugin", C);
    const command = kindColor("command", C);
    expect(agent).not.toBe("");
    expect(new Set([agent, plugin, command]).size).toBe(3);
  });

  it("treats an MCP plugin and a generic mcp row as the same kind", () => {
    expect(kindColor("mcp", C)).toBe(kindColor("plugin", C));
  });

  it("returns nothing for an unknown kind rather than a wrong colour", () => {
    expect(kindColor("nonsense", C)).toBe("");
    expect(kindColor("", C)).toBe("");
  });

  it("survives a theme switch", () => {
    const dark = kindColor("agent", C);
    applyTheme("light");
    expect(kindColor("agent", C)).not.toBe(dark);
    applyTheme("dark");
  });
});

describe("menu rows", () => {
  beforeEach(() => { forceColor(); applyTheme("dark"); });

  const items = [
    { label: "@worker", kind: "agent", meta: "agent · live" },
    { label: "@github", kind: "plugin", meta: "plugin · mcp · 12 tools" },
    { label: "/help", kind: "command", meta: "show commands" },
    { label: "/deploy", kind: "skill", state: "ready", meta: "skill" },
  ];

  it("paints a different hue for a non-selected agent, plugin and command", () => {
    // Only the SELECTED row used to be coloured, so a menu of three kinds looked like one kind.
    const lines = menuLines(items, 3, 90, C, "mixed").slice(1, 4);
    const first = new Set(lines.map((line) => hues(line)[0]));
    expect(first.size).toBe(3);
  });

  it("marks each kind with a glyph, so the difference survives no colour", () => {
    const mono = { ...C, blue: "", cyan: "", warn: "", err: "", violet: "", magenta: "", muted: "", dim: "", bold: "", reset: "" };
    const rows = menuLines(items, 0, 90, mono, "mixed").slice(1, 5).map(plain);
    expect(rows[0]).toContain("◉");
    expect(rows[1]).toContain("⬢");
    expect(rows[2]).toContain("/");
    expect(rows[3]).toContain("◇"); // a ready skill uses its state glyph, which is the skill marker
    // Byte-identical rows would mean the distinction was colour-only and is now invisible.
    expect(new Set(rows.map((row) => row.slice(2, 6))).size).toBeGreaterThan(1);
  });

  it("keeps every row inside the panel width", () => {
    for (const columns of [40, 60, 100]) {
      for (const row of menuLines(items, 0, columns, C, "mixed")) {
        expect(plain(row).length).toBeLessThanOrEqual(Math.max(38, Math.min(100, columns - 2)));
      }
    }
  });

  it("still shows selection with a marker independent of the kind hue", () => {
    const rows = menuLines(items, 1, 90, C, "mixed").slice(1, 3);
    expect(plain(rows[0]).startsWith("│   ")).toBe(true);
    expect(plain(rows[1]).startsWith("│ › ")).toBe(true);
  });
});
