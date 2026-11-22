"use client";

import { createElement } from "react";
import { Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { glyphIcon } from "../lib/glyph";
import type { CatalogApp } from "../lib/store-catalog";
import { StoreGlyph } from "./store-tile";

// Editor's-choice hero card. Highlights one catalog app with its glossy icon,
// a tagline and a primary Get / Installed toggle wired to the same handler as
// the grid cards. Shares the glyph tile with the rows; it keeps its own hero
// chrome (bigger type, no badge row) because a hero is a different layout, not
// a row variant.
export function FeaturedCard({
  app,
  onToggle,
}: {
  app: CatalogApp;
  onToggle: (app: CatalogApp) => void;
}) {
  return (
    <div
      className="relative mb-4 overflow-hidden rounded-2xl p-6 text-white"
      style={{ background: app.gradient }}
    >
      <span className="pointer-events-none absolute -right-6 -top-6 size-40 rounded-full bg-white/10" />
      <div className="relative flex items-start gap-4">
        <StoreGlyph
          overlay="none"
          className="size-14 rounded-2xl bg-white/15 shadow-sm"
        >
          {/* createElement: dynamic stateless lookup, not a render-created component */}
          {createElement(glyphIcon(app.glyph), { className: "size-7" })}
        </StoreGlyph>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] opacity-80">
            Editor&rsquo;s Choice
          </div>
          <h3 className="mt-1 text-xl font-extrabold leading-tight tracking-tight">
            {app.title}
          </h3>
          <p className="mt-1 max-w-md text-sm opacity-90">{app.desc}</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onToggle(app)}
            className="mt-3 text-foreground"
          >
            {app.installed ? (
              <>
                <Check /> Installed
              </>
            ) : (
              <>
                <Download /> Get
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
