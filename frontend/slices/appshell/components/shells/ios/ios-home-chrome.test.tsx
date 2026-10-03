import { renderToStaticMarkup } from "react-dom/server";
import { FolderOpen } from "lucide-react";
import { describe, expect, it } from "vitest";
import type { AppDescriptor } from "../../../lib/types";
import { IosHomeChrome } from "./ios-home-chrome";
import { IosQuickActions } from "./ios-quick-actions";

function app(id: string, title: string): AppDescriptor {
  return {
    id,
    title,
    icon: FolderOpen,
    gradient: "linear-gradient(#333,#111)",
    load: async () => ({ default: () => null }),
  } as AppDescriptor;
}

describe("iOS 27 home chrome", () => {
  it("keeps Search in its own pill and the dock as icons without labels", () => {
    const html = renderToStaticMarkup(
      <IosHomeChrome dockApps={[app("files", "Files"), app("terminal", "Terminal")]} onLaunch={() => {}} onSearch={() => {}} />,
    );
    expect(html).toContain('data-slot="ios-search-pill"');
    expect(html).toContain(">Search<");
    expect(html).toContain('data-slot="ios-dock"');
    expect(html).toContain('aria-label="Files"');
    expect(html).not.toContain(">Files<");
    expect(html).not.toContain(">Terminal<");
    expect(html).not.toContain("ios-tab-label");
  });

  it("opens a floating quick-actions menu with the home-screen rows", () => {
    const html = renderToStaticMarkup(
      <IosQuickActions
        app={app("files", "Files")}
        point={{ x: 40, y: 80 }}
        onOpen={() => {}}
        onRemove={() => {}}
        onLock={() => {}}
        onEditHome={() => {}}
        onSearch={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('data-slot="ios-quick-actions"');
    expect(html).toContain("Remove App");
    expect(html).toContain("text-destructive");
    expect(html).toContain("Require Face ID");
    expect(html).toContain("Edit Home Screen");
    expect(html).not.toContain("justify-end");
  });
});
