import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canIntentPrefetch, createIntentPrefetch, PREFETCH_INTENT_MS, type PrefetchEnvironment } from "./intent-prefetch";

const app = () => ({ load: vi.fn(async () => ({ default: () => null })) });
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("intent-only app warming", () => {
  it("waits for deliberate intent, then warms once", async () => {
    const target = app(); const prefetch = createIntentPrefetch(() => ({}));
    prefetch.schedule(target);
    await vi.advanceTimersByTimeAsync(PREFETCH_INTENT_MS - 1);
    expect(target.load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(target.load).toHaveBeenCalledTimes(1);
    prefetch.schedule(target);
    await vi.advanceTimersByTimeAsync(PREFETCH_INTENT_MS);
    expect(target.load).toHaveBeenCalledTimes(1);
  });
  it("cancels on leave/blur/unmount without loading the app", async () => {
    const target = app(); const prefetch = createIntentPrefetch(() => ({}));
    prefetch.schedule(target); prefetch.cancel(); prefetch.cancel();
    await vi.runAllTimersAsync(); expect(target.load).not.toHaveBeenCalled();
  });
  it("replaces pending intent during a launcher sweep", async () => {
    const first = app(); const last = app(); const prefetch = createIntentPrefetch(() => ({}));
    prefetch.schedule(first); await vi.advanceTimersByTimeAsync(100); prefetch.schedule(last);
    await vi.runAllTimersAsync(); expect(first.load).not.toHaveBeenCalled(); expect(last.load).toHaveBeenCalledTimes(1);
  });
  it("never warms expensive opt-out apps or touch-hover events", async () => {
    const target = app(); const prefetch = createIntentPrefetch(() => ({}));
    prefetch.schedule({ ...target, prefetch: "never" }); await vi.runAllTimersAsync();
    prefetch.schedule(target, "touch"); await vi.runAllTimersAsync(); expect(target.load).not.toHaveBeenCalled();
  });
  it.each<PrefetchEnvironment>([{ hidden: true }, { online: false }, { saveData: true }, { effectiveType: "2g" }, { effectiveType: "slow-2g" }])("respects constrained state %j", async (environment) => {
    const target = app(); const prefetch = createIntentPrefetch(() => environment);
    expect(canIntentPrefetch(environment)).toBe(false);
    prefetch.schedule(target); await vi.runAllTimersAsync(); expect(target.load).not.toHaveBeenCalled();
  });
  it("rechecks visibility/network when intent expires", async () => {
    const target = app(); let environment: PrefetchEnvironment = {};
    const prefetch = createIntentPrefetch(() => environment);
    prefetch.schedule(target); environment = { hidden: true };
    await vi.runAllTimersAsync(); expect(target.load).not.toHaveBeenCalled();
  });
  it("deduplicates an in-flight module across independent surfaces", async () => {
    let resolve!: (value: { default: () => null }) => void;
    const target = { load: vi.fn(() => new Promise<{ default: () => null }>(done => { resolve = done; })) };
    createIntentPrefetch(() => ({})).schedule(target);
    createIntentPrefetch(() => ({})).schedule(target, "keyboard");
    await vi.advanceTimersByTimeAsync(PREFETCH_INTENT_MS);
    expect(target.load).toHaveBeenCalledTimes(1); resolve({ default: () => null });
    await Promise.resolve();
  });
  it("does not poison real loading after speculative rejection", async () => {
    const target = app(); target.load.mockRejectedValueOnce(new Error("offline"));
    const prefetch = createIntentPrefetch(() => ({}));
    prefetch.schedule(target); await vi.runAllTimersAsync();
    prefetch.schedule(target); await vi.runAllTimersAsync();
    expect(target.load).toHaveBeenCalledTimes(2);
  });
});
