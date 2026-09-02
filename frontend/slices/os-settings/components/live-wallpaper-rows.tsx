"use client";
/* Live-wallpaper picker rows (Settings → Wallpaper). Two sources:
   — "From code": TSX wallpapers registered via registerWallpaper() (os-shell
     ships Drift + Starfield; any project can add its own).
   — "Custom HTML": paste a page; it renders behind the desktop in a SANDBOXED
     iframe (allow-scripts only — no cookies, no parent DOM, no authed /api).
   "Receives clicks" makes the empty desktop click-through so the wallpaper
   works as an interactive site; windows/dock/menus stay on top and clickable. */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LIVE_WALLPAPER_HTML_MAX, useAppearance, type LiveWallpaper } from "@/lib/appearance";
import { FormDrawer, useWallpapers } from "@/features/appshell";
import { SettingsRow as Row } from "@/features/shell-settings";

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      className={cn("h-8 rounded-full px-3 text-xs", !active && "bg-card/60")}
    >
      {label}
    </Button>
  );
}

export function LiveWallpaperRows() {
  const { tweaks, setTweaks } = useAppearance();
  const lw = tweaks.liveWallpaper;
  const registered = useWallpapers();
  const [draft, setDraft] = useState(lw?.kind === "html" ? lw.html : "");
  const [editing, setEditing] = useState(false);
  const set = (v: LiveWallpaper | null) => setTweaks({ liveWallpaper: v });
  const tooBig = draft.length > LIVE_WALLPAPER_HTML_MAX;

  return (
    <>
      <Row label="Live wallpaper">
        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:justify-end">
          <Chip active={!lw} label="Off" onClick={() => { set(null); setEditing(false); }} />
          {registered.map((d) => (
            <Chip
              key={d.id}
              active={lw?.kind === "component" && lw.id === d.id}
              label={d.label}
              onClick={() => { set({ kind: "component", id: d.id, interactive: d.interactive }); setEditing(false); }}
            />
          ))}
          <Chip active={lw?.kind === "html" || editing} label="Custom HTML" onClick={() => setEditing(true)} />
        </div>
      </Row>

      <FormDrawer open={editing} onOpenChange={setEditing} size="lg">
        <FormDrawer.Header>
          <FormDrawer.Title>Custom HTML wallpaper</FormDrawer.Title>
          <FormDrawer.Description>
            Paste a full HTML page. Scripts run in a sandboxed frame with no cookies or OS access.
          </FormDrawer.Description>
        </FormDrawer.Header>
        <FormDrawer.Body className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            placeholder={"<!doctype html>\n<style>body{margin:0;background:#0b0e1a}</style>\n<canvas id=c></canvas>\n<script>…</script>"}
            className="min-h-52 font-mono text-xs"
          />
          <div className={cn("text-right text-[11px]", tooBig ? "text-destructive" : "text-muted-foreground")}>
            {Math.ceil(draft.length / 1024)} / {LIVE_WALLPAPER_HTML_MAX / 1024} KB
          </div>
        </FormDrawer.Body>
        <FormDrawer.Footer>
          {lw?.kind === "html" && (
            <Button type="button" variant="ghost" className="text-destructive" onClick={() => { set(null); setEditing(false); }}>
              Remove
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          <Button
            type="button"
            disabled={!draft.trim() || tooBig}
            onClick={() => { set({ kind: "html", html: draft, interactive: lw?.interactive ?? true }); setEditing(false); }}
          >
            Apply
          </Button>
        </FormDrawer.Footer>
      </FormDrawer>

      {lw && (
        <Row label="Wallpaper receives clicks">
          <div className="flex items-center justify-end gap-2">
            <span className="text-[11px] text-muted-foreground">Empty desktop passes clicks to it</span>
            <Switch
              checked={!!lw.interactive}
              onCheckedChange={(interactive) => set({ ...lw, interactive })}
            />
          </div>
        </Row>
      )}
    </>
  );
}
