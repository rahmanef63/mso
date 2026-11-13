// The contract this pins: MSO can SEE and restart bot desktop containers, and there
// is no input that turns that into running somebody's command. Every case below
// fails if a caller string reaches an argv, so the injection proofs are the point of
// the file rather than an extra.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { parseContainerId, parseScreen, parseLifecycleAction, parseLogLines } = await import("./contracts");

/** A valid short docker id: 12 lowercase hex characters. */
const ID = "a1b2c3d4e5f6";

describe("container ids cannot become anything but an argument", () => {
  it("accepts a short id, a full id, and a bot container name", () => {
    expect(parseContainerId(ID)).toBe(ID);
    expect(parseContainerId("f".repeat(64))).toBe("f".repeat(64));
    expect(parseContainerId("grokbot-manef")).toBe("grokbot-manef");
    expect(parseContainerId(`  ${ID}  `)).toBe(ID);
  });

  it("rejects shell and argument-injection attempts", () => {
    for (const hostile of [
      "abc; rm -rf /",
      "abc && rm -rf /",
      "abc | cat /etc/shadow",
      "abc`id`",
      "abc$(id)",
      "abc\ndef",
      "../../etc/passwd",
      "/var/run/docker.sock",
      "-v /:/host",
      "--privileged",
      "-H tcp://evil:2375",
      "abc name",
      "abc'name",
      'abc"name',
      "",
      "   ",
      "abc",
      "a".repeat(65),
    ]) {
      expect(() => parseContainerId(hostile), hostile).toThrow();
    }
  });

  it("reports a 400 for a rejection rather than a 500", () => {
    try {
      parseContainerId("abc; rm -rf /");
      expect.unreachable("injection was accepted");
    } catch (error) {
      expect((error as { status?: number }).status).toBe(400);
    }
  });
});

describe("screen values are re-built by the server", () => {
  it("normalises both accepted spellings to ':' + two digits", () => {
    expect(parseScreen("99")).toBe(":99");
    expect(parseScreen(":99")).toBe(":99");
    expect(parseScreen(":01")).toBe(":01");
    expect(parseScreen("01")).toBe(":01");
    expect(parseScreen(" 01 ")).toBe(":01");
  });

  it("rejects anything that is not two digits", () => {
    for (const hostile of [
      "0",
      ":0",
      "100",
      ":099",
      "99; id",
      ":99 -window",
      "$(id)",
      "`id`",
      ":a9",
      "99\n:1",
      "",
      ":1",
      "1",
      ":00",
    ]) expect(() => parseScreen(hostile), hostile).toThrow();
  });
});

describe("the verb allowlist is exactly four words", () => {
  it("accepts start, stop, restart and logs", () => {
    for (const action of ["start", "stop", "restart", "logs"] as const) {
      expect(parseLifecycleAction(action)).toBe(action);
    }
  });

  it("rejects every other verb, including the ones that would be an exec surface", () => {
    for (const hostile of ["exec", "run", "shell", "sh", "bash", "create", "rm", "kill", "cp", "docker", "", "START"]) {
      expect(() => parseLifecycleAction(hostile), hostile).toThrow();
    }
  });
});

describe("log tails are bounded", () => {
  it("defaults when absent and clamps an oversized request", () => {
    expect(parseLogLines(undefined)).toBe(80);
    expect(parseLogLines(10)).toBe(10);
    expect(parseLogLines(500)).toBe(500);
    expect(parseLogLines(10_000)).toBe(500);
  });

  it("rejects zero, negatives, fractions and NaN", () => {
    for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parseLogLines(bad), String(bad)).toThrow();
    }
  });
});
