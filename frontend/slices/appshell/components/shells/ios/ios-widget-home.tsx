"use client";

import { Button } from "@/components/ui/button";
import type { AppDescriptor } from "../../../lib/types";
import { AppIcon } from "../../app-icon";

/** One home screen per kit size. The purple widget occupies a block of the
 *  4×6 icon grid; the shell's own apps fill the cells around it. */
export const IOS_WIDGET_HOMES = [
  { size: "small", title: "CPU", span: "col-span-2 row-span-2", slots: 20 },
  { size: "medium", title: "Memory", span: "col-span-4 row-span-2", slots: 16 },
  { size: "large", title: "Storage", span: "col-span-4 row-span-4", slots: 8 },
  { size: "extra-large", title: "Clock", span: "col-span-4 row-span-5", slots: 4 },
] as const;

export type IosWidgetSize = (typeof IOS_WIDGET_HOMES)[number]["size"];

export function IosWidgetHome({
  apps,
  size,
  title,
  span,
  slots,
  onLaunch,
  onContext,
}: {
  apps: AppDescriptor[];
  size: IosWidgetSize;
  title: string;
  span: string;
  slots: number;
  onLaunch: (app: AppDescriptor) => void;
  onContext: (app: AppDescriptor, point: { x: number; y: number }) => void;
}) {
  return (
    <div className="grid h-full grid-cols-4 grid-rows-6 gap-x-[26px] overflow-hidden px-6 pb-6 pt-[18px]">
      <div
        data-slot="ios-widget-placeholder"
        data-size={size}
        className={`flex min-h-0 items-end rounded-[22px] p-4 text-[17px] font-semibold leading-[22px] tracking-[-0.43px] text-white ${span}`}
      >
        {title}
      </div>
      {apps.slice(0, slots).map((app) => (
        <Button
          key={app.id}
          type="button"
          variant="ghost"
          aria-label={app.title}
          onClick={() => onLaunch(app)}
          onContextMenu={(e) => { e.preventDefault(); onContext(app, { x: e.clientX, y: e.clientY }); }}
          className="h-auto min-h-0 p-0 hover:bg-transparent flex flex-col items-center gap-1"
        >
          <span className="aspect-square min-h-0 max-h-[60px] flex-1">
            <AppIcon app={app} />
          </span>
          <span className="max-w-full shrink-0 truncate text-[12px] font-normal leading-4 text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">
            {app.title}
          </span>
        </Button>
      ))}
    </div>
  );
}
