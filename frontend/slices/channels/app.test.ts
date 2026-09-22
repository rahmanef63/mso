import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { channelsApp } from "./index";

describe("Channels shell feature", () => {
  it("is a first-class dockable app registered in the shell and App Store", () => {
    expect(channelsApp.id).toBe("channels");
    expect(channelsApp.noDock).not.toBe(true);
    expect(readFileSync("frontend/slices/os-shell/shell.manifest.ts", "utf8")).toContain('pin(withSlug(channelsApp, "channels"))');
    expect(readFileSync("frontend/slices/app-store/lib/system-catalog.ts", "utf8")).toContain('id: "channels", title: "Channels", kind: "app"');
  });

  it("keeps bot secrets in Integrations and exposes test/send/workflow controls", () => {
    const app = readFileSync("frontend/slices/channels/app.tsx", "utf8");
    const editor = readFileSync("frontend/slices/channels/components/channel-editor.tsx", "utf8");
    const card = readFileSync("frontend/slices/channels/components/channel-card.tsx", "utf8");
    expect(app).toContain('data-slot="channels-feature"');
    expect(editor).toContain('openWindow("integrations", "Integrations")');
    expect(editor).not.toContain("botToken");
    expect(card).toContain('action: "test"');
    expect(card).toContain('action: "send"');
    expect(editor).toContain("Inbound workflow");
  });
});
