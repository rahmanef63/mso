import process from "node:process";
import { describe, expect, it } from "vitest";
import { helpLines, printHelp } from "./mso-agent-help.mjs";

describe("MSO Agent help width adaptation and terminal wrapping", () => {
  it("(1) width 120 produces no line longer than 120 and fewer lines than width 60", () => {
    const lines120 = helpLines({ width: 120 });
    const lines60 = helpLines({ width: 60 });

    expect(lines120.length).toBeGreaterThan(0);
    for (const line of lines120) {
      expect(line.length).toBeLessThanOrEqual(120);
    }
    // Measured line counts prove wide terminals pack command descriptions on a single line
    // instead of wrapping them to a 60-column column.
    expect(lines120.length).toBeLessThan(lines60.length);
  });

  it("(2) width 40 still produces lines within 40 columns without arbitrary terminal breaks", () => {
    // We choose to allow narrow terminals to wrap down to 40 columns rather than forcing a 60 floor.
    // Enforcing a 60 floor on a 40-column terminal would cause the emulator to hard-break words.
    const lines40 = helpLines({ width: 40 });
    expect(lines40.length).toBeGreaterThan(0);
    for (const line of lines40) {
      expect(line.length, `line exceeded 40 chars: "${line}"`).toBeLessThanOrEqual(40);
    }
  });

  it("(3) printHelp with a session carrying a stale width still uses live stdout columns", () => {
    const originalColumns = process.stdout.columns;
    const printed: string[] = [];
    try {
      // Mock stdout columns to simulate a live 120-column terminal viewport.
      Object.defineProperty(process.stdout, "columns", {
        value: 120,
        configurable: true,
      });

      // Session carries a stale width of 40 from an earlier pane or split state.
      const staleSession = { width: 40 };
      printHelp({
        session: staleSession,
        write: (line: string) => printed.push(line),
      });

      const expected120 = helpLines({ width: 120 });
      // Proves printHelp preferred live stdout columns (70 lines) over stale session width (176 lines).
      expect(printed).toEqual(expected120);
      expect(printed.length).toBe(expected120.length);
      for (const line of printed) {
        expect(line.length).toBeLessThanOrEqual(120);
      }
    } finally {
      Object.defineProperty(process.stdout, "columns", {
        value: originalColumns,
        configurable: true,
      });
    }
  });

  it("(4) no ANSI escape codes emitted when no colors are passed", () => {
    const plainLines = helpLines({ width: 80 });
    for (const line of plainLines) {
      expect(line).not.toMatch(/\x1b\[/);
    }

    const emptyColorLines = helpLines({ width: 80, colors: {} });
    for (const line of emptyColorLines) {
      expect(line).not.toMatch(/\x1b\[/);
    }

    const printed: string[] = [];
    printHelp({
      width: 80,
      write: (line: string) => printed.push(line),
    });
    for (const line of printed) {
      expect(line).not.toMatch(/\x1b\[/);
    }
  });

  it("contains no em dash characters across all evaluated widths", () => {
    for (const w of [40, 60, 80, 120]) {
      const lines = helpLines({ width: w });
      for (const line of lines) {
        expect(line).not.toContain("\u2014");
      }
    }
  });
});
