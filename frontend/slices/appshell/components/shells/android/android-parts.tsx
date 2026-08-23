"use client";
/* Android shell sub-surfaces — the overlays + home pieces the main shell
   toggles: Recents card deck, App Drawer, and the home grid cell. Split from
   android-shell.tsx so each file stays small (rr ≤200 LOC gate). The old fake
   quick-settings Shade is gone: pull-down now opens the REAL Control Center
   feature via the controlCenter slot (working toggles, single source). */
import { Button } from "@/components/ui/button";
import { useMemo, useState, useRef } from "react";
import { ChevronLeft, Search, X } from "lucide-react";
import { shellStore, closeWindow, closeAll } from "../../../lib/store";
import { useSwipeUpClose } from "../../../hooks/use-swipe-close";
import { AppIcon } from "../../app-icon";
import { M3_PRESS } from "./android-motion";
import type { AppDescriptor, WindowState } from "../../../lib/types";

// 3-button gesture/nav row. 48px button row (--android-nav) + the device
// safe-area below it — the same calc(var(--android-nav) + var(--sai-bottom))
// total every overlay pads for. `inactive` = covered by the app layer's copy.
export function NavBar({ inactive = false, onBack, onHome, onRecents }: { inactive?: boolean; onBack: () => void; onHome: () => void; onRecents: () => void }) {
  return (
    // The row MUST carry its own surface. It used to be fully transparent, which
    // left `text-foreground` (dark, from the light theme) floating directly on the
    // wallpaper — and the Android wallpaper is dark, so Back/Home/Recents were
    // invisible. Pairing bg-background with text-foreground restores the token
    // contract: whatever the theme, the two are a legible pair by construction.
    // This is why the shell felt like it had "no back button".
    <div
      className="flex shrink-0 items-center justify-around border-t border-border/60 bg-background/80 text-foreground backdrop-blur-xl"
      style={{ height: "calc(var(--android-nav) + var(--sai-bottom))", paddingBottom: "var(--sai-bottom)" }}
      inert={inactive}
      aria-hidden={inactive}
    >
      {/* The nav row had NO press feedback at all — on a touch device a tap that
          moves nothing reads as a dropped input, which is why Back/Home/Recents
          felt dead even after they were made visible. M3 spatial-FAST (k=800,
          ζ=0.6): small element, and the 9.3% overshoot is the release. */}
      <Button type="button" variant="ghost" onClick={onBack} aria-label="Back" className={`h-auto p-0 font-normal hover:bg-transparent grid size-12 place-items-center active:scale-90 ${M3_PRESS}`}>
        <ChevronLeft className="size-6" />
      </Button>
      {/* border-current, not border-foreground/70: these two are drawn as outlines,
          so they must follow the button's own colour rather than a token that can
          drift from it. (border-foreground/70 was also silently dead until the
          @layer base fix in globals.css — every border-<color> utility was being
          overridden by an unlayered `*` rule.) */}
      <Button type="button" variant="ghost" onClick={onHome} aria-label="Home" className={`h-auto p-0 font-normal hover:bg-transparent grid size-12 place-items-center active:scale-90 ${M3_PRESS}`}>
        <span className="size-4 rounded-full border-2 border-current opacity-80" />
      </Button>
      <Button type="button" variant="ghost" onClick={onRecents} aria-label="Recents" className={`h-auto p-0 font-normal hover:bg-transparent grid size-12 place-items-center active:scale-90 ${M3_PRESS}`}>
        <span className="size-3.5 rounded-[3px] border-2 border-current opacity-80" />
      </Button>
    </div>
  );
}

export function Recents({ order, apps, onResume, onHome }: { order: string[]; apps: AppDescriptor[]; onResume: (id: string) => void; onHome: () => void }) {
  const wins = order.map((id) => shellStore.getWindow(id)).filter(Boolean) as WindowState[];
  return (
    // Recents used to appear with NO animation whatsoever — a full-screen blurred
    // scrim popping in one frame, which reads as a glitch rather than as a switcher
    // arriving. Split by family, deliberately: the scrim is pure opacity, so it gets
    // the critically-damped EFFECTS spring (k=1600, ζ=1, ~186ms) and cannot
    // overshoot; the card deck moves, so it gets SPATIAL default (k=380, ζ=0.8,
    // ~371ms) and is allowed to. One animation covering both would have had to pick
    // one curve and be wrong for the other half.
    <div className="absolute inset-0 z-[30] flex flex-col bg-background/90 backdrop-blur-xl animate-in fade-in duration-[var(--m3-dur-effects)] ease-[var(--m3-effects)]" onClick={onHome}>
      {/* Empty deck must stay tappable-through: the inner container fills the
          overlay (no Clear-all bar), so swallowing clicks would trap the user
          with no exit (NavBar sits under the z-30 overlay). */}
      <div className="flex min-h-0 flex-1 items-center gap-3 overflow-x-auto p-5 animate-in slide-in-from-bottom-4 duration-[var(--m3-dur-spatial)] ease-[var(--m3-spatial)]" onClick={(e) => { if (wins.length > 0) e.stopPropagation(); }}>
        {wins.length === 0 && <div className="m-auto text-sm text-muted-foreground">No recent apps · tap to go home</div>}
        {wins.map((w) => (
          <RecentCard key={w.id} win={w} app={apps.find((a) => a.id === w.app)} onResume={() => onResume(w.id)} />
        ))}
      </div>
      {wins.length > 0 && (
        <div
          className="flex shrink-0 items-center justify-center pt-1"
          style={{ paddingBottom: "calc(var(--android-nav) + var(--sai-bottom))" }}
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            type="button"
            variant="ghost"
            onClick={() => { closeAll(); onHome(); }}
            className="h-auto rounded-full bg-muted px-4 py-1.5 text-[13px] font-semibold text-foreground hover:bg-muted/80"
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}

function RecentCard({ win, app, onResume }: { win: WindowState; app?: AppDescriptor; onResume: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onPointerDown, draggedRef } = useSwipeUpClose(ref, () => closeWindow(win.id));
  return (
    // A plain div with onClick is unreachable by keyboard. It stays a div (the
    // swipe-up-close handler needs the ref, and a <button> would swallow the
    // nested close button), so it carries the button role + a key handler by
    // hand. iOS's equivalent, WindowPreview, is a real <Surface type="button">.
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label={`Open ${win.title}`}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        onResume();
      }}
      onClick={(e) => {
        e.stopPropagation(); // a card tap resumes; only empty space → home
        if (!draggedRef.current) onResume();
      }}
      style={{ touchAction: "pan-x" }}
      className="flex h-[60%] w-44 shrink-0 cursor-grab flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
    >
      <span className="flex items-center gap-2 px-3 py-2">
        {app && <span className="size-5"><AppIcon app={app} /></span>}
        <span className="min-w-0 flex-1 truncate text-left text-xs font-medium">{win.title}</span>
        <button
          type="button"
          aria-label={`Close ${win.title}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation(); // don't let the card's onClick resume the app
            closeWindow(win.id);
          }}
          className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 active:bg-foreground/20 [@media(pointer:coarse)]:size-11"
        >
          <X className="size-3.5" />
        </button>
      </span>
      <span className="min-h-0 flex-1" style={{ background: app?.gradient, opacity: 0.15 }} />
    </div>
  );
}

export function AppCell({ app, onClick }: { app: AppDescriptor; onClick: () => void }) {
  return (
    // Press scales the ICON, not the whole cell: scaling the cell drags the label
    // with it and the text goes blurry mid-transform on a low-DPI panel. `group`
    // + `group-active:` is required because the :active is on the Button while the
    // thing that moves is its child. Spatial-FAST — an icon is a small element.
    <Button type="button" variant="ghost" onClick={onClick} className="group h-auto p-0 font-normal hover:bg-transparent flex flex-col items-center gap-1.5">
      <span className={`size-14 group-active:scale-90 ${M3_PRESS}`}><AppIcon app={app} /></span>
      {/* Colour is INHERITED, deliberately: this cell renders both on the home grid
          (over the wallpaper, where the parent sets white + a shadow) and inside the
          App Drawer (a light bg-background/95 sheet, where white would be invisible).
          Hard-coding either one breaks the other surface. */}
      <span className="w-full truncate text-center text-[11px]">{app.title}</span>
    </Button>
  );
}

export function AppDrawer({ apps, onLaunch, onClose }: { apps: AppDescriptor[]; onLaunch: (a: AppDescriptor) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => apps.filter((a) => a.title.toLowerCase().includes(q.toLowerCase())), [apps, q]);
  return (
    // Spatial SLOW (k=200, ζ=0.8, ~511ms): M3 picks the speed tier from the SIZE of
    // the moving element, and this is a full-screen surface. Only the model changed
    // here — a sampled spring on mobileAppOpen's small UPWARD travel, which is
    // already the right direction: the drawer is opened from the
    // "All apps" target at the BOTTOM of the home surface, so it should arrive
    // rising from where the finger was. (That target is drawn as a grabber but is a
    // plain tap — there is no swipe-up gesture in this shell, only usePullDown for
    // the shade and useSwipeUpClose for Recents cards.)
    <div data-slot="android-app-drawer" className="absolute inset-0 z-[30] flex flex-col bg-background/95 backdrop-blur-xl [animation:mobileAppOpen_var(--m3-dur-spatial-slow)_var(--m3-spatial)]">
      {/* Keep every top control below the physical notch/status area. The extra
          8px gives the grab handle breathing room even when env(safe-area-inset-top)
          resolves to zero in a normal browser/PWA window. */}
      <div
        data-slot="android-app-drawer-top"
        className="shrink-0"
        style={{ paddingTop: "calc(var(--sai-top, 0px) + 8px)" }}
      >
        {/* The handle remains a close target, but it is no longer the ONLY visible
            way out. On real phones onClose is routed through the same history-aware
            Back bridge as the hardware/browser gesture. */}
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          aria-label="Close app drawer"
          className="mx-auto flex h-[28px] w-24 items-center justify-center p-0 hover:bg-transparent"
        >
          <span className="h-1 w-10 rounded-full bg-foreground/30" />
        </Button>
        <div className="relative flex h-[48px] items-center px-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            aria-label="Back to Home"
            className={`absolute left-1 top-1/2 h-[48px] min-h-[48px] -translate-y-1/2 gap-0 rounded-full px-1.5 text-[15px] font-medium hover:bg-secondary ${M3_PRESS}`}
          >
            <ChevronLeft className="size-6 shrink-0" aria-hidden />
            <span>Home</span>
          </Button>
          <h1 className="mx-auto text-[18px] font-medium">All apps</h1>
        </div>
        <div className="mx-4 mb-3 mt-1 flex h-[48px] items-center gap-3 rounded-full border border-border bg-card px-4">
          <Search className="size-4 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search apps" placeholder="Search apps" className="min-w-0 w-full bg-transparent text-sm outline-none" />
        </div>
      </div>
      <div
        className="grid min-h-0 flex-1 grid-cols-4 content-start gap-x-3 gap-y-5 overflow-auto p-5"
        style={{ paddingBottom: "calc(var(--android-nav) + var(--sai-bottom))" }}
      >
        {list.map((a) => (
          <AppCell key={a.id} app={a} onClick={() => onLaunch(a)} />
        ))}
      </div>
    </div>
  );
}
