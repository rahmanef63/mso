import { afterEach, describe, expect, it, vi } from "vitest";
import { hasAvailableUpdate, readStatus } from "./update-status-client";
afterEach(() => vi.unstubAllGlobals());

describe("software update navigation status", () => {
  it("polls without a mutation and refreshes with an explicit POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetchMock);
    await readStatus(false);
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
    fetchMock.mockResolvedValue(new Response("{}")); await readStatus(true);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify({ action: "check" }) });
  });
  it("shows the badge for a verified remote update or a checked-out build waiting to run", () => {
    expect(hasAvailableUpdate({ behind: 2, pendingBuild: false, remoteChecked: true })).toBe(true);
    expect(hasAvailableUpdate({ behind: 0, pendingBuild: true, remoteChecked: false })).toBe(true);
  });

  it("stays quiet when current or when remote freshness is unknown", () => {
    expect(hasAvailableUpdate({ behind: 0, pendingBuild: false, remoteChecked: true })).toBe(false);
    expect(hasAvailableUpdate({ behind: 2, pendingBuild: false, remoteChecked: false })).toBe(false);
  });
});
