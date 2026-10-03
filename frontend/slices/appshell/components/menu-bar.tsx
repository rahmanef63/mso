"use client";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { useApps } from "../lib/registry";
import { useBrand } from "../registry/brand";
import { useFocused } from "../hooks/use-shell";
import { shellStore, openWindow, closeWindow, toggleMaximize, minimizeWindow } from "../lib/store";
import { StatusCluster } from "./menu-bar-status";
import { AppMenus, DefaultMenus, WindowMenu, HelpMenu, Menu } from "./menu-bar-menus";
import { useInspectorInfo } from "../lib/inspector";

// macOS-style menu bar: logo · app menus · right status cluster (sys + clock).
export function MenuBar() {
  const apps = useApps();
  const brand = useBrand();
  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    location.reload();
  };
  const focusedId = useFocused();
  const focusedApp = apps.find(
    (a) => a.id === (focusedId ? shellStore.getWindow(focusedId)?.app : null),
  );
  const appName = focusedApp?.title ?? brand.idleAppName ?? brand.name;
  // The focused app's live inspector actions become its menu-bar app-menu items —
  // the same bus that feeds the mobile in-app "•••" drawer (one source, both OSes).
  const appActions = useInspectorInfo(focusedApp?.id)?.actions ?? [];
  const closeFocused = () => focusedId && closeWindow(focusedId);
  const maximizeFocused = () => focusedId && toggleMaximize(focusedId);

  return (
    <header
      className="glass absolute inset-x-0 top-0 z-[900] flex h-[30px] items-center px-[10px] pr-5 text-[13px] font-semibold font-[family-name:var(--shell-font)] text-foreground"
      style={{ background: "var(--shell-menu-bar, var(--glass-bar))" }}
    >
      <span className="grid size-4 place-items-center rounded-[5px] bg-primary text-[10px] font-extrabold text-primary-foreground">
        {brand.logo}
      </span>

      <Menu label={brand.name} bold>
        <DropdownMenuItem onSelect={() => openWindow("os-settings", "Settings")}>
          About {brand.name}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openWindow("os-settings", "Settings")}>
          System Settings…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          Log Out<DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
        </DropdownMenuItem>
      </Menu>

      <Menu label={appName} bold>
        <DropdownMenuItem disabled>About {appName}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {appActions.length > 0 && (
          <>
            {appActions.map((a) => (
              <DropdownMenuItem key={a.id} onSelect={() => void a.run()}>
                {a.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={() => openWindow("os-settings", "Settings")}>
          Settings…<DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!focusedId} onSelect={() => focusedId && minimizeWindow(focusedId)}>
          Hide {appName}<DropdownMenuShortcut>⌘H</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!focusedId} onSelect={closeFocused}>
          Quit {appName}<DropdownMenuShortcut>⌘Q</DropdownMenuShortcut>
        </DropdownMenuItem>
      </Menu>

      {focusedApp?.menus?.length ? (
        <AppMenus menus={focusedApp.menus} />
      ) : (
        <DefaultMenus focusedId={focusedId} closeFocused={closeFocused} maximizeFocused={maximizeFocused} />
      )}

      {/* Window + Help persist regardless of app menus (real macOS behaviour). */}
      <WindowMenu focusedId={focusedId} />
      <HelpMenu />

      <StatusCluster />
    </header>
  );
}
