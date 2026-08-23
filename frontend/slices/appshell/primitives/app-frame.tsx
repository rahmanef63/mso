"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useShellDesign } from "../design/use-shell-design";

// Standard app scaffold: optional header/toolbar row + a scrolling body that
// honours safe-area insets. The whole frame is a CSS `@container` so children
// can reflow off the PANE width (works the same in a 380px window and a
// fullscreen phone) — pair with @sm/@md/@lg variants or useContainer().
export function AppFrame({
  header,
  toolbar,
  footer,
  children,
  className,
  bodyClassName,
  safeArea = true,
}: {
  header?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Pad the body for notch/home-bar (mobile fullscreen). Default on. */
  safeArea?: boolean;
}) {
  const design = useShellDesign();
  return (
    <div data-slot="app-frame" data-shell-family={design.family} data-shell-density={design.density} className={cn("@container flex h-full min-h-0 flex-col", className)}>
      {header && (
        <div data-slot="app-frame-header" className="flex-none border-b border-border">{header}</div>
      )}
      {toolbar && (
        <div data-slot="app-frame-toolbar" className="flex-none border-b border-border">{toolbar}</div>
      )}
      <div
        data-slot="app-frame-body"
        className={cn(
          "min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
          safeArea && "[padding-bottom:var(--sai-bottom)]",
          bodyClassName,
        )}
      >
        {children}
      </div>
      {footer && (
        <div data-slot="app-frame-footer" className="flex-none border-t border-border">{footer}</div>
      )}
    </div>
  );
}
