import { renderToStaticMarkup } from "react-dom/server";
import { FolderOpen } from "lucide-react";
import { describe, expect, it } from "vitest";
import type { AppDescriptor } from "../../../lib/types";
import { IosHomeChrome } from "./ios-home-chrome";
import { IosQuickActions } from "./ios-quick-actions";
import { IOS_WIDGET_HOMES, IosWidgetHome } from "./ios-widget-home";

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

  it("gives each widget size its own home with one placeholder and icons around it", () => {
    const cells = { small: 4, medium: 8, large: 16, "extra-large": 20 };
    for (const widget of IOS_WIDGET_HOMES) {
      expect(widget.slots + cells[widget.size]).toBe(24);
      const html = renderToStaticMarkup(
        <IosWidgetHome
          apps={[app("files", "Files"), app("terminal", "Terminal")]}
          size={widget.size}
          title={widget.title}
          span={widget.span}
          slots={widget.slots}
          onLaunch={() => {}}
          onContext={() => {}}
        />,
      );
      expect(html.match(/data-slot="ios-widget-placeholder"/g)).toHaveLength(1);
      expect(html).toContain(`data-size="${widget.size}"`);
      expect(html).toContain(widget.span);
      expect(html).toContain('aria-label="Files"');
    }
  });
});
