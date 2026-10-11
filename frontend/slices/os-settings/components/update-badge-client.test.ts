import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const key = "mso:update-badge:v1";
const status = { behind: 1, remoteChecked: true, pendingBuild: false, log: "Synthetic build detail" };
let values: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  values = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(status)));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("background software update checks", () => {
  it("coalesces concurrent badges and stores no update details", async () => {
    const { readBadgeStatus } = await import("./update-status-client");
    const first = readBadgeStatus(), second = readBadgeStatus();
    expect(second).toBe(first);
    expect(await first).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(values.get(key)!)).toEqual({ available: true, checkedAt: expect.any(Number) });
    expect(values.get(key)).not.toContain(status.log);
  });

  it("reuses the result after a full module reload within the same tab", async () => {
    await (await import("./update-status-client")).readBadgeStatus();
    vi.resetModules();
    expect(await (await import("./update-status-client")).readBadgeStatus()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("checks again after one minute", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const { readBadgeStatus } = await import("./update-status-client");
    await readBadgeStatus();
    clock.mockReturnValue(160_000);
    await readBadgeStatus();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps explicit checks fresh while the badge result is cached", async () => {
    const { readBadgeStatus, readStatus } = await import("./update-status-client");
    await readBadgeStatus();
    await readStatus(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify({ action: "check" }) });
  });

  it("retries failed checks instead of caching a rejection", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Synthetic network failure"));
    const { readBadgeStatus } = await import("./update-status-client");
    await expect(readBadgeStatus()).rejects.toThrow("Synthetic network failure");
    expect(await readBadgeStatus()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still discovers updates when tab storage is unavailable", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(await (await import("./update-status-client")).readBadgeStatus()).toBe(true);
  });

  it.each(["not JSON", '{"available":"yes","checkedAt":0}', JSON.stringify({ available: true, checkedAt: Date.now() + 120_000 })])("ignores invalid or future cache values: %s", async (cached) => {
    values.set(key, cached);
    expect(await (await import("./update-status-client")).readBadgeStatus()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
