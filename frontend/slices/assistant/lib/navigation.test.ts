import { describe, expect, it } from "vitest";
import { assistantRouteFromPayload } from "./navigation";

describe("assistant navigation", () => {
  it("deep-links Organization as a first-class Alfa tab", () => {
    expect(assistantRouteFromPayload({ path: "/organization" })).toEqual({ key: "/organization", tab: "organization" });
    expect(assistantRouteFromPayload({ path: "/organization/holding" }).tab).toBe("organization");
  });
});
