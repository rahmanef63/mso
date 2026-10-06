"use client";
/* Menu-bar dropdown menus + shared <Menu> trigger (split from menu-bar.tsx). */
import { Fragment } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApps } from "../lib/registry";
import { useBrand } from "../registry/brand";
import { useWindowOrder, useWindowsMap } from "../hooks/use-shell";
import {
  openWindow,
  setLauncherOpen,
  toggleSpotlight,
  toggleInspector,
  toggleMaximize,
  minimizeWindow,
  minimizeAll,
  restoreWindow,
  focusWindow,
} from "../lib/store";
import { togglePin } from "../lib/window-commands";
import type { AppDescriptor } from "../lib/types";

// execCommand is deprecated but the only zero-dep clipboard driver from a menu.
function exec(cmd: string) {
  try {
    document.execCommand(cmd);
  } catch {
    /* no-op in read-only contexts; the ⌘ label is the real affordance */
  }
}

// Edit menu rows — execCommand drives the focused selection; `sep` = divider.
const EDIT_ITEMS: { cmd: string; label: string; key: string; sep?: boolean }[] = [
  { cmd: "cut", label: "Cut", key: "⌘X" },
  { cmd: "copy", label: "Copy", key: "⌘C" },
  { cmd: "paste", label: "Paste", key: "⌘V" },
  { cmd: "selectAll", label: "Select All", key: "⌘A", sep: true },
];


// An app's own menu-bar dropdowns (macOS replaces File/Edit/View with the
// focused app's menus). Declarative — items carry their own onSelect.
export function AppMenus({ menus }: { menus: NonNullable<AppDescriptor["menus"]> }) {
  return (
    <>
      {menus.map((m) => (
        <Menu key={m.label} label={m.label}>
          {m.items.map((it, i) =>
            "sep" in it && it.sep ? (
              <DropdownMenuSeparator key={i} />
            ) : (
              <DropdownMenuItem key={i} disabled={it.disabled} onSelect={() => it.onSelect?.()}>
                {it.label}
                {it.shortcut && <DropdownMenuShortcut>{it.shortcut}</DropdownMenuShortcut>}
              </DropdownMenuItem>
            ),
          )}
        </Menu>
      ))}
    </>
  );
}

// The generic File/Edit/View shown when the focused app declares no menus.
export function DefaultMenus({
  focusedId, closeFocused, maximizeFocused,
}: {
  focusedId: string | null;
  closeFocused: () => void;
  maximizeFocused: () => void;
}) {
  return (
    <>
      <Menu label="File">
        <DropdownMenuItem onSelect={() => setLauncherOpen(true)}>
          New Window… <DropdownMenuShortcut>⌘N</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!focusedId} onSelect={closeFocused}>
          Close Window <DropdownMenuShortcut>⌘W</DropdownMenuShortcut>
        </DropdownMenuItem>
      </Menu>

      <Menu label="Edit">
        {EDIT_ITEMS.map((it) => (
          <Fragment key={it.cmd}>
            {it.sep && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => exec(it.cmd)}>
              {it.label} <DropdownMenuShortcut>{it.key}</DropdownMenuShortcut>
            </DropdownMenuItem>
          </Fragment>
        ))}
      </Menu>

      <Menu label="View">
        <DropdownMenuItem disabled={!focusedId} onSelect={maximizeFocused}>
          Enter Full Screen <DropdownMenuShortcut>⌃⌘F</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setLauncherOpen(true)}>
          Launchpad
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => toggleSpotlight()}>
          Spotlight <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => toggleInspector()}>
          AI Inspector <DropdownMenuShortcut>⌘I</DropdownMenuShortcut>
        </DropdownMenuItem>
      </Menu>
    </>
  );
}

// macOS Window menu: minimize/zoom the focused window + the open-window list
// (✓ marks the focused one; picking restores + focuses).
export function WindowMenu({ focusedId }: { focusedId: string | null }) {
  const order = useWindowOrder();
  // Reactive map read so the ✓/title list + Pin label re-render on any patch.
  const winMap = useWindowsMap();
  const windows = order
    .map((id) => ({ id, win: winMap[id] }))
    .filter((w): w is { id: string; win: NonNullable<typeof w.win> } => !!w.win);
  return (
    <Menu label="Window">
      <DropdownMenuItem disabled={!focusedId} onSelect={() => focusedId && minimizeWindow(focusedId)}>
        Minimize <DropdownMenuShortcut>⌘M</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!focusedId} onSelect={() => focusedId && toggleMaximize(focusedId)}>
        Zoom
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!focusedId} onSelect={() => focusedId && togglePin(focusedId)}>
        {focusedId && winMap[focusedId]?.pinned ? "Unpin Window" : "Pin Window on Top"}</DropdownMenuItem>
      <DropdownMenuItem disabled={windows.length === 0} onSelect={() => minimizeAll()}>
        Minimize All
      </DropdownMenuItem>
      {windows.length > 0 && <DropdownMenuSeparator />}
      {windows.map(({ id, win }) => (
        <DropdownMenuItem
          key={id}
          onSelect={() => { if (win.minimized) restoreWindow(id); focusWindow(id); }}
        >
          <span className="w-3.5 text-center">{id === focusedId ? "✓" : win.minimized ? "◆" : ""}</span>
          <span className="truncate">{win.title}</span>
        </DropdownMenuItem>
      ))}
    </Menu>
  );
}

// Help: Spotlight is the search affordance; a Docs/handbook app (if the host
// registers one) gets a direct entry.
export function HelpMenu() {
  const apps = useApps();
  const brand = useBrand();
  const docs = apps.find((a) => a.id === "docs");
  return (
    <Menu label="Help">
      <DropdownMenuItem onSelect={() => toggleSpotlight()}>
        Search <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
      </DropdownMenuItem>
      {docs && (
        <DropdownMenuItem onSelect={() => openWindow(docs.id, docs.title, docs.defaultSize)}>
          {brand.name} Help
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => toggleInspector()}>
        AI Inspector <DropdownMenuShortcut>⌘I</DropdownMenuShortcut>
      </DropdownMenuItem>
    </Menu>
  );
}

export function Menu(props: { label: string; bold?: boolean; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={
          "macos-menu-trigger shrink-0 rounded-full px-[9px] py-1 leading-4 outline-none transition-colors duration-150 " +
          (props.bold ? "font-extrabold" : "font-semibold")
        }
      >
        {props.label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={5} className="macos-menu rounded-xl">
        {props.children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


