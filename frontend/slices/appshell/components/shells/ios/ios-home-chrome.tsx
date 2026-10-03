"use client";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppDescriptor } from "../../../lib/types";
import { AppIcon } from "../../app-icon";

const GLASS = "glass border border-white/25 bg-[var(--glass-bar)] shadow-[0_10px_28px_rgba(0,0,0,0.22)]";

/** Home-screen chrome from the iOS 27 Home Screen frame: a search pill, then a
 *  separate icon-only dock. Labels stay on the grid, not under the dock icons. */
export function IosHomeChrome({
  dockApps,
  onLaunch,
  onSearch,
}: {
  dockApps: AppDescriptor[];
  onLaunch: (app: AppDescriptor) => void;
  onSearch: () => void;
}) {
  return (
    <div data-slot="ios-home-chrome" className="flex flex-col items-center gap-3 px-5 pb-1">
      <Button
        type="button"
        variant="ghost"
        data-slot="ios-search-pill"
        onClick={onSearch}
        className={`${GLASS} h-9 gap-1.5 rounded-full px-4 text-[15px] font-medium text-white/80 hover:bg-white/10 hover:text-white`}
      >
        <Search className="size-4" aria-hidden />
        Search
      </Button>
      {dockApps.length > 0 && (
        <div data-slot="ios-dock" className={`${GLASS} flex w-max max-w-full flex-nowrap items-center gap-3.5 rounded-[32px] px-2.5 py-2`}>
          {dockApps.map((app) => (
            <Button
              key={app.id}
              type="button"
              variant="ghost"
              size="icon"
              aria-label={app.title}
              onClick={() => onLaunch(app)}
              className="size-[54px] shrink-0 p-0 hover:bg-transparent"
            >
              <AppIcon app={app} />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
