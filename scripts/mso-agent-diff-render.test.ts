import { describe, expect, it } from "vitest";
import { renderDiff } from "./mso-agent-diff.mjs";

describe("MSO Agent diff renderer", () => {
  it("renderer marks added lines, removed lines, hunk headers, and leaves context lines unmarked", () => {
    const colors = {
      cyan: "\x1b[38;2;52;211;153m",
      err: "\x1b[38;2;239;68;68m",
      blue: "\x1b[38;2;58;160;255m",
      reset: "\x1b[0m",
    };
    const unifiedDiff = [
      "@@ -1,4 +1,4 @@",
      " context line 1",
      "-removed line",
      "+added line",
      " context line 2",
    ].join("\n");

    const rendered = renderDiff({
      artifact: { relativePath: "src/sample.ts" },
      diff: {
        available: true,
        changed: true,
        unifiedDiff,
      },
    }, { colors, full: true });

    // Hunk headers must be coloured blue
    expect(rendered).toContain(`${colors.blue}@@ -1,4 +1,4 @@${colors.reset}`);

    // Removed lines must be coloured err
    expect(rendered).toContain(`${colors.err}-removed line${colors.reset}`);

    // Added lines must be coloured cyan
    expect(rendered).toContain(`${colors.cyan}+added line${colors.reset}`);

    // Context lines remain untouched by colour escapes
    expect(rendered).toContain(" context line 1");
    expect(rendered).toContain(" context line 2");
    expect(rendered).not.toContain(`${colors.cyan} context line 1`);
    expect(rendered).not.toContain(`${colors.err} context line 1`);
    expect(rendered).not.toContain(`${colors.blue} context line 1`);

    // Mono or non-TTY styling must emit zero ANSI escape sequences
    const mono = renderDiff({
      artifact: { relativePath: "src/sample.ts" },
      diff: {
        available: true,
        changed: true,
        unifiedDiff,
      },
    }, { colors: { cyan: "", err: "", blue: "", reset: "" }, full: true });
    expect(mono).not.toContain("\x1b[");
  });

  it("renderer truncates at the cap and reports how many lines were withheld", () => {
    const lines = Array.from({ length: 30 }, (_, index) => `+added line ${index + 1}`).join("\n");
    const rendered = renderDiff({
      artifact: { relativePath: "src/sample.ts" },
      diff: {
        available: true,
        changed: true,
        unifiedDiff: lines,
      },
    }, { cap: 10, colors: { cyan: "", err: "", blue: "", reset: "" } });

    // Shows up to the cap
    expect(rendered).toContain("+added line 10");
    expect(rendered).not.toContain("+added line 11");

    // Reports exact withheld count and gives the --full hint
    expect(rendered).toContain("… 20 more lines, use --full");

    // With full: true, no lines are withheld
    const full = renderDiff({
      artifact: { relativePath: "src/sample.ts" },
      diff: {
        available: true,
        changed: true,
        unifiedDiff: lines,
      },
    }, { cap: 10, full: true, colors: { cyan: "", err: "", blue: "", reset: "" } });
    expect(full).toContain("+added line 30");
    expect(full).not.toContain("more lines");
  });

  it("available:false renders the server reason string verbatim", () => {
    const reasons = [
      "exact_snapshot_unavailable",
      "current_file_unavailable",
      "capture_root_unavailable",
      "path_unavailable",
      "no_capture_proof",
    ];

    for (const reason of reasons) {
      const rendered = renderDiff({
        artifact: { relativePath: "lib/agent/session.ts" },
        diff: {
          available: false,
          reason,
        },
      });
      // Verbatim reason string preservation
      expect(rendered).toContain(reason);
      expect(rendered).toContain("lib/agent/session.ts");
    }
  });

  it("changed:false renders an unchanged message, not an empty diff", () => {
    const rendered = renderDiff({
      artifact: { relativePath: "config/settings.json" },
      diff: {
        available: true,
        changed: false,
        unifiedDiff: "",
      },
    });

    // Confirms unchanged notice is emitted rather than blank diff
    expect(rendered).toMatch(/unchanged/i);
    expect(rendered).toContain("config/settings.json");
    expect(rendered).not.toContain("modified");
  });
});
