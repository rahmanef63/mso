"use client";

import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToasts, dismissToast, type ToastTone } from "../../../lib/toast";

// Top-right glass toast stack. Mounted by DesktopChrome + MobileShell.
// Mirrors the mock-os toast cluster: glass cards, fade/slide in, stacking.

const toneIcon: Record<ToastTone, typeof CheckCircle2 | null> = {
  default: null,
  success: CheckCircle2,
  error: AlertCircle,
};

const toneColor: Record<ToastTone, string> = {
  default: "text-foreground",
  success: "text-success",
  error: "text-destructive",
};

export function ToastHost() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;

  return (
    // The stack itself is the live region so SR clients hear toasts that mount
    // after page load. Each toast also gets a role so the announcement uses the
    // right politeness (errors interrupt; everything else queues politely).
    <div
      role="region"
      aria-label="Notifications"
      // `top` must clear the notch: every other top-anchored overlay (dynamic
      // island, switcher, home, spotlight) offsets by --sai-top, which iOS floors
      // at 44px. This was a hardcoded 36px, so on a notched phone the stack
      // started inside the reserved band.
      style={{ top: "max(2.25rem, calc(var(--sai-top) + 0.5rem))" }}
      className="pointer-events-none absolute right-3.5 z-[1000] flex flex-col items-end gap-2"
    >
      {toasts.map((t) => {
        const Icon = toneIcon[t.tone];
        const isError = t.tone === "error";
        return (
          <div
            key={t.id}
            role={isError ? "alert" : "status"}
            aria-live={isError ? "assertive" : "polite"}
            aria-atomic="true"
            className="glass animate-in fade-in slide-in-from-top-2 pointer-events-auto flex max-w-[300px] items-center gap-2.5 rounded-[11px] border border-border px-3.5 py-2.5 text-[12.5px] font-medium shadow-xl duration-200"
            style={{ background: "var(--glass-menu)" }}
          >
            {Icon && <Icon className={cn("size-4 shrink-0", toneColor[t.tone])} />}
            <span className="flex-1 leading-snug">{t.message}</span>
            {t.action && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  t.action?.onClick();
                  dismissToast(t.id);
                }}
                className="h-auto shrink-0 rounded-md bg-primary px-2 py-1 text-[11.5px] font-semibold text-primary-foreground hover:bg-primary hover:opacity-90"
              >
                {t.action.label}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Dismiss"
              onClick={() => dismissToast(t.id)}
              className="h-auto w-auto grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-[var(--hover-strong)]"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
