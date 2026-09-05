"use client";

import { Suspense, useEffect, useState, type ComponentType } from "react";
import { useResponsive } from "../responsive/use-responsive";
import { inEditable } from "../lib/use-focused-hotkey";
import { usePersistLayout } from "../hooks/use-persist-layout";
import { Wallpaper } from "./wallpaper";
import { Slot } from "../registry/feature-registry";
import { toggleSpotlight, toggleInspector, snapWindow, cycleSnap, toggleMaximize, minimizeWindow, shellStore } from "../lib/store";
import { ContextMenuHost } from "./shells/context-menu-host";
import { resolveShell, useShellPrefs, ActiveShellProvider } from "../registry/shells";
// side-effects: all five shell registrations (lazy) + palette commands
import "../registry/register-shells";
import "../lib/window-commands";
import "../lib/spaces";
import "../lib/window-tabs";
import "../lib/focus-mode";
import "../lib/profiles";
// NOTE: the Dashboard shell lives in the APP layer (data-agnostic slice).

// The OS surface. The app registry + responsive providers mount in AppShell
// (above the feature-provider seam — see provider/app-shell.tsx), so this is
// the pure chrome layer.
export function OsDesktop() {
  return <Surface />;
}

function Surface() {
  const r = useResponsive();
  const prefs = useShellPrefs();
  // False on the server AND on the first client render, true from the first effect
  // onwards — so the server HTML and the tree React hydrates are identical by
  // construction. See the note above the early return below.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot post-hydration flip, the same pattern lib/appearance/store.tsx and lib/quicklinks/store.tsx use. A lazy initializer cannot work here: the whole point is that the FIRST render must match the server, and only the effect (which never runs on the server) may flip it.
  useEffect(() => setMounted(true), []);

  // The live form factor picks the surface; the user's per-surface preference
  // picks WHICH shell renders there (desktop look vs mobile look, chosen
  // independently in Settings). A mobile shell on a wide viewport (device
  // override = phone) previews inside a phone frame; a real narrow screen fills.
  const surface = r.isMobile ? "mobile" : "desktop";
  const desc = resolveShell(surface, prefs);
  const Comp = desc.render;

  usePersistLayout();
  useSpotlightHotkey();
  useInspectorHotkey();
  // Only windowed shells (macOS/Windows) react to ⌘+Arrow snap — otherwise the
  // hotkey would silently snap the hidden focused window under a single-pane or
  // mobile shell, surprising the user when they switch back.
  useWindowSnapKeys(!!desc.windowed);
  const framed = surface === "mobile" && r.vw >= 768;

  // The shell renders ONLY after mount, and this is a correctness fix, not caution.
  // Which shell to draw depends on three things the server cannot know: the viewport
  // (`useResponsive` measures `window.innerWidth`), the persisted per-surface shell
  // choice (localStorage `sv:shell`) and the wallpaper preference. So SSR always
  // guessed desktop/macOS, and on a phone the client then rendered iOS instead — two
  // different trees, which is a guaranteed hydration mismatch. React responded by
  // throwing away the hydrated tree and re-rendering the whole shell on the client,
  // and because Radix derives ids from `useId`, the divergence surfaced as mismatched
  // DropdownMenuTrigger ids in the dev overlay.
  //
  // This is also a UX improvement, not a trade: the old behaviour PAINTED the macOS
  // desktop on a phone and then swapped it for iOS. A brief flash of the themed
  // background is strictly better than a flash of the wrong operating system.
  // Nothing is lost to SEO — the catch-all is fully dynamic and auth-gated, and the
  // shell was never usable without JS anyway.
  //
  // #main-content and the sizing stay in the skeleton so the skip link keeps a target
  // and the layout does not jump. `bg-background` is already the correct light/dark
  // value here: the pre-hydration script in app/layout.tsx sets data-theme before
  // first paint.
  if (!mounted) {
    return <div id="main-content" className="relative w-screen overflow-hidden bg-background" style={{ height: "var(--mso-visual-vh, 100dvh)" }} />;
  }

  return (
    <ActiveShellProvider id={desc.id} surface={surface}>
      <div id="main-content" data-shell={desc.id} className="relative w-screen overflow-hidden" style={{ height: "var(--mso-visual-vh, 100dvh)" }}>
        <Wallpaper shellDefault={desc.wallpaper} />
        <ContextMenuHost>
          <Suspense fallback={null}>
            {framed ? <PhoneFrame Comp={Comp} /> : <Comp />}
          </Suspense>
          <Slot region="overlay" />
          <Slot region="notifications" />
        </ContextMenuHost>
      </div>
    </ActiveShellProvider>
  );
}

// Centered device frame so a phone shell can be previewed on a desktop screen.
function PhoneFrame({ Comp }: { Comp: ComponentType }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="relative h-[844px] max-h-[92vh] w-[390px] max-w-[92vw] overflow-hidden rounded-[2.5rem] border-[6px] border-black/80 bg-background shadow-2xl">
        <Comp />
      </div>
    </div>
  );
}

// ⌘K / Ctrl+K toggles Spotlight from anywhere on the desktop.
function useSpotlightHotkey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleSpotlight();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// ⌘I / Ctrl+I toggles the AI Inspector — but not while typing (⌘I is italic in
// every editor; stealing it mid-edit is surprising).
function useInspectorHotkey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i" && !inEditable(e.target)) {
        e.preventDefault();
        toggleInspector();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// ⌘/Ctrl + Arrow snaps the focused window: ←/→ half, ↑ maximize, ↓ restore or
// minimize. Skipped while typing in a field. Disabled on non-windowed shells
// (single-pane / mobile) so it never tiles a window the user can't see.
function useWindowSnapKeys(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (!e.key.startsWith("Arrow")) return;
      if (inEditable(e.target)) return;
      const id = shellStore.getFocused();
      if (!id) return;
      const win = shellStore.getWindow(id);
      if (!win) return;
      e.preventDefault();
      switch (e.key) {
        // Cycle the tiling width on repeated presses: ½ → ⅔ → ⅓ → ½ …
        case "ArrowLeft": snapWindow(id, cycleSnap(win.snapZone, "left")); break;
        case "ArrowRight": snapWindow(id, cycleSnap(win.snapZone, "right")); break;
        case "ArrowUp": if (!win.maximized) toggleMaximize(id); break;
        case "ArrowDown": if (win.maximized) toggleMaximize(id); else minimizeWindow(id); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
