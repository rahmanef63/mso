// A waiver that never expires is a permanent hole. `accepted` used to be a comment:
// moving it to 2020 still passed `node scripts/audit.mjs --strict`.
import { describe, expect, it } from "vitest";
import { WAIVER_DAYS, expiredWaivers, waiverExpiry } from "./audit-waivers.mjs";

const day = 24 * 60 * 60 * 1000;

describe("dependency audit waiver expiry", () => {
  it("expires exactly WAIVER_DAYS after acceptance", () => {
    const accepted = "2026-11-18";
    const expiry = waiverExpiry(accepted);
    expect(expiry?.toISOString().slice(0, 10)).toBe("2027-02-16");
    expect(WAIVER_DAYS).toBe(90);
    expect(expiredWaivers({ X: { accepted } }, Date.parse(accepted) + 89 * day)).toEqual([]);
    expect(expiredWaivers({ X: { accepted } }, Date.parse(accepted) + 90 * day)).toHaveLength(1);
  });

  it("reports the id, the acceptance date and the expiry day", () => {
    const [line] = expiredWaivers({ "GHSA-x": { accepted: "2020-01-01" } }, Date.parse("2026-11-18"));
    expect(line).toContain("GHSA-x");
    expect(line).toContain("2020-01-01");
    expect(line).toContain("2020-03-31");
  });

  it("treats an unreadable acceptance date as expired, never as valid", () => {
    expect(waiverExpiry("not a date")).toBeNull();
    expect(expiredWaivers({ X: { accepted: "soon" } })).toHaveLength(1);
    expect(expiredWaivers({ X: {} })).toHaveLength(1);
    expect(expiredWaivers({})).toEqual([]);
  });
});
