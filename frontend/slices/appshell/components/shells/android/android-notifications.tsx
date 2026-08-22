"use client";
/* Android (Material) notification shade — pull DOWN on the LEFT half of the home
   (the RIGHT half opens Control Center, mirroring the iOS split). Reads the SAME
   persistent notification log as iOS + macOS (lib/toast) — a toast from any app
   shows here too. Solid M3 surface (no glass); tap the scrim or the grabber to
   close. Opening marks everything read. */
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { BellOff, X } from "lucide-react";
import {
  useNotifications,
  dismissNotification,
  clearNotifications,
  markNotificationsRead,
} from "../../../lib/toast";

const TONE_DOT: Record<string, string> = {
  success: "bg-success",
  error: "bg-destructive",
  warning: "bg-warning",
  info: "bg-info",
};

function rel(ts: number): string {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function AndroidNotifications({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items = useNotifications();

  useEffect(() => {
    if (open) markNotificationsRead();
  }, [open]);

  if (!open) return null;

  return (
    // Scrim = opacity only → M3 EFFECTS default (k=1600, ζ=1, ~186ms), critically
    // damped so the dim can never overshoot past its target alpha and flicker.
    // It had no animation at all before; the black wash appeared in one frame.
    <div className="absolute inset-0 z-[45] flex flex-col bg-black/40 animate-in fade-in duration-[var(--m3-dur-effects)] ease-[var(--m3-effects)]" onClick={onClose}>
      {/* The shade is pulled DOWN from the top edge, but it was animating with
          the old app-open transition, which traveled UPWARD from below — the panel arrived moving
          against the gesture that summoned it. It now slides down from -100% (its
          own height, above the viewport) on the M3 SPATIAL SLOW spring (k=200,
          ζ=0.8, ~511ms): a full-width surface, so the slow tier.
          The 1.5% overshoot briefly parks the panel ~7px low, exposing a sliver of
          scrim above it. That IS the spring, and it is what makes the shade read as
          having mass. If it ever looks like a bug, the fix is to make the panel
          taller than its clip — not to flatten the curve. */}
      <div
        className="flex max-h-[85%] flex-col overflow-hidden rounded-b-[1.75rem] border-b border-border bg-card text-foreground shadow-2xl animate-in slide-in-from-top duration-[var(--m3-dur-spatial-slow)] ease-[var(--m3-spatial)]"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingTop: "var(--sai-top, 0px)" }}
      >
        <header className="flex items-center px-5 pb-2 pt-4">
          <h2 className="text-[22px] font-normal">Notifications</h2>
          {items.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              onClick={clearNotifications}
              className="ml-auto h-auto rounded-full px-3 py-1.5 text-[13px] font-medium text-primary hover:bg-primary/10 [@media(pointer:coarse)]:min-h-[44px]"
            >
              Clear all
            </Button>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-14 text-muted-foreground">
              <BellOff className="size-7" />
              <span className="text-sm">No notifications</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {/* Staggered row entry is the M3 Expressive signature the shade was
                  missing — the panel arrived and its contents were simply already
                  there. Transform-only (no fade) to keep this file's one rule: a
                  single animation never carries both a spatial and an effects
                  property. The step is capped at 5 slots, otherwise a 40-item log
                  would still be dealing rows out two seconds after the pull. The
                  delay is expressed in terms of --m3-dur-effects so that it, like
                  every duration here, collapses under prefers-reduced-motion. */}
              {items.map((n, i) => (
                <div
                  key={n.id}
                  // fill-mode-backwards is not optional with a delay: without it the
                  // row paints at its FINAL position for the length of the delay,
                  // then snaps back to the start to animate. That flash is the whole
                  // reason delayed CSS animations get called broken.
                  className="flex items-start gap-3 rounded-2xl bg-muted/60 p-3.5 animate-in slide-in-from-top-2 fill-mode-backwards duration-[var(--m3-dur-spatial)] ease-[var(--m3-spatial)]"
                  style={{ animationDelay: `calc(var(--m3-dur-effects) * ${Math.min(i, 5) * 0.25})` }}
                >
                  <span className={cn("mt-1 size-2 shrink-0 rounded-full", TONE_DOT[n.tone] ?? "bg-muted-foreground")} />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-3 text-sm">{n.message}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{rel(n.ts)}</div>
                    {n.action && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          n.action?.onClick();
                          dismissNotification(n.id);
                        }}
                        className="mt-2 h-auto rounded-full px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10 [@media(pointer:coarse)]:min-h-[44px]"
                      >
                        {n.action.label}
                      </Button>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="Dismiss"
                    onClick={() => dismissNotification(n.id)}
                    className="grid size-11 shrink-0 place-items-center rounded-full p-0 text-muted-foreground hover:bg-muted [@media(pointer:coarse)]:size-[44px]"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          aria-label="Close notifications"
          onClick={onClose}
          className="flex h-auto justify-center py-2.5 hover:bg-transparent"
        >
          <span className="h-1 w-24 rounded-full bg-foreground/25" />
        </Button>
      </div>
    </div>
  );
}
