"use client";

import { useMemo, useState } from "react";
import { useResponsive } from "../../../responsive/use-responsive";
import type { AppDescriptor } from "../../../lib/types";
import { isIpadTabBar } from "./tab-bar-metrics";
import { IosTabBar, useTabMinimized, type IosTab } from "./ios-tab-bar";
import { IpadTabBar } from "./ipad-tab-bar";

export function useIosDockTabs(dockApps: AppDescriptor[], launch: (app: AppDescriptor) => void, activeId: string | null) {
  const tabs = useMemo(() => dockApps.map((app) => ({ app, onSelect: () => launch(app) })), [dockApps, launch]);
  const selectedId = activeId && dockApps.some((app) => app.id === activeId) ? activeId : null;
  return { tabs, selectedId };
}

export function useLibraryPager(showApp: boolean, goHome: () => void) {
  const [library, setLibrary] = useState<{ n: number; target: "library" | "grid" }>({ n: 0, target: "grid" });
  const openSidebar = () => {
    const target = library.target === "library" ? "grid" : "library";
    if (showApp) goHome();
    setLibrary({ n: library.n + 1, target });
  };
  return { library, openSidebar };
}

export function useIosShellVariant(): "iphone" | "ipad" {
  const r = useResponsive();
  return isIpadTabBar(r.device, r.vw, r.isMobile) ? "ipad" : "iphone";
}

/** One tab bar for the iOS shell. The positioning frame is transparent; only
 *  the capsule paints. iPhone sits above the home indicator. iPad sits under
 *  the status area, centered, at its content width. */
export function IosShellTabs({
  variant,
  tabs,
  selectedId,
  scrolled,
  onSearch,
  onSidebar,
}: {
  variant: "iphone" | "ipad";
  tabs: IosTab[];
  selectedId: string | null;
  scrolled: boolean;
  onSearch: () => void;
  onSidebar: () => void;
}) {
  const phone = useTabMinimized(scrolled);
  if (variant === "ipad") {
    return (
      <div data-slot="ipad-tab-bar-host" className="pointer-events-none absolute inset-x-0 z-[30] flex justify-center px-5" style={{ top: "calc(var(--sai-top) + 8px)" }}>
        <IpadTabBar tabs={tabs} selectedId={selectedId} onSearch={onSearch} onSidebar={onSidebar} />
      </div>
    );
  }
  return (
    <div data-slot="ios-tab-bar-host" className="pointer-events-none absolute inset-x-0 z-[30]" style={{ bottom: "calc(36px + var(--sai-bottom))" }}>
      <IosTabBar tabs={tabs} selectedId={selectedId} minimized={phone.minimized} onExpand={phone.expand} />
    </div>
  );
}
