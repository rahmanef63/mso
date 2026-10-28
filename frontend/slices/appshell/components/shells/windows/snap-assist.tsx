"use client";
/* Windows 11 Snap-Assist — after a window half-snaps (drag-to-edge or ⌘/Ctrl←→),
   a thumbnail grid fills the EMPTY half, offering the other open windows for the
   complementary zone. Pick one → it snaps to fill the half. Listens to the store's
   transient `onSnap` pulse; the pick itself only calls existing actions (restore /
   snapWindow), so it forks no window state. Windows-shell local UI. */
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { useWindowOrder } from "../../../hooks/use-shell";
import { useApps } from "../../../lib/registry";
import { onSnap, snapWindow, restoreWindow, shellStore } from "../../../lib/store";
import { snapRect } from "../../../lib/store-geometry";
import { AppIcon } from "../../app-icon";
import type { SnapZone } from "../../../lib/types";

export function SnapAssist() {
  const order = useWindowOrder();
  const apps = useApps();
  // The half to fill + the id that triggered (excluded from candidates). null = hidden.
  const [state, setState] = useState<{ fill: SnapZone; from: string } | null>(null);
  const suppress = useRef(false); // ignore the pulse our own pick fires

  useEffect(() => {
    return onSnap(({ id, zone }) => {
      if (suppress.current) { suppress.current = false; return; }
      setState({ fill: zone === "left" ? "right" : "left", from: id });
    });
  }, []);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setState(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  if (!state) return null;

  // Candidates: every other window except the one just snapped. A minimized one
  // is restored before it snaps so it lands visible in the empty half.
  const candidates = order.filter((id) => id !== state.from);
  if (candidates.length === 0) return null;

  const pick = (id: string) => {
    if (shellStore.getWindow(id)?.minimized) restoreWindow(id);
    suppress.current = true;
    snapWindow(id, state.fill); // fires onSnap synchronously → listener swallows it
    suppress.current = false; // clear even if snapWindow early-returned (window gone), so the guard never sticks
    setState(null);
  };

  // Position the panel over the empty half (snapRect is in surface coords; the
  // windows-shell section is inset-0, so they map straight to absolute px).
  const r = snapRect(state.fill);

  return (
    <div
      className="absolute inset-0 z-[55] bg-black/30 animate-in fade-in duration-150"
      onClick={() => setState(null)}
    >
      <div
        className="absolute flex flex-col gap-3 overflow-auto rounded-2xl border border-white/15 bg-card/70 p-4 shadow-2xl backdrop-blur-xl"
        style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 text-center text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Fill the {state.fill} half
        </div>
        <div className="grid flex-1 content-start gap-3 sm:grid-cols-2">
          {candidates.map((id) => (
            <Candidate key={id} id={id} app={apps} onPick={() => pick(id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Candidate({ id, app, onPick }: { id: string; app: ReturnType<typeof useApps>; onPick: () => void }) {
  const win = shellStore.getWindow(id);
  if (!win) return null;
  const a = app.find((x) => x.id === win.app);
  return (
    <Button type="button" variant="ghost"
      onClick={onPick}
      title={win.title}
      className="h-auto p-0 font-normal hover:bg-transparent group flex flex-col overflow-hidden rounded-xl border border-border bg-background text-left shadow transition hover:-translate-y-0.5 hover:ring-2 hover:ring-primary"
    >
      <div className="h-6 w-full" style={{ background: a?.gradient ?? "var(--muted)" }} />
      {/* 40px, and deliberately NOT snapped to the Fluent icon table: real Snap
          Assist shows a live window thumbnail here, and this icon is standing in
          for that thumbnail, not acting as an icon. Forcing it to 32px (the largest
          table row) would shrink the card's subject below its own caption strip. */}
      <div className="grid flex-1 place-items-center py-4">
        {a && <span className="size-10 opacity-90"><AppIcon app={a} /></span>}
      </div>
      {/* The strip below IS a title bar, so 16px is the right row and already was.
          Left alone on purpose — do not "align" it with the 40px above. */}
      <div className="flex items-center gap-1.5 border-t border-border px-2 py-1.5">
        {a && <span className="size-4 shrink-0"><AppIcon app={a} /></span>}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{win.title}</span>
      </div>
    </Button>
  );
}
