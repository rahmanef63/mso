import { describe, it, expect } from "vitest";
import { sameGeometry, shouldUseMobileSurface } from "./responsive-provider";
import type { Responsive } from "./use-responsive";

const base: Responsive = {
  formFactor: "desktop",
  isMobile: false,
  device: "auto",
  vw: 1280,
  vh: 800,
  pointer: "fine",
  orientation: "landscape",
  breakpoint: "lg",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
};

describe("sameGeometry", () => {
  it("is false against null, so the first measurement always commits", () => {
    expect(sameGeometry(null, base)).toBe(false);
  });

  it("is true for an identical viewport — this is what stops the shell re-rendering", () => {
    expect(sameGeometry(base, { ...base })).toBe(true);
  });

  it("ignores safeArea, which is derived from the fields it does compare", () => {
    expect(sameGeometry(base, { ...base, safeArea: { top: 44, right: 0, bottom: 34, left: 0 } })).toBe(true);
  });

  it.each([
    ["vw", { vw: 1281 }],
    ["vh", { vh: 799 }], // a mobile URL-bar collapse
    ["isMobile", { isMobile: true }],
    ["device", { device: "phone" as const }],
    ["pointer", { pointer: "coarse" as const }],
    ["orientation", { orientation: "portrait" as const }],
    ["breakpoint", { breakpoint: "md" as const }],
  ])("is false when %s changes", (_label, patch) => {
    expect(sameGeometry(base, { ...base, ...patch })).toBe(false);
  });
});


describe("shouldUseMobileSurface", () => {
  it("uses mobile for portrait phones and desktop for the same phone rotated landscape", () => {
    expect(shouldUseMobileSurface("phone", 390, 844, true)).toBe(true);
    expect(shouldUseMobileSurface("phone", 844, 390, true)).toBe(false);
  });

  it("keeps the explicit Phone preview framed on a wide desktop viewport", () => {
    expect(shouldUseMobileSurface("phone", 1280, 800, false)).toBe(true);
  });

  it("keeps auto phone-width portrait mobile but makes phone-width landscape desktop", () => {
    expect(shouldUseMobileSurface("auto", 390, 844, true)).toBe(true);
    expect(shouldUseMobileSurface("auto", 667, 375, true)).toBe(false);
  });

  it("still treats a coarse portrait tablet below 1024px as mobile", () => {
    expect(shouldUseMobileSurface("auto", 820, 1180, true)).toBe(true);
    expect(shouldUseMobileSurface("auto", 820, 1180, false)).toBe(false);
  });

  it("desktop override always stays desktop", () => {
    expect(shouldUseMobileSurface("desktop", 390, 844, true)).toBe(false);
  });
});
