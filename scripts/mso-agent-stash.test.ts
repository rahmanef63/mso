import { describe, expect, it } from "vitest";
import {
  createStash,
  stashClear,
  stashList,
  stashPop,
  stashPush,
} from "./mso-agent-stash.mjs";

describe("MSO Agent stash", () => {
  it("push trims whitespace and ignores empty input", () => {
    const stash = createStash();
    const emptyResult = stashPush(stash, "   ");
    expect(emptyResult.ok).toBe(false);
    expect(stashList(stash)).toEqual([]);

    const trimmedResult = stashPush(stash, "  draft prompt  ");
    expect(trimmedResult.ok).toBe(true);
    expect(trimmedResult.count).toBe(1);
    expect(stashList(stash)).toEqual(["draft prompt"]);
  });

  it("caps at 20 items and reports refusal", () => {
    const stash = createStash();
    for (let i = 1; i <= 20; i++) {
      const res = stashPush(stash, `prompt ${i}`);
      expect(res.ok).toBe(true);
    }
    expect(stashList(stash)).toHaveLength(20);

    const overflow = stashPush(stash, "prompt 21");
    expect(overflow.ok).toBe(false);
    expect(overflow.capped).toBe(true);
    expect(overflow.cap).toBe(20);
    expect(stashList(stash)).toHaveLength(20);
  });

  it("pop is LIFO", () => {
    const stash = createStash();
    stashPush(stash, "first");
    stashPush(stash, "second");
    stashPush(stash, "third");

    expect(stashPop(stash)).toBe("third");
    expect(stashPop(stash)).toBe("second");
    expect(stashPop(stash)).toBe("first");
    expect(stashPop(stash)).toBeNull();
  });

  it("list order is newest-first", () => {
    const stash = createStash();
    stashPush(stash, "alpha");
    stashPush(stash, "beta");
    stashPush(stash, "gamma");

    expect(stashList(stash)).toEqual(["gamma", "beta", "alpha"]);
  });

  it("clear reports count and empties stash", () => {
    const stash = createStash();
    expect(stashClear(stash)).toBe(0);

    stashPush(stash, "one");
    stashPush(stash, "two");
    stashPush(stash, "three");

    const dropped = stashClear(stash);
    expect(dropped).toBe(3);
    expect(stashList(stash)).toEqual([]);
  });
});
