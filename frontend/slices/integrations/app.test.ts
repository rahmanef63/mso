import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { managerLocation } from "./app";
import { integrationsApp } from "./index";

describe("native Integrations shell app", () => {
  it("has a dockable descriptor and a matching app catalog entry", () => {
    expect(integrationsApp.id).toBe("integrations");
    expect(integrationsApp.noDock).not.toBe(true);
    expect(readFileSync("frontend/slices/app-store/lib/system-catalog.ts", "utf8")).toContain('id: "integrations", title: "Integrations", kind: "app"');
    const manifest = readFileSync("frontend/slices/os-shell/shell.manifest.ts", "utf8");
    expect(manifest).toContain('pin(withSlug(integrationsApp, "connections"))');
  });
  it("keeps transfer and private fragment handoffs inside the existing manager", () => {
    expect(managerLocation("?transfer=1&untrusted=ignore", "#example-capability")).toBe("/integrations/manager?transfer=1#example-capability");
    expect(managerLocation("?target=https://untrusted.invalid")).toBe("/integrations/manager");
  });
});
