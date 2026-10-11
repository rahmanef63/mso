import { cn } from "@/lib/utils";
import type { AppDescriptor } from "../lib/types";
import { AppBadge } from "./app-badge";

// Per-shell app-icon tile. FLAT by default — iOS 7 (2013) killed the glassy
// skeuomorphic dome, so modern iOS Home/Settings tiles are solid fills; macOS
// keeps only a whisper of Big-Sur depth. Every look value is a --shell-icon-*
// token (globals.css, per data-shell), and `.shell-icon-tile` upgrades the
// corner to a true superellipse squircle where corner-shape is supported (else
// the tuned rounded-rect). Glyph is flat white, no emboss.
export function AppIcon({
  app,
  className,
}: {
  app: Pick<AppDescriptor, "id" | "icon" | "iconFill" | "gradient">;
  className?: string;
}) {
  const Icon = app.icon;
  // A real brand mark owns its own shape and colour, so it fills the tile: no
  // gradient, no sheen, no hairline — those exist to give a monochrome line glyph
  // a body, and layering them over a logo reads as a sticker.
  if (app.iconFill) {
    return (
      <span
        className={cn(
          "relative grid size-full place-items-center",
          className,
        )}
        style={{ background: "transparent", boxShadow: "none" }}
      >
        <Icon className="size-full object-contain" />
        <AppBadge appId={app.id} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "shell-icon-tile relative grid size-full place-items-center overflow-hidden text-white",
        className,
      )}
      style={{ background: app.gradient, boxShadow: "var(--shell-icon-shadow)" }}
    >
      {/* top-light → optional bottom-shade; token alphas keep iOS flat, macOS softly dimensional */}
      <span
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,var(--shell-icon-sheen)) 0%, rgba(255,255,255,0) 45%, rgba(0,0,0,var(--shell-icon-shade)) 100%)",
        }}
      />
      {/* top hairline only — Apple's edge light is top-biased, not a 4-side ring */}
      <span
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,var(--shell-icon-ring))" }}
      />
      <Icon
        className="relative z-[1]"
        style={{ width: "var(--shell-icon-glyph)", height: "var(--shell-icon-glyph)" }}
        strokeWidth={1.8}
      />
      <AppBadge appId={app.id} />
    </span>
  );
}
