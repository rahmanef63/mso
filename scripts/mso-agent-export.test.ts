import { describe, expect, it } from "vitest";
import {
  SHARE_UNAVAILABLE_MESSAGE,
  buildExportArgv,
  handleSlash,
} from "./mso-agent-commands.mjs";
import { slashCompletionItems } from "./mso-agent-slash.mjs";

describe("MSO Agent export and share commands", () => {
  it("builds export argv correctly for no args, with ref, and with --out", () => {
    // No args exports newest session
    expect(buildExportArgv()).toEqual(["session", "export"]);
    expect(buildExportArgv([])).toEqual(["session", "export"]);

    // With a ref
    expect(buildExportArgv("abc")).toEqual(["session", "export", "abc"]);
    expect(buildExportArgv(["abc"])).toEqual(["session", "export", "abc"]);

    // Appends --out when given
    expect(buildExportArgv("abc", "f")).toEqual([
      "session",
      "export",
      "abc",
      "--out",
      "f",
    ]);
    expect(buildExportArgv(undefined, "f")).toEqual([
      "session",
      "export",
      "--out",
      "f",
    ]);
    expect(buildExportArgv(["abc", "--out", "f"])).toEqual([
      "session",
      "export",
      "abc",
      "--out",
      "f",
    ]);
    expect(buildExportArgv(["--out", "f"])).toEqual([
      "session",
      "export",
      "--out",
      "f",
    ]);
  });

  it("ensures the share-unavailable message is honest and does not claim a link was created", () => {
    expect(SHARE_UNAVAILABLE_MESSAGE).toContain("/share is unavailable");
    expect(SHARE_UNAVAILABLE_MESSAGE).toContain(
      "server exposes only download of existing shares",
    );
    expect(SHARE_UNAVAILABLE_MESSAGE).not.toMatch(/https?:\/\//);
    expect(SHARE_UNAVAILABLE_MESSAGE).not.toContain("link created");
    // Ensure no em dash is used
    expect(SHARE_UNAVAILABLE_MESSAGE).not.toContain("\u2014");
  });

  it("handles /share gracefully and returns handled", async () => {
    const dummySession = { agentSession: { id: "session-123" } };
    const outcome = await handleSlash(null, "/share", dummySession, {
      // /share must not touch runTurn or runSubagent; pass stubs that would fail loudly.
      runTurn: async () => { throw new Error("runTurn must not be called by /share"); },
      runSubagent: async () => { throw new Error("runSubagent must not be called by /share"); },
    });
    expect(outcome).toBe("handled");
  });

  it("registers /export and /share in slash completion catalog", () => {
    const items = slashCompletionItems({ skills: [] }, "/", "/home/operator");
    const texts = items.map((i) => i.text);
    expect(texts).toContain("/export");
    expect(texts).toContain("/share");
  });
});
