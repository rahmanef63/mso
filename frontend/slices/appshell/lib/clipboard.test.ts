import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearClips, copyClip, listClips, recordClip, removeClip, togglePinClip } from "./clipboard";
import { getCommands } from "./commands";

function reset() {
  listClips().forEach((c) => removeClip(c.id));
}

describe("clipboard history", () => {
  beforeEach(reset);
  afterEach(() => vi.unstubAllGlobals());

  it("records only successful clipboard writes", async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyClip("hello")).toBe(false);
    expect(listClips()).toEqual([]);
    expect(await copyClip("hello")).toBe(true);
    expect(listClips().map((c) => c.text)).toEqual(["hello"]);
    vi.stubGlobal("navigator", {});
    expect(await copyClip("other")).toBe(false);
  });

  it("records newest-first, dedupes the top, ignores empties", () => {
    recordClip("one");
    recordClip("one"); // dup of top — ignored
    recordClip("  "); // empty — ignored
    recordClip("two");
    expect(listClips().map((c) => c.text)).toEqual(["two", "one"]);
  });

  it("pinned entries survive clearClips", () => {
    recordClip("keep");
    recordClip("drop");
    togglePinClip(listClips().find((c) => c.text === "keep")!.id);
    clearClips();
    expect(listClips().map((c) => c.text)).toEqual(["keep"]);
  });

  it("registers the palette command", () => {
    expect(getCommands().map((c) => c.id)).toContain("clipboard:history");
  });
});
