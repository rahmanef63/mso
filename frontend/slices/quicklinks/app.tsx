"use client";

import { Globe, Link2 } from "lucide-react";
import { AppFrame } from "@/features/os-shell";
import { useQuicklinks, faviconUrl, openQuicklink } from "@/lib/quicklinks";

// Dedicated Quicklinks window: a grid of favicon tiles, click opens a new tab.
// Data is the shared quicklinks store (managed in Settings → Quicklink).
export default function QuicklinksApp() {
  const { items } = useQuicklinks();

  if (items.length === 0) {
    return (
      <AppFrame>
        <div className="grid h-full place-items-center p-6 text-center">
          <div className="space-y-2 text-muted-foreground">
            <Link2 className="mx-auto size-8" />
            <p className="text-sm font-medium text-foreground">No quicklinks yet</p>
            <p className="text-xs">Add website shortcuts in Settings → Quicklink.</p>
          </div>
        </div>
      </AppFrame>
    );
  }

  return (
    <AppFrame>
      <div className="grid grid-cols-3 gap-3 p-4 @sm:grid-cols-4 @md:grid-cols-5 @md:gap-4 @md:p-5">
        {items.map((ql) => {
          const src = faviconUrl(ql.url);
          return (
            <button
              key={ql.id}
              type="button"
              onClick={() => openQuicklink(ql)}
              className="group flex flex-col items-center gap-2"
            >
              <span className="grid size-16 place-items-center overflow-hidden rounded-2xl bg-white text-zinc-500 shadow-md ring-1 ring-black/10 transition-transform group-hover:scale-105">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" width={36} height={36} loading="lazy" decoding="async" className="size-9 object-contain" />
                ) : (
                  <Globe className="size-8" />
                )}
              </span>
              <span className="max-w-full truncate text-xs font-medium">{ql.title}</span>
            </button>
          );
        })}
      </div>
    </AppFrame>
  );
}
