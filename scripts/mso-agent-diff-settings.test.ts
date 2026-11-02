import { describe, expect, it } from "vitest";
import { formatEditDiff } from "./mso-agent-edit-diff.mjs";
import { paneLines } from "./mso-agent-pane.mjs";
import { SETTINGS, defaultSettings, resolveSetting } from "./mso-agent-settings.mjs";
import { handleSettingsCommand } from "./mso-agent-cmd-settings.mjs";

describe("MSO Agent diff settings and honesty checks", () => {
  // Test 1: Defaults reproduce existing output byte for byte against recorded fixtures
  it("1. default output is byte-identical to recorded fixtures for formatEditDiff and paneLines", () => {
    const parsedStandard = {
      path: "src/sample.ts",
      written: true,
      diff: "--- a/src/sample.ts\n+++ b/src/sample.ts\n@@ -1,3 +1,3 @@\n-const oldVal = 1;\n+const newVal = 2;\n context line\n",
    };
    const expectedStandard =
      "  edit sample.ts\n  --- a/src/sample.ts\n  +++ b/src/sample.ts\n  @@ -1,3 +1,3 @@\n  -const oldVal = 1;\n  +const newVal = 2;\n   context line";
    expect(formatEditDiff(parsedStandard)).toBe(expectedStandard);

    const parsedPreview = {
      path: "src/preview.ts",
      written: false,
      diff: "--- a/src/preview.ts\n+++ b/src/preview.ts\n@@ -1 +1 @@\n-old\n+new\n",
    };
    const expectedPreview =
      "  edit preview.ts (preview, not written)\n  --- a/src/preview.ts\n  +++ b/src/preview.ts\n  @@ -1 +1 @@\n  -old\n  +new";
    expect(formatEditDiff(parsedPreview)).toBe(expectedPreview);

    const parsedTrunc = {
      path: "src/sample.ts",
      written: true,
      diff: "@@ -1,5 +1,5 @@\n-line 1\n-line 2\n+line 3\n+line 4\n context\n",
    };
    const expectedTrunc =
      "  edit sample.ts\n  @@ -1,5 +1,5 @@\n  -line 1\n  -line 2\n  … 3 more lines";
    expect(formatEditDiff(parsedTrunc, { cap: 3 })).toBe(expectedTrunc);

    // Diff pane empty state byte fixture
    const emptyPane = paneLines({ kind: "diff", lastDiff: null, width: 35, rows: 6 });
    expect(emptyPane).toEqual([
      "┌─────────────────────────────────┐",
      "│Last edit diff                   │",
      "├─────────────────────────────────┤",
      "│(no edits in this session)       │",
      "│                                 │",
      "└─────────────────────────────────┘",
    ]);

    // Diff pane active state byte fixture
    const diffObj = {
      path: "src/sample.ts",
      diff: "--- a/src/sample.ts\n+++ b/src/sample.ts\n@@ -1,2 +1,2 @@\n-old line\n+new line\n",
    };
    const activePane = paneLines({ kind: "diff", lastDiff: diffObj, width: 35, rows: 8 });
    expect(activePane).toEqual([
      "┌─────────────────────────────────┐",
      "│Last edit diff                   │",
      "├─────────────────────────────────┤",
      "│edit sample.ts                   │",
      "│--- a/src/sample.ts              │",
      "│+++ b/src/sample.ts              │",
      "│@@ -1,2 +1,2 @@                  │",
      "└─────────────────────────────────┘",
    ]);
  });

  // Test 2 & 3: Each refused candidate from opencode is absent from registry and documented
  it("2. candidate diff settings are absent from the registry to prevent phantom switches", () => {
    const keys = SETTINGS.map((s) => s.key);
    const paths = SETTINGS.map((s) => s.path);
    const defaults: Record<string, any> = defaultSettings();

    // diffs.wrap: refused because diff lines are clipped by fitCells to pane width, never wrapped
    expect(keys).not.toContain("diffs.wrap");
    expect(keys).not.toContain("wrap");
    expect(paths).not.toContain("diffs.wrap");
    expect(defaults["diffs.wrap"]).toBeUndefined();

    // diffs.view: refused because split side-by-side in 30-50 col pane leaves 13-23 cols per side
    expect(keys).not.toContain("diffs.view");
    expect(keys).not.toContain("view");
    expect(paths).not.toContain("diffs.view");
    expect(defaults["diffs.view"]).toBeUndefined();

    // diffs.tree: refused because the files pane kind already lists all changed files
    expect(keys).not.toContain("diffs.tree");
    expect(keys).not.toContain("tree");
    expect(paths).not.toContain("diffs.tree");
    expect(defaults["diffs.tree"]).toBeUndefined();

    // diffs.single: refused because diff pane only ever resolves the single latest edit diff
    expect(keys).not.toContain("diffs.single");
    expect(keys).not.toContain("single");
    expect(paths).not.toContain("diffs.single");
    expect(defaults["diffs.single"]).toBeUndefined();
  });

  it("3. resolveSetting returns null for refused diff settings and /settings reports unknown", async () => {
    // Setting resolution checks
    expect(resolveSetting(SETTINGS, "diffs.view")).toBeNull();
    expect(resolveSetting(SETTINGS, "diffs.wrap")).toBeNull();
    expect(resolveSetting(SETTINGS, "diffs.tree")).toBeNull();
    expect(resolveSetting(SETTINGS, "diffs.single")).toBeNull();

    // Running /settings command with refused diff settings reports unknown setting
    const printed: string[] = [];
    const ctx = {
      session: { paneKind: "off" },
      C: {},
      write: (line: string) => printed.push(line),
    };

    await handleSettingsCommand(ctx, ["diffs.view", "split"]);
    expect(printed.some((p) => p.includes('unknown setting "diffs.view"'))).toBe(true);

    printed.length = 0;
    await handleSettingsCommand(ctx, ["diffs.wrap", "word"]);
    expect(printed.some((p) => p.includes('unknown setting "diffs.wrap"'))).toBe(true);
  });

  // Test 4: An invalid value is refused with the valid list
  it("4. invalid values are refused with the valid list of options", async () => {
    const printed: string[] = [];
    const session: any = { paneKind: "off" };
    const ctx = {
      session,
      C: {},
      write: (line: string) => printed.push(line),
    };

    // Refuse invalid pane value while listing valid options including diff
    await handleSettingsCommand(ctx, ["pane", "invalid_pane_kind"]);
    expect(session.paneKind).toBe("off");
    const paneWarning = printed.find((p) => p.includes("invalid value"));
    expect(paneWarning).toBeDefined();
    expect(paneWarning).toContain("todos, diff, files, mcp, context, off");

    // Setting a valid pane kind works immediately
    printed.length = 0;
    await handleSettingsCommand(ctx, ["pane", "diff"]);
    expect(session.paneKind).toBe("diff");

    // Refuse invalid layout option with valid list
    printed.length = 0;
    await handleSettingsCommand(ctx, ["layout", "diagonal"]);
    const layoutWarning = printed.find((p) => p.includes("invalid value"));
    expect(layoutWarning).toBeDefined();
    expect(layoutWarning).toContain("horizontal, vertical");

    // Refuse invalid verbosity option with valid list
    printed.length = 0;
    await handleSettingsCommand(ctx, ["verbosity", "maximum"]);
    const verbosityWarning = printed.find((p) => p.includes("invalid value"));
    expect(verbosityWarning).toBeDefined();
    expect(verbosityWarning).toContain("low, medium, high");
  });
});
