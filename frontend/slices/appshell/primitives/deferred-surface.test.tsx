import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DeferredSurface, loadDeferredSurface } from "./deferred-surface";

describe("deferred shell surfaces", () => {
  it("does not start importing a closed surface, even with retention enabled", () => {
    const load = vi.fn(async () => ({ default: () => null }));
    expect(renderToString(createElement(DeferredSurface, { active: false, load, label: "Inspector", keepMounted: true }))).toBe("");
    expect(load).not.toHaveBeenCalled();
  });
  it("deduplicates the loader while importing and after success", async () => {
    const load = vi.fn(async () => ({ default: () => null }));
    const first = loadDeferredSurface(load); const second = loadDeferredSurface(load);
    expect(second).toBe(first); await first;
    expect(loadDeferredSurface(load)).toBe(first); expect(load).toHaveBeenCalledTimes(1);
  });
  it("clears a failed import so a new intent can retry", async () => {
    const load = vi.fn(async () => ({ default: () => null })).mockRejectedValueOnce(new Error("missing chunk"));
    await expect(loadDeferredSurface(load)).rejects.toThrow("missing chunk");
    await expect(loadDeferredSurface(load)).resolves.toHaveProperty("default");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
