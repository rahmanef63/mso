"use client";
/* ContextMenuHost — ONE right-click listener for the whole OS surface, mounted
   once inside #main-content (desktop.tsx Surface). On contextmenu it walks the
   DOM zones under the cursor (collectZones), optionally appends the shell/global
   registry group, and if the merged menu is non-empty preventDefaults + opens
   the SHARED ContextMenu portal. Empty → the native menu is left intact.

   Why a React onContextMenu on a display:contents wrapper (not a native
   listener): a React synthetic handler fires in BUBBLE order, AFTER descendant
   handlers. So any not-yet-migrated menu (window title bar, dock, files, the 5
   shell backgrounds) that already `preventDefault`s the click is seen here as
   `e.defaultPrevented === true` and left alone. That gate is what makes adopting
   this host — and migrating the bespoke menus onto it — 100% incremental + safe. */
import { useCallback, useState, type ReactNode } from "react";
import { useActiveShell } from "../../registry/shells";
import { collectZones } from "../../lib/context-zone";
import { getContextMenuItems, joinGroups, type MenuItem } from "../../lib/context-menu";
import { ContextMenu } from "./context-menu";

// `pos` is nested (not spread as x/y) so the object handed to ContextMenu is the
// state's own, stable between renders. NO_ITEMS is the shared closed-case array —
// an inline `[]` would be a fresh identity on every render. Never mutated.
type Menu = { pos: { x: number; y: number }; items: MenuItem[] } | null;
const NO_ITEMS: MenuItem[] = [];

export function ContextMenuHost({ children }: { children: ReactNode }) {
  const { id: shell, surface } = useActiveShell();
  const [menu, setMenu] = useState<Menu>(null);

  // MUST be a stable identity, never an inline `() => setMenu(null)`. This host
  // wraps the whole desktop, so it re-renders on every window-store patch (open /
  // minimize / focus a window); ContextMenu registers its key + scroll listeners in
  // an effect keyed on `onClose`, and a fresh closure per render re-runs it. That
  // used to be fatal (the teardown also closed the submenu + refocused the trigger),
  // and it still costs a listener churn per patch. Keep the useCallback.
  // Same rule holds for `pos` and `items` below: ALL THREE props ContextMenu gets
  // must be identity-stable across a re-render that didn't change the menu, so that
  // ContextMenu's primitive-coord deps aren't the only thing standing between a
  // window-store patch and a torn-down submenu.
  const close = useCallback(() => setMenu(null), []);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (e.defaultPrevented) return; // a descendant / legacy handler already claimed it
      const target = e.target as Element | null;
      const closest = (sel: string) => !!(target?.closest && target.closest(sel));
      const nativeContextMenu =
        closest("[data-native-context-menu]") ||
        e.nativeEvent.composedPath().some((node) =>
          !!(node && typeof (node as Element).matches === "function" && (node as Element).matches("[data-native-context-menu]")),
        );
      if (nativeContextMenu || !target) return;

      const base = { shell, surface, x: e.clientX, y: e.clientY };
      const { groups, sealed } = collectZones(target, base);

      // Plain editable fields keep the native copy/paste/spellcheck menu unless a
      // zone explicitly claimed them.
      if (!groups.length && closest("input,textarea,[contenteditable]")) return;

      // The shell/global registry (View as / Change wallpaper / New Files window)
      // applies only to the BARE shell background — never inside a window or an
      // open dashboard pane (those keep the legacy per-shell guards until they
      // migrate to root zones). Once the shells are zones this can drop the guard.
      const onChrome = !closest("[data-window],[data-dashboard-main]");
      const registry = sealed || !onChrome ? [] : getContextMenuItems(base);
      const items = joinGroups([...groups, registry]);
      if (!items.length) return; // graceful: leave the native menu

      e.preventDefault();
      setMenu({ pos: { x: e.clientX, y: e.clientY }, items });
    },
    [shell, surface],
  );

  return (
    <div className="contents" onContextMenu={onContextMenu}>
      {children}
      <ContextMenu pos={menu?.pos ?? null} items={menu?.items ?? NO_ITEMS} onClose={close} />
    </div>
  );
}
