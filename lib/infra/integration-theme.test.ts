import { describe, expect, it } from "vitest";
import { INTEGRATION_THEME_SCRIPT } from "./integration-theme";
import { integrationSetupPage } from "./setup-page";

// The standalone integrations page is raw HTML from a route handler, so it never passes through
// AppearanceProvider. Found by a browser audit: a dark-shell user on a light OS got a light page,
// because the page only followed `prefers-color-scheme`.
describe("standalone integrations page theme", () => {
  it("reads the shell's persisted theme before first paint", () => {
    // Same storage key and shape the shell writes (lib/appearance/store.tsx KEY + Appearance.theme).
    expect(INTEGRATION_THEME_SCRIPT).toContain("mso:tweaks");
    expect(INTEGRATION_THEME_SCRIPT).toContain("dataset.theme");
    expect(INTEGRATION_THEME_SCRIPT).toMatch(/light|dark/);
    // It must be defensive: a malformed value must not break the page.
    expect(INTEGRATION_THEME_SCRIPT).toContain("try");
    expect(INTEGRATION_THEME_SCRIPT).toContain("catch");
  });

  it("ships the theme script in <head>, before any body content", () => {
    const { html } = integrationSetupPage(false);
    const head = html.slice(0, html.indexOf("</head>"));
    const body = html.slice(html.indexOf("<body"));
    expect(head, "the theme must be set before paint or the page flashes light").toContain("mso:tweaks");
    expect(body, "it must not be needed after the body").not.toContain("mso:tweaks");
  });

  it("ships it in the embedded variant too", () => {
    const { html } = integrationSetupPage(true);
    expect(html).toContain("mso:tweaks");
    // The embedded rule hides the site bar; the theme still has to apply inside the iframe.
    expect(html).toContain(".site-bar{display:none}");
  });
});
