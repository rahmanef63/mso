import { describe, expect, it } from "vitest";
import { aboutBreadcrumbs, aboutPageFromSearch, initialAboutPage } from "./about-pages";

describe("about nested pages", () => {
  it("keeps ?section=about on the overview and accepts nested page ids", () => {
    expect(aboutPageFromSearch(null)).toBe("overview");
    expect(aboutPageFromSearch("nope")).toBe("overview");
    expect(aboutPageFromSearch("version")).toBe("version");
    expect(aboutPageFromSearch("update")).toBe("updates");
    expect(initialAboutPage("appearance", "version")).toBe("overview");
    expect(initialAboutPage("about", "version")).toBe("version");
    expect(initialAboutPage("about", null)).toBe("overview");
  });

  it("omits breadcrumbs on the overview and builds them for nested pages", () => {
    const onAbout = () => {};
    expect(aboutBreadcrumbs("overview", { onAbout })).toBeUndefined();
    const version = aboutBreadcrumbs("version", { onAccount: () => {}, onAbout });
    expect(version?.map((item) => item.label)).toEqual(["Account", "About", "Version"]);
    expect(version?.[2]?.onSelect).toBeUndefined();
    expect(aboutBreadcrumbs("updates", { onAbout })?.map((item) => item.label)).toEqual(["About", "Updates"]);
  });
});
