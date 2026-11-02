import { describe, expect, it } from "vitest";
import { createCommandLines } from "./mso-agent-command-lines.mjs";

// These three defects were all invisible to the existing suite and all found in a real terminal:
//
// 1. The composer grew its frame with CRLF while the panel still reserved the old height, so opening
//    the / menu scrolled the whole screen by 8 rows and the banner never came back.
// 2. Command output was appended straight into the viewport, and the next sync rebuilt the transcript
//    from history, so /help and /find printed nothing at all.
// 3. No test covered either, because every test drove the modules directly and never composed a frame.

describe("command line buffer", () => {
  it("keeps output so sync can compose it, instead of losing it to the transcript rebuild", () => {
    const command = createCommandLines();
    command.push("2 matches for \"needle\"");
    expect(command.lines).toEqual(["2 matches for \"needle\""]);
  });

  it("preserves order across many pushes, because command output reads top to bottom", () => {
    const command = createCommandLines();
    for (let i = 0; i < 5; i += 1) command.push(`line ${i}`);
    expect(command.lines).toEqual(["line 0", "line 1", "line 2", "line 3", "line 4"]);
  });

  it("bounds the buffer and drops from the front, since only the tail is ever visible", () => {
    const command = createCommandLines(3);
    for (let i = 0; i < 6; i += 1) command.push(`line ${i}`);
    expect(command.lines).toEqual(["line 3", "line 4", "line 5"]);
  });

  it("coerces null and undefined rather than printing the word, and never throws", () => {
    const command = createCommandLines();
    command.push(null);
    command.push(undefined);
    command.push(0);
    expect(command.lines).toEqual(["", "", "0"]);
  });

  it("clears to an empty array in place, so a composed reference stays valid", () => {
    const command = createCommandLines();
    command.push("a");
    const reference = command.lines;
    command.clear();
    expect(reference).toEqual([]);
    expect(reference).toBe(command.lines);
  });
});
