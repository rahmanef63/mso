import { describe, expect, it } from "vitest";
import { parseUpdateChannel, resolveUpdates, sanitizeUpdatesPatch, UPDATE_PREF_DEFAULTS } from "./updates";

describe("update preference shape", () => {
  it("defaults to opt-OUT on the stable channel", () => {
    expect(UPDATE_PREF_DEFAULTS).toEqual({ auto: false, channel: "main" });
    expect(resolveUpdates(undefined)).toEqual({ auto: false, channel: "main" });
    expect(resolveUpdates("garbage")).toEqual({ auto: false, channel: "main" });
  });

  it("tolerates a hand-edited store without letting it mean 'on'", () => {
    expect(resolveUpdates({ auto: "yes", channel: "nightly" })).toEqual({ auto: false, channel: "main" });
    expect(resolveUpdates({ auto: true, channel: "main" })).toEqual({ auto: true, channel: "main" });
  });

  it("accepts only the two documented keys with their documented types", () => {
    expect(sanitizeUpdatesPatch({ auto: true })).toEqual({ ok: true, patch: { auto: true } });
    expect(sanitizeUpdatesPatch({ channel: "main" })).toEqual({ ok: true, patch: { channel: "main" } });
    for (const bad of [
      { auto: "true" },
      { channel: "nightly" },
      { channel: "origin/main" },
      { auto: true, ref: "origin/main" },
      { auto: true, lastResult: "ok" },
      [],
      "on",
      {},
    ]) {
      expect(sanitizeUpdatesPatch(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("parses the channel enum without inventing a third value", () => {
    expect(parseUpdateChannel("stable")).toBe("stable");
    expect(parseUpdateChannel("main")).toBe("main");
    for (const bad of ["main2", "origin/main", "", null, 1, undefined]) expect(parseUpdateChannel(bad)).toBeNull();
  });

  it("defaults to main because release tags lag far behind this repo's branch", () => {
    // A tag-based default is not neutral here: v0.2.0 is an ancestor of HEAD with
    // >1000 commits between them, so `stable` would report "already up to date" and
    // hide the update action on a checkout that is far ahead of its newest tag.
    // main is also what every install followed before channels existed.
    expect(UPDATE_PREF_DEFAULTS.channel).toBe("main");
    // stable must still be reachable, as an explicit choice.
    expect(sanitizeUpdatesPatch({ channel: "stable" })).toEqual({ ok: true, patch: { channel: "stable" } });
  });

  it("does not resurrect stable from a stored record that never chose it", () => {
    // Hand-edited or pre-channel store: no channel key means "did not opt in".
    expect(resolveUpdates({ auto: true }).channel).toBe("main");
  });
});
