import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsBreadcrumbs, SettingsFeatureCell } from "./breadcrumbs";

describe("settings breadcrumbs", () => {
  it("renders nothing when the feature cell omits the prop", () => {
    const html = renderToStaticMarkup(createElement(SettingsFeatureCell, null, createElement("p", null, "Body")));
    expect(html).toBe("<p>Body</p>");
    expect(renderToStaticMarkup(createElement(SettingsBreadcrumbs, { items: [] }))).toBe("");
    expect(renderToStaticMarkup(createElement(SettingsBreadcrumbs, {}))).toBe("");
  });

  it("renders a trail from the crumbs the cell passes", () => {
    const html = renderToStaticMarkup(
      <SettingsFeatureCell breadcrumbs={[
        { label: "Account", onSelect: () => {} },
        { label: "About", href: "/settings?section=about" },
        { label: "Version" },
      ]}>
        <p>Body</p>
      </SettingsFeatureCell>,
    );
    expect(html).toContain('data-slot="settings-feature-cell"');
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain("Account");
    expect(html).toContain('href="/settings?section=about"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Version");
    expect(html).toContain("<p>Body</p>");
  });
});
