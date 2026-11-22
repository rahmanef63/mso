import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSettings = (name: string) => readFileSync(`frontend/svelte/src/lib/settings/${name}`, "utf8");

describe("software update visibility contract (Svelte 5 Settings)", () => {
  it("exposes Software update as a top-level Settings tab", () => {
    const app = readSettings("SettingsApp.svelte");
    expect(app).toContain('type SettingsTab = "prefs" | "account" | "updates" | "audit"');
    expect(app).toContain('tab === "updates"');
    expect(app).toContain("SoftwareUpdateCard");
  });

  it("handles owner authorization and failure states visibly", () => {
    const card = readSettings("SoftwareUpdateCard.svelte");
    const api = readSettings("host-ops-api.ts");
    expect(card).toContain("Software update");
    expect(card).toContain("Owner role is required to inspect software updates");
    expect(api).toContain("status === 403");
    expect(api).toContain("/api/v1/sys/update");
  });

  it("distinguishes remote check status and unsupported deployments", () => {
    const card = readSettings("SoftwareUpdateCard.svelte");
    expect(card).toContain("info.remoteChecked");
    expect(card).toContain("!info.supported");
    expect(card).toContain("update-available");
  });
});
