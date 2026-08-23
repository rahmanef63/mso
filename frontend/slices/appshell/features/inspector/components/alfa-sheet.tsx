"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "../../../responsive/use-is-mobile";
import { useFocusedApp, useInspectorOpen } from "../../../hooks/use-shell";
import { setInspectorOpen } from "../../../lib/store";
import { useInspectorInfo } from "../../../lib/inspector";
import { useApp } from "../../../lib/registry";
import { AlfaThread } from "../../../components/alfa-thread";

// Alfa on a phone. The right dock is desktop-only (rightPanel is rendered by the
// macOS and Windows shells and by nothing else), so on mobile Alfa simply did not
// exist — including in the Browser, which is where a phone user spends most time.
//
// Same feature, same open-state (setInspectorOpen / ⌘I), same shared thread as the
// dock and the Assistant app. Only the frame differs: a bottom sheet instead of a
// side panel. Mounted in the `overlay` slot, which every shell renders.
//
// Cheap by construction: returns null on desktop and null while closed, so the
// thread subscribes to nothing and costs nothing until it is actually opened.
export function AlfaSheet() {
  const isMobile = useIsMobile();
  const open = useInspectorOpen();
  const appId = useFocusedApp();
  const app = useApp(appId ?? "");
  const info = useInspectorInfo(appId);

  if (!isMobile || !open) return null;
  const subject = app?.title ?? appId ?? "MSO";

  return (
    <div className="absolute inset-0 z-[60] flex flex-col justify-end" role="dialog" aria-label={`Alfa — ${subject}`}>
      {/* Tap-away closes; the sheet itself stops propagation by sitting above it. */}
      <button
        type="button"
        aria-label="Dismiss Alfa"
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={() => setInspectorOpen(false)}
      />
      <div className="relative flex h-[72%] flex-col rounded-t-2xl border-t border-border bg-card shadow-2xl">
        {/* relative + z-10 so the header always sits above the thread's ScrollArea
            viewport, which is later in the DOM and fills the sheet. */}
        <header className="relative z-10 flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
          {/* Grab handle — purely affordance, the sheet is not drag-dismissable. */}
          <span aria-hidden className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-border" />
          <div className="min-w-0 flex-1 pt-1">
            <p className="truncate text-xs font-semibold">Alfa</p>
            <p className="truncate text-[10px] text-muted-foreground">in {subject}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close Alfa"
            className="size-11 shrink-0"
            onClick={() => setInspectorOpen(false)}
          >
            <X className="size-4" />
          </Button>
        </header>
        {info?.actions?.length ? (
          <div data-slot="mobile-ai-actions" className="shrink-0 border-b border-border bg-card px-3 py-2">
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Quick actions</p>
            <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {info.actions.map((action) => (
                <Button
                  key={action.id}
                  type="button"
                  variant="secondary"
                  className="min-h-11 shrink-0 rounded-full px-4 text-sm"
                  onClick={() => {
                    setInspectorOpen(false);
                    void action.run();
                  }}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <AlfaThread
            ctx={{
              appId: appId ?? undefined,
              subject,
              context:
                (info?.context ?? "") +
                (info?.props?.length
                  ? ` Current state: ${info.props.map((p) => `${p.label}=${p.value}`).join(", ")}.`
                  : ""),
            }}
            placeholder={`Ask about ${subject}…`}
          />
        </div>
      </div>
    </div>
  );
}
