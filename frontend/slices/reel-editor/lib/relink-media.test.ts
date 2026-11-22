import { describe, expect, it } from "vitest";
import { defaultComposition } from "./mock-timeline";
import { acceptsRelinkType, replaceMedia } from "./relink-media";

describe("replaceMedia", () => {
  it("updates all clips sharing the missing asset while preserving timing and other clips", () => {
    const base = defaultComposition();
    const original = { url: "blob:old", type: "video" as const, natW: 10, natH: 10 };
    const comp = { ...base, clips: base.clips.map((clip, index) => index < 2 ? { ...clip, media: original } : clip) };
    const replacement = { ...original, url: "blob:new" };
    const result = replaceMedia(comp, "blob:old", replacement);
    expect(result.clips[0].media).toEqual(replacement);
    expect(result.clips[1].media).toEqual(replacement);
    expect(result.clips[0].start).toBe(comp.clips[0].start);
    expect(result.clips[2]).toBe(comp.clips[2]);
    expect(comp.clips[0].media).toBe(original);
  });
  it("leaves unrelated media untouched if the old URL is absent", () => {
    const comp = defaultComposition();
    const result = replaceMedia(comp, "blob:missing", { url: "blob:new", type: "image", natW: 1, natH: 1 });
    expect(result.clips).toEqual(comp.clips);
  });
});

it("rejects a file of a different media type", () => {
  expect(acceptsRelinkType("video", "image/png")).toBe(false);
  expect(acceptsRelinkType("video", "video/webm")).toBe(true);
});
