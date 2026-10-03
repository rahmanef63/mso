import { renderToStaticMarkup } from "react-dom/server";
import { FolderOpen } from "lucide-react";
import { describe, expect, it } from "vitest";
import type { AppDescriptor } from "../../../lib/types";
import { IosTabBar, type IosTab } from "./ios-tab-bar";
import { IpadTabBar } from "./ipad-tab-bar";
import { IOS_TAB, IPAD_TAB, isIpadTabBar, splitTabBar, type TabRole } from "./tab-bar-metrics";

function tab(id: string, title: string, role?: TabRole): IosTab {
  const app = {
    id,
    title,
    icon: FolderOpen,
    gradient: "linear-gradient(#333,#111)",
    load: async () => ({ default: () => null }),
  } as AppDescriptor;
  return { app, role, onSelect: () => {} };
}

describe("iOS 27 tab bar geometry", () => {
  it("keeps the kit sizes that fit this shell", () => {
    expect(IOS_TAB.expanded).toBe(54);
    expect(IOS_TAB.minimized).toBe(40);
    expect(IOS_TAB.symbol).toBe(28);
    expect(IOS_TAB.label).toBe(10);
    expect(IOS_TAB.overlap).toBe(-8);
    expect(IOS_TAB.sideInset).toBe(25);
    expect(IOS_TAB.minimizedInset).toBe(32);
    expect(IOS_TAB.splitGap).toBe(16);
    expect(IOS_TAB.trailing).toBe(54);
    expect(IOS_TAB.selectedRadius).toBe(100);
    expect(IPAD_TAB.height).toBe(44);
    expect(IPAD_TAB.pad).toBe(4);
    expect(IPAD_TAB.row).toBe(36);
    expect(IPAD_TAB.accessoryWidth).toBe(54);
    expect(IPAD_TAB.tabMin).toBe(74);
  });

  it("puts a trailing capsule only on search-role and prominent tabs", () => {
    expect(splitTabBar([tab("a", "A"), tab("b", "B")]).trailing).toBeNull();
    const search = splitTabBar([tab("a", "A"), tab("s", "Search", "search"), tab("b", "B")]);
    expect(search.trailing?.app.id).toBe("s");
    expect(search.main.map((item) => item.app.id)).toEqual(["a", "b"]);
    const prominent = splitTabBar([tab("p", "Pinned", "prominent"), tab("a", "A")]);
    expect(prominent.trailing?.role).toBe("prominent");
    expect(prominent.main).toHaveLength(1);
  });

  it("uses the iPad bar for a portrait tablet and the iPhone bar for a phone preview", () => {
    expect(isIpadTabBar("auto", 834, true)).toBe(true);
    expect(isIpadTabBar("phone", 1440, true)).toBe(false);
    expect(isIpadTabBar("auto", 390, true)).toBe(false);
    expect(isIpadTabBar("auto", 834, false)).toBe(false);
  });
});

describe("iPhone tab bar", () => {
  const tabs = [tab("files", "Files"), tab("browser", "Browser")];

  it("renders one floating capsule, not a full-width bar", () => {
    const html = renderToStaticMarkup(<IosTabBar tabs={tabs} selectedId="files" minimized={false} onExpand={() => {}} />);
    expect(html).toContain('data-split="false"');
    expect(html).toContain('data-minimized="false"');
    expect(html).toContain("h-[54px] w-max");
    expect(html).toContain("px-[25px]");
    expect(html).not.toContain("ios-tab-trailing");
    expect(html).toContain('data-slot="ios-tab-label"');
    expect(html).toContain("Files");
  });

  it("splits a search-role tab into a trailing capsule", () => {
    const html = renderToStaticMarkup(
      <IosTabBar tabs={[...tabs, tab("find", "Find", "search")]} selectedId="files" minimized={false} onExpand={() => {}} />,
    );
    expect(html).toContain('data-split="true"');
    expect(html).toContain('data-slot="ios-tab-trailing"');
    expect(html).toContain('data-role="search"');
    expect(html).toContain("size-[54px]");
    expect(html).toContain("gap-4");
    expect(html).not.toContain('aria-label="Find" role="tab"');
  });

  it("minimizes to one capsule without labels, and to two capsules when split", () => {
    const plain = renderToStaticMarkup(<IosTabBar tabs={tabs} selectedId={null} minimized onExpand={() => {}} />);
    expect(plain).toContain('data-minimized="true"');
    expect(plain).toContain("px-8");
    expect(plain.match(/data-slot="ios-tab-minimized"/g)).toHaveLength(1);
    expect(plain).not.toContain('data-slot="ios-tab-label"');
    const split = renderToStaticMarkup(
      <IosTabBar tabs={[tab("files", "Files"), tab("find", "Find", "prominent")]} selectedId={null} minimized onExpand={() => {}} />,
    );
    expect(split).toContain("justify-between");
    expect(split.match(/data-slot="ios-tab-minimized"/g)).toHaveLength(2);
  });
});

describe("iPad tab bar", () => {
  it("is a short horizontal capsule with sidebar, tabs and search", () => {
    const html = renderToStaticMarkup(
      <IpadTabBar tabs={[tab("files", "Files"), tab("browser", "Browser")]} selectedId="files" onSearch={() => {}} onSidebar={() => {}} />,
    );
    expect(html).toContain('data-slot="ipad-tab-bar"');
    expect(html).toContain("inline-flex h-11 w-max");
    expect(html).toContain("flex-row");
    expect(html).not.toContain("flex-col");
    expect(html).toContain('data-slot="ipad-tab-sidebar"');
    expect(html).toContain('data-slot="ipad-tab-search"');
    expect(html).toContain("min-w-[74px]");
    expect(html).toContain("font-bold");
    expect(html).toContain("font-medium");
  });
});
