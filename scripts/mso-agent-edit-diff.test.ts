import { describe, expect, it, vi } from "vitest";
import { formatEditDiff, parseEditDiff, parseEditResult, printEditDiff } from "./mso-agent-edit-diff.mjs";

describe("MSO Agent edit diff preview", () => {
  it("1. a real edit result prints a label with the basename and contains the -old and +new lines", () => {
    const raw = JSON.stringify({
      ok: true,
      path: "src/utils/calculator.ts",
      written: true,
      diff: [
        "@@ -1,4 +1,4 @@",
        " context line before",
        "-old line content",
        "+new line content",
        " context line after",
      ].join("\n"),
    });

    const parsed = parseEditResult(raw);
    expect(parsed).not.toBeNull();

    const printed: string[] = [];
    const sink = (line: string) => { printed.push(line); };

    const handled = printEditDiff(parsed, { print: sink });
    expect(handled).toBe(true);
    expect(printed).toHaveLength(1);

    const output = printed[0];
    expect(output).toContain("edit calculator.ts");
    expect(output).toContain("-old line content");
    expect(output).toContain("+new line content");
    expect(output).toContain("context line before");
    expect(output).toContain("context line after");

    // Every line is prefixed with two spaces of indent
    const lines = output.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.startsWith("  ")).toBe(true);
    }
  });

  it("2. a dry run (written: false) label says it was a preview", () => {
    const raw = JSON.stringify({
      ok: true,
      path: "/home/user/workspace/config.json",
      written: false,
      diff: [
        "@@ -1,2 +1,2 @@",
        "-old config",
        "+new config",
      ].join("\n"),
    });

    const parsed = parseEditResult(raw);
    expect(parsed).not.toBeNull();

    const output = formatEditDiff(parsed);
    expect(output).toContain("edit config.json (preview, not written)");
    expect(output).toMatch(/preview/);
  });

  it("3. an empty diff prints nothing and printEditDiff returns false", () => {
    const parsed = {
      path: "empty.txt",
      written: true,
      diff: "",
    };

    const print = vi.fn();
    const result = printEditDiff(parsed, { print });

    expect(result).toBe(false);
    expect(print).not.toHaveBeenCalled();
    expect(formatEditDiff(parsed)).toBe("");
  });

  it("4. an unparseable result and a JSON non-object both return null from parseEditDiff and print nothing", () => {
    expect(parseEditDiff("not json at all {")).toBeNull();
    expect(parseEditDiff("42")).toBeNull();
    expect(parseEditDiff('"just a string"')).toBeNull();
    expect(parseEditDiff("[1, 2, 3]")).toBeNull();
    expect(parseEditDiff("null")).toBeNull();
    expect(parseEditDiff(null)).toBeNull();
    expect(parseEditDiff(undefined)).toBeNull();
    expect(parseEditDiff(JSON.stringify({ path: "no-diff.ts" }))).toBeNull();

    const print = vi.fn();
    expect(printEditDiff(parseEditDiff("not json at all {"), { print })).toBe(false);
    expect(printEditDiff(parseEditDiff("42"), { print })).toBe(false);
    expect(printEditDiff(parseEditDiff(null), { print })).toBe(false);
    expect(print).not.toHaveBeenCalled();
  });

  it("5. cap is respected and the withheld count is reported", () => {
    const diffLines = [
      "@@ -1,10 +1,10 @@",
      "-line 1",
      "+line 1",
      "-line 2",
      "+line 2",
      "-line 3",
      "+line 3",
      "-line 4",
      "+line 4",
    ];
    const parsed = {
      path: "cap-test.txt",
      written: true,
      diff: diffLines.join("\n"),
    };

    const output = formatEditDiff(parsed, { cap: 3 });
    expect(output).toContain("… 6 more lines");
    expect(output).toContain("-line 1");
    expect(output).not.toContain("-line 3");
  });

  it("6. diffTruncated: true adds the server-truncation note", () => {
    const parsed = {
      path: "truncated.txt",
      written: true,
      diff: [
        "@@ -1,2 +1,2 @@",
        "-old line",
        "+new line",
      ].join("\n"),
      diffTruncated: true,
    };

    const output = formatEditDiff(parsed);
    expect(output).toContain("diff truncated by server");
  });

  it("7. colours are applied only when a palette is passed (no ANSI codes in the output when colors is empty/undefined)", () => {
    const parsed = {
      path: "colors-test.txt",
      written: true,
      diff: [
        "@@ -1,3 +1,3 @@",
        " context line",
        "-old line",
        "+new line",
      ].join("\n"),
    };

    const noPalette = formatEditDiff(parsed);
    expect(noPalette).not.toContain("\x1b[");

    const emptyPalette = formatEditDiff(parsed, { colors: {} });
    expect(emptyPalette).not.toContain("\x1b[");

    const monoPalette = formatEditDiff(parsed, {
      colors: { blue: "", cyan: "", err: "", dim: "", reset: "" },
    });
    expect(monoPalette).not.toContain("\x1b[");

    const fullPalette = {
      blue: "\x1b[34m",
      cyan: "\x1b[36m",
      err: "\x1b[31m",
      dim: "\x1b[2m",
      reset: "\x1b[0m",
    };
    const colored = formatEditDiff(parsed, { colors: fullPalette });
    expect(colored).toContain("\x1b[34m@@ -1,3 +1,3 @@\x1b[0m");
    expect(colored).toContain("\x1b[31m-old line\x1b[0m");
    expect(colored).toContain("\x1b[36m+new line\x1b[0m");
    expect(colored).toContain("\x1b[2m context line\x1b[0m");
  });

  it("clears live activity and prints checkmark before diff in live mode", () => {
    const parsed = {
      path: "live.ts",
      written: true,
      diff: [
        "@@ -1,2 +1,2 @@",
        "-a",
        "+b",
      ].join("\n"),
    };
    const printed: string[] = [];
    const cleared: string[] = [];
    const mockActivity = {
      live: true,
      clear: () => { cleared.push("cleared"); },
    };
    const colors = { c: "\x1b[36m", reset: "\x1b[0m" };
    const handled = printEditDiff(parsed, {
      colors,
      print: (line: string) => { printed.push(line); },
      activity: mockActivity as any,
    });
    expect(handled).toBe(true);
    expect(cleared).toHaveLength(1);
    expect(printed[0]).toContain("✓ fs_edit");
    expect(printed[1]).toContain("edit live.ts");
  });
});
