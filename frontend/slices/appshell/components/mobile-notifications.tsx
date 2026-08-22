"use client";
/* iOS Notification Center — the pull-down sheet (swipe down on the LEFT half of
   the status area; the right half keeps Control Center, like iPhone). Reads the
   same persistent notification log as the macOS Notification Center (lib/toast).
   Absolute (not fixed) so it stays inside the phone frame on desktop previews.
   Opening marks everything read. */
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { BellOff, X } from "lucide-react";
import {
  useNotifications,
  dismissNotification,
  clearNotifications,
  markNotificationsRead,
} from "../lib/toast";

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

export function MobileNotifications({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items = useNotifications();

  useEffect(() => {
    if (open) markNotificationsRead();
  }, [open]);

  if (!open) return null;

  return (
    <div className="glass absolute inset-0 z-[40] flex flex-col [animation:mobileAppOpen_var(--shell-dur)_var(--shell-ease)]" style={{ background: "var(--glass-nc)" }}>
      <header className="flex items-center px-5 pb-2 pt-10 text-white">
        <h2 className="text-[22px] font-bold">Notifications</h2>
        {items.length > 0 && (
          <Button type="button" variant="ghost" onClick={clearNotifications} className="h-auto p-0 font-normal hover:bg-transparent ml-auto rounded-full bg-white/15 px-3 py-1 text-xs font-medium [@media(pointer:coarse)]:min-h-[44px]">
            Clear All
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-4">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-white/60">
            <BellOff className="size-7" />
            <span className="text-sm">No notifications</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((n) => (
              <div key={n.id} className="flex items-start gap-2.5 rounded-2xl bg-white/12 p-3 text-white">
                <span className={cn(`mt-1 size-2 shrink-0 rounded-full ${TONE_DOT[n.tone] ?? "bg-white/50"}`)} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[13px] font-medium">{n.message}</div>
                  <div className="mt-0.5 text-[11px] text-white/60">{rel(n.ts)}</div>
                  {n.action && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        n.action?.onClick();
                        dismissNotification(n.id);
                      }}
                      className="mt-1.5 h-auto rounded-lg bg-white/20 px-2.5 py-1 text-xs font-medium hover:bg-white/30 [@media(pointer:coarse)]:min-h-[44px]"
                    >
                      {n.action.label}
                    </Button>
                  )}
                </div>
                <Button type="button" variant="ghost"
                  aria-label="Dismiss"
                  onClick={() => dismissNotification(n.id)}
                  className="grid size-11 shrink-0 place-items-center rounded-full p-0 font-normal text-white/80 hover:bg-transparent [@media(pointer:coarse)]:size-[44px]"
                >
                  {/* 44pt tap target (HIG §13); the visible dot stays small */}
                  <span className="grid size-7 place-items-center rounded-full bg-white/15">
                    <X className="size-3.5" />
                  </span>
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* swipe-up affordance — tap closes (parity with the home indicator) */}
      <Button type="button" variant="ghost" aria-label="Close notifications" onClick={onClose} className="h-auto p-0 font-normal hover:bg-transparent flex justify-center pb-2 pt-1">
        <span className="h-[5px] w-[134px] rounded-full bg-white/75" />
      </Button>
    </div>
  );
}
