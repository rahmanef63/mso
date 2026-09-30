import { describe, expect, it } from "vitest";
import { hasAvailableUpdate } from "./update-status-client";

describe("software update navigation status", () => {
  it("shows the badge for a verified remote update or a checked-out build waiting to run", () => {
    expect(hasAvailableUpdate({ behind: 2, pendingBuild: false, remoteChecked: true })).toBe(true);
    expect(hasAvailableUpdate({ behind: 0, pendingBuild: true, remoteChecked: false })).toBe(true);
  });

  it("stays quiet when current or when remote freshness is unknown", () => {
    expect(hasAvailableUpdate({ behind: 0, pendingBuild: false, remoteChecked: true })).toBe(false);
    expect(hasAvailableUpdate({ behind: 2, pendingBuild: false, remoteChecked: false })).toBe(false);
  });
});
