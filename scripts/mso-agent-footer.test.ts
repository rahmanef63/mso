import { describe, expect, it } from "vitest";
import { footerRows } from "./mso-agent-footer.mjs";
import { composeComposerLines, draftRowBudget, overlayFrame } from "./mso-agent-overlay.mjs";
import { commandDialogItems } from "./mso-agent-command-dialog.mjs";

// Everything here is geometry and formatting, which is exactly the layer that had no tests while two
// layout bugs shipped. The rule these assert is the one that was broken: the composer may never claim
// more rows than the terminal has, and the overlay may never shrink the panel.

const session = {
  permission: "ask",
  showReasoning: true,
  cwd: "/work/mso",
  history: Array.from({ length: 20 }, () => ({ role: "user", text: "x".repeat(2000) })),
  usage: { totalTokens: 12_500, inputTokens: 9_000, outputTokens: 3_500 },
  state: { config: { provider: "anthropic", model: "claude-sonnet" }, modelMeta: { context: 200_000 } },
};

const plain = (value: string) => String(value).replace(/\x1b\[[0-9;]*m/g, "");

describe("footer rows", () => {
  it("states mode, model and thinking on the first row", () => {
    const [top] = footerRows({ session, columns: 120 });
    expect(plain(top)).toContain("ask");
    expect(plain(top)).toContain("anthropic/claude-sonnet");
    expect(plain(top)).toContain("thinking on");
  });

  it("states directory, tokens, context and the dialog key on the second row", () => {
    const [, bottom] = footerRows({ session, columns: 120 });
    // Derives from process.env.HOME, so the assertion is about the shortening rule, not about a user.
    expect(plain(bottom)).toMatch(/^(~|\/work)/);
    expect(plain(bottom)).toContain("13k tokens"); // 12 500 rounds to 13k
    expect(plain(bottom)).toMatch(/context \d+%/); // measured from history via contextStatus
    expect(plain(bottom)).toContain("^P commands");
  });

  it("says thinking off when the session disabled it, rather than assuming on", () => {
    const [top] = footerRows({ session: { ...session, showReasoning: false }, columns: 120 });
    expect(plain(top)).toContain("thinking off");
  });

  it("omits a value the session does not carry instead of printing a placeholder", () => {
    // No history and no modelMeta, so there is no measurement to report. Claiming "context 0%" would
    // assert a window nobody configured.
    const bare = { permission: "yolo" };
    const [top, bottom] = footerRows({ session: bare, columns: 120 });
    expect(plain(top)).toBe("yolo  ·  thinking on");
    expect(plain(bottom)).not.toContain("tokens");
    expect(plain(bottom)).not.toContain("context");
  });

  it("never exceeds the terminal width", () => {
    for (const columns of [30, 40, 60, 120]) {
      for (const row of footerRows({ session, columns })) {
        expect(plain(row).length).toBeLessThanOrEqual(columns);
      }
    }
  });

  it("shows how many prompts are queued, because an accepted follow-up is otherwise invisible", () => {
    const queued = { ...session, queue: { items: ["one", "two"] } };
    expect(plain(footerRows({ session: queued, columns: 130 })[1])).toContain("2 queued");
    expect(plain(footerRows({ session, columns: 130 })[1])).not.toContain("queued");
  });

  it("emits no ANSI when no palette is passed", () => {
    for (const row of footerRows({ session, columns: 100 })) expect(row).not.toContain("\x1b");
  });
});

describe("composer frame", () => {
  it("claims prompt plus draft rows only, leaving the menu and footer to overlay", () => {
    const one = composeComposerLines({ prompt: "> ", draft: [""], menu: ["m1", "m2"], foot: ["f1"], promptWidth: 2 });
    expect(one.owned).toBe(1);
    expect(one.lines).toHaveLength(4);
    const three = composeComposerLines({ prompt: "> ", draft: ["a", "b", "c"], menu: [], foot: ["f1"], promptWidth: 2 });
    expect(three.owned).toBe(3);
  });

  it("keeps the footer exactly once, which is what a duplicated status row got wrong", () => {
    const { lines } = composeComposerLines({ prompt: "> ", draft: [""], menu: ["m1"], foot: ["only"], promptWidth: 2 });
    const { visible } = overlayFrame({ lines, menu: ["m1"], foot: ["only"], owned: 1, rows: 30 });
    expect(visible.filter((row) => row === "only")).toHaveLength(1);
  });

  it("anchors the frame so it can never run past the last row", () => {
    const { lines } = composeComposerLines({ prompt: "> ", draft: ["a", "b"], menu: ["m1", "m2", "m3"], foot: ["f"], promptWidth: 2 });
    const { visible, top } = overlayFrame({ lines, menu: ["m1", "m2", "m3"], foot: ["f"], owned: 2, rows: 24 });
    expect(top + visible.length - 1).toBeLessThanOrEqual(24);
    expect(top).toBeGreaterThanOrEqual(1);
  });

  it("shortens a tall menu instead of covering the panel", () => {
    const menu = Array.from({ length: 40 }, (_, i) => `m${i}`);
    const { lines } = composeComposerLines({ prompt: "> ", draft: [""], menu, foot: ["f"], promptWidth: 2 });
    const { visible } = overlayFrame({ lines, menu, foot: ["f"], owned: 1, rows: 20 });
    expect(visible.length).toBeLessThan(20);
  });

  it("gives the draft a bounded budget rather than a fraction of the screen", () => {
    expect(draftRowBudget({ rows: 24, menuRows: 0, footRows: 0 })).toBeGreaterThanOrEqual(2);
    expect(draftRowBudget({ rows: 12, menuRows: 8, footRows: 2 })).toBeGreaterThanOrEqual(2);
    expect(draftRowBudget({ rows: 60, menuRows: 0, footRows: 0 })).toBeLessThanOrEqual(12);
  });
});

describe("command dialog", () => {
  it("lists manifest rows with their description, sorted by name", () => {
    const items = commandDialogItems([
      { name: "/zzz", description: "last" },
      { name: "/aaa", description: "first" },
      { name: "not-a-command" },
    ]);
    expect(items.map((i) => i.label)).toEqual(["/aaa", "/zzz"]);
    expect(items[0].meta).toBe("first");
  });

  it("carries the usage suffix when the manifest declares one", () => {
    const [item] = commandDialogItems([{ name: "/find", usage: "[query]", description: "locate" }]);
    expect(item.text).toBe("/find [query]");
    expect(item.label).toBe("/find");
  });

  it("returns nothing for an empty or malformed manifest instead of throwing", () => {
    expect(commandDialogItems([])).toEqual([]);
    expect(commandDialogItems(null as any)).toEqual([]);
    expect(commandDialogItems([{ name: "" }])).toEqual([]);
  });
});
