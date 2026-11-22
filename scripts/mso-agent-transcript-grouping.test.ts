import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { groupToolRows, transcriptLines } from "./mso-agent-transcript.mjs";
import { mountScreenLoop } from "./mso-agent-screen-loop.mjs";
import { handleSettingsCommand } from "./mso-agent-cmd-settings.mjs";

class FakeOutput extends EventEmitter {
  isTTY = true;
  columns = 80;
  rows = 24;
  chunks: string[] = [];
  write(str: string) {
    this.chunks.push(String(str));
    return true;
  }
}

function makeFixture() {
  return {
    history: [
      { role: "user", text: "Please read the files" },
      {
        role: "assistant",
        text: "Reading three files",
        toolUses: [
          { id: "call_1", name: "fs_read", input: { path: "a.txt" } },
          { id: "call_2", name: "fs_read", input: { path: "b.txt" } },
          { id: "call_3", name: "fs_read", input: { path: "c.txt" } },
        ],
      },
      {
        role: "tool",
        results: [
          { id: "call_1", content: "alpha" },
          { id: "call_2", content: "beta" },
          { id: "call_3", content: "gamma" },
        ],
      },
    ],
  };
}

describe("MSO Agent Transcript Tool Grouping", () => {
  it("1. default output is identical to before for a fixture with repeated tool calls, matching recorded expected string", () => {
    const fixture = makeFixture();
    const expected = [
      "[user] Please read the files",
      "[assistant] Reading three files",
      '[assistant] call fs_read {"path":"a.txt"}',
      '[assistant] call fs_read {"path":"b.txt"}',
      '[assistant] call fs_read {"path":"c.txt"}',
      "[tool] fs_read: alpha",
      "[tool] fs_read: beta",
      "[tool] fs_read: gamma",
    ];
    // With no options passed, transcriptLines behaves identically to before
    expect(transcriptLines(fixture)).toEqual(expected);
    // Passing groupTools: false explicitly yields the exact same array
    expect(transcriptLines(fixture, { groupTools: false })).toEqual(expected);
  });

  it("2. auto collapses consecutive same-tool rows into one counted row", () => {
    const fixture = makeFixture();
    const lines = transcriptLines(fixture, { groupTools: true, maxPerTool: 1 });
    expect(lines).toContain("[tool] fs_read (3 calls)");
    expect(lines).not.toContain("[tool] fs_read: alpha");
    expect(lines).not.toContain("[tool] fs_read: beta");
    expect(lines).not.toContain("[tool] fs_read: gamma");
    expect(lines[0]).toBe("[user] Please read the files");
  });

  it("3. an error row is never collapsed regardless of the setting", () => {
    const fixtureWithError = {
      history: [
        {
          role: "assistant",
          toolUses: [
            { id: "call_1", name: "fs_read" },
            { id: "call_2", name: "fs_read" },
            { id: "call_3", name: "fs_read" },
          ],
        },
        {
          role: "tool",
          results: [
            { id: "call_1", content: "alpha" },
            { id: "call_2", content: "error: file not found", isError: true },
            { id: "call_3", content: "gamma" },
          ],
        },
      ],
    };
    // Tool call with failure rendered under groupTools: true must remain visible
    const lines = transcriptLines(fixtureWithError, { groupTools: true });
    expect(lines.some((l) => l.includes("error: file not found"))).toBe(true);
    expect(lines).not.toContain("[tool] fs_read (3 calls)");

    // Raw string row grouping test verifying error lines break consecutive groups
    const rawLines = [
      "[tool] fs_read: alpha",
      "[tool] fs_read: beta",
      "[tool] fs_read: error: permission denied",
      "[tool] fs_read: delta",
      "[tool] fs_read: epsilon",
    ];
    const grouped = groupToolRows(rawLines, { maxPerTool: 1 });
    expect(grouped).toContain("[tool] fs_read: error: permission denied");
    expect(grouped).toContain("[tool] fs_read (2 calls)");
  });

  it("4. the setting is read from the session at both call sites (initial set and sync)", () => {
    const sessionAuto: any = { ...makeFixture(), grouping: "auto" };
    const output1 = new FakeOutput();
    const loop1 = mountScreenLoop({ enabled: true, session: sessionAuto, output: output1 as never, input: new EventEmitter() as never });
    // Call site 1 (initial mount): reads session.grouping === 'auto'
    expect(output1.chunks.join("")).toContain("fs_read (3 calls)");
    loop1.dispose();

    const sessionNone: any = { ...makeFixture(), grouping: "none" };
    const output2 = new FakeOutput();
    const loop2 = mountScreenLoop({ enabled: true, session: sessionNone, output: output2 as never, input: new EventEmitter() as never });
    expect(output2.chunks.join("")).not.toContain("fs_read (3 calls)");

    // Call site 2 (sync): re-reads session.grouping on sync
    sessionNone.grouping = "auto";
    output2.chunks = [];
    loop2.sync();
    expect(output2.chunks.join("")).toContain("fs_read (3 calls)");
    loop2.dispose();
  });

  it("5. changing the setting and repainting changes the output without a restart", async () => {
    const session: any = { ...makeFixture(), grouping: "none" };
    const output = new FakeOutput();
    const loop = mountScreenLoop({ enabled: true, session, output: output as never, input: new EventEmitter() as never });
    expect(output.chunks.join("")).not.toContain("fs_read (3 calls)");

    const ctx = { session, C: {}, width: 80, write: () => {} };
    output.chunks = [];
    await handleSettingsCommand(ctx, ["grouping", "auto"]);

    // Setting updated on session and screenLoop.sync() was called immediately
    expect(session.grouping).toBe("auto");
    expect(output.chunks.join("")).toContain("fs_read (3 calls)");

    output.chunks = [];
    await handleSettingsCommand(ctx, ["grouping", "none"]);
    expect(session.grouping).toBe("none");
    expect(output.chunks.join("")).not.toContain("fs_read (3 calls)");
    expect(output.chunks.join("")).toContain("fs_read: alpha");

    loop.dispose();
  });
});
