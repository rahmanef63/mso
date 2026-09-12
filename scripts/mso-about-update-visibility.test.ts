import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (name: string) => readFileSync(`frontend/slices/os-settings/components/${name}.tsx`, "utf8");
describe("About update visibility contract", () => {
  it("offers a software update action from Overview", () => {
    expect(read("about-section")).toContain('label="Check software updates"');
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
