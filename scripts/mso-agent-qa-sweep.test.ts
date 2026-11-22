import { describe, expect, it } from "vitest";
import { approvalActionSummary, approvalArgsSummary, approvalDetailLines } from "./mso-agent-approval-ui.mjs";
import { nextPermissionMode } from "./mso-agent-permissions.mjs";
import { contextStatus } from "./mso-agent-status.mjs";
import { commandDialogItems } from "./mso-agent-command-dialog.mjs";
import { normalizeKey, loadKeybinds } from "./mso-agent-keybinds.mjs";
import { composeComposerLines, overlayFrame } from "./mso-agent-overlay.mjs";
import { footerRows } from "./mso-agent-footer.mjs";
import { cellWidth } from "./tui/cells.mjs";

// One test file for the QA sweep, so every fix carries the failure that motivated it. Each block names
// what the bug looked like to a user, because that is what a future refactor would reintroduce.

describe("approval fidelity", () => {
  const multiLine = "echo done # cleanup\nrm -f /tmp/victim";

  it("never flattens a multi-line command into what reads as a comment", () => {
    // The old summary printed "run echo done # cleanup rm -f /tmp/victim", where everything after "#"
    // looks like a shell comment. The executor runs BOTH lines.
    const summary = approvalActionSummary({ name: "exec_run" }, { command: multiLine });
    expect(summary).toContain("+1 more lines");
    expect(summary).not.toContain("rm -f");
  });

  it("shows every command line, numbered, in the detail view", () => {
    const lines = approvalDetailLines({ name: "exec_run", scope: "exec" }, { command: multiLine }, { digest: "d" });
    const body = lines.join("\n");
    expect(body).toContain("1│ echo done # cleanup");
    expect(body).toContain("2│ rm -f /tmp/victim");
  });

  it("reports how many array or object entries were withheld", () => {
    // Eight of forty files with no marker is an approval for eight files.
    const shown = approvalArgsSummary({ files: Array.from({ length: 40 }, (_, i) => `f${i}`) });
    expect(shown).toContain("+32 more");
  });

  it("keeps a single-line command on one row", () => {
    expect(approvalActionSummary({ name: "exec_run" }, { command: "ls -la" })).toBe("run ls -la");
  });
});

describe("permission mode", () => {
  it("falls back to the safest mode on unknown input instead of escalating", () => {
    // findIndex(-1) clamped to 0 and then ADVANCED to auto, so a typo granted write approval.
    for (const bad of ["bogus", "", undefined, null, "ASKing"]) {
      expect(nextPermissionMode(bad).id).toBe("ask");
    }
  });

  it("still cycles in order for known modes", () => {
    expect(nextPermissionMode("ask").id).toBe("auto");
    expect(nextPermissionMode("auto").id).toBe("yolo");
    expect(nextPermissionMode("yolo").id).toBe("ask");
  });
});

describe("context percentage", () => {
  it("measures against the window, so a full window reads 100%", () => {
    // The old formula divided by a budget capped at 120k, so a 200k window could never exceed 55%.
    const rows = Array.from({ length: 800 }, () => ({ role: "user", text: "x".repeat(1000) }));
    const ctx = contextStatus(rows, { context: 200_000 });
    expect(ctx.stored).toBeGreaterThan(ctx.limit ?? 0);
    expect(ctx.percent).toBe(100);
  });

  it("reports null percent when no window is configured", () => {
    expect(contextStatus([{ role: "user", text: "hi" }], {}).percent).toBeNull();
  });
});

describe("command dialog", () => {
  it("dispatches the command name, never the usage placeholder", () => {
    // Selecting "/terminal [cmd]" ran `sh -c "[cmd]"`; 32 of 46 rows carried a placeholder.
    const items = commandDialogItems([
      { name: "/terminal", usage: "[cmd]", description: "run" },
      { name: "/queue", usage: "[drop|clear|prompt]", description: "queue" },
    ]);
    expect(items.map((i) => i.value)).toEqual(["/queue", "/terminal"]);
    expect(items.find((i) => i.value === "/terminal")?.text).toBe("/terminal [cmd]");
  });

  it("splits a row that declares several names", () => {
    // "/exit, /quit" dispatched the first token "/exit," which matched nothing, so the dialog could not quit.
    const items = commandDialogItems([{ name: "/exit, /quit", description: "leave" }]);
    expect(items.map((i) => i.value)).toEqual(["/exit", "/quit"]);
  });
});

describe("keybinds", () => {
  it("canonicalises modifier order so a permuted binding still fires", () => {
    expect(normalizeKey("shift+ctrl+k")).toBe(normalizeKey({ ctrl: true, shift: true, name: "k" }));
    expect(normalizeKey("alt+ctrl+p")).toBe("ctrl+alt+p");
  });

  it("treats ctrl+i as tab, which is what the terminal reports", () => {
    expect(normalizeKey("ctrl+i")).toBe("tab");
    expect(normalizeKey("ctrl+m")).toBe("return");
  });

  it("refuses an unknown key instead of binding a bare letter that swallows typing", () => {
    const loaded = loadKeybinds({
      path: "/tmp/unused-keybinds.json",
      readFile: () => JSON.stringify({ clear_screen: "ctrlp+p" }),
    });
    expect(loaded.bindings.clear_screen).toBe("ctrl+l");
    expect(loaded.warnings.join(" ")).toContain("invalid key");
  });

  it("warns when two actions claim one key", () => {
    const loaded = loadKeybinds({
      path: "/tmp/unused-keybinds.json",
      readFile: () => JSON.stringify({ submit: "ctrl+c" }),
    });
    expect(loaded.warnings.join(" ")).toMatch(/interrupt and submit/);
  });
});

describe("composer frame budget", () => {
  it("reserves the footer, so the frame never paints over the panel", () => {
    const foot = ["mode · model", "/repo · ^P commands"];
    for (const draftRows of [1, 2, 3, 5]) {
      const { lines, owned } = composeComposerLines({
        prompt: "> ", draft: Array(draftRows).fill("x"), menu: [], foot, promptWidth: 2,
      });
      const { top, visible } = overlayFrame({ lines, menu: [], foot, owned, rows: 24 });
      expect(owned).toBe(draftRows + foot.length);
      expect(top + visible.length - 1).toBeLessThanOrEqual(24);
    }
  });

  it("keeps only the menu as an overlay, because it is transient", () => {
    const { owned } = composeComposerLines({
      prompt: "> ", draft: [""], menu: Array(12).fill("m"), foot: ["f"], promptWidth: 2,
    });
    expect(owned).toBe(2);
  });
});

describe("terminal width", () => {
  it("keeps footer rows inside the terminal for wide characters and colours", () => {
    const colors = { dim: "\x1b[2m", reset: "\x1b[0m", bold: "\x1b[1m", c: "\x1b[36m" };
    for (const columns of [20, 30, 60, 100]) {
      const session = {
        permission: "ask",
        // Derived from HOME so the fixture is about the shortening rule, not about one machine's paths.
        cwd: `${process.env.HOME || "/work"}/projects/日本語/クライアント/株式会社サンプル`,
        usage: { totalTokens: 123_456 },
        history: [{ role: "user", text: "x".repeat(2000) }],
        state: { config: { provider: "openai", model: "gpt" }, modelMeta: { context: 200_000 } },
      };
      for (const row of footerRows({ session, colors, columns })) {
        expect(cellWidth(row)).toBeLessThanOrEqual(columns);
        // A clipped escape sequence would leave a dangling CSI that eats following characters.
        expect((row.match(/\x1b\[/g) || []).length).toBe((row.match(/\x1b\[[0-9;]*m/g) || []).length);
      }
    }
  });
});
