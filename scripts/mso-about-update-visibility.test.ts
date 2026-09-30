import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (name: string) => readFileSync(`frontend/slices/os-settings/components/${name}.tsx`, "utf8");
describe("software update visibility contract", () => {
  it("promotes software update to the final top-level Settings section", () => {
    const sections = readFileSync("frontend/slices/os-settings/lib/sections.ts", "utf8");
    const body = read("sections");
    expect(sections).toContain('label: "Update MSO"');
    expect(sections).toMatch(/"backup",\s*"updates",\s*\];/);
    expect(body).toContain('case "updates"');
    expect(body).toContain("return <UpdateSection />");
    expect(read("about-overview")).not.toContain('label="Check software updates"');
    expect(read("version-section")).not.toContain('label="Check software updates"');
    expect(read("about-section")).toContain('page === "updates"');
    expect(read("update-nav-badge")).toContain('aria-label="New MSO version available"');
    expect(read("nav")).toContain('data-slot="settings-update-footer"');
  });
  it("does not disappear on authentication/network failure", () => {
    const source = read("update-section");
    expect(source).not.toContain('IS_DEMO || (!info && !checking)');
    expect(read("update-status-card")).toContain('role="alert"');
    expect(read("update-status-card")).toContain('>Try again</Button>');
    expect(readFileSync("frontend/slices/os-settings/components/update-status-client.ts", "utf8")).toContain('res.status === 401 || res.status === 403');
  });
  it("keeps version checks available even without a restart manager", () => {
    expect(read("update-section")).toContain('{!running && (');
    expect(read("update-section")).not.toContain('{info.supported !== false && !running && (');
  });
  it("distinguishes running/checkout/upstream identity and unknown freshness", () => {
    const source = read("update-status-card");
    expect(source).toContain('!info.remoteChecked || error');
    expect(source).toContain('Update status not verified');
    expect(source).toContain('Checkout {info.current');
    expect(source).toContain('info.latest || "not checked"');
  });
});
