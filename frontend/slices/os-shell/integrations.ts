"use client";

// MSO's registrations into the appshell runtime registries (lock guard, context
// menus, palette commands). Side-effect module imported
// once from os-root INSIDE the auth boundary — registries are module-level, so
// this runs exactly once per page.
import { Activity, Expand, FilePlus, FolderPlus, Link2, Lock, RotateCcw, Shrink, Wallpaper as WallpaperIcon } from "lucide-react";
import {
  lock,
  openWindow, registerAlfaLoader,
  registerContextMenu,
  resetDesktopIcons,
  setAddDialog,
  setShell,
  setUnlockGuard,
  shellsForSurface, type MenuItem
} from "@/features/appshell";

// @ agents and / skills+tools for every AI composer. Registered here rather than
// from the Assistant app so the menus work in the per-app Alfa sheet before that
// app has ever been opened — but as a LOADER, not an eager import: the catalog and
// presets are ~88 KB that nothing renders until a composer exists, and the module
// also fired a /api/skills read (90 files, ~600 KB off disk) on every page load.
registerAlfaLoader(async () => {
  const { installAlfaSources } = await import("@/features/assistant");
  installAlfaSources();
});

// Unlock = the signed session cookie is still valid. A dead session falls
// through to false; the user reloads and lands on the login gate instead.
setUnlockGuard(async () => {
  try {
    return (await fetch("/api/auth/me", { cache: "no-store" })).ok;
  } catch {
    return false;
  }
});

// MSO's dynamic right-click items — merged AFTER each shell's built-ins by
// the context-menu registry. One provider for every shell ("*", surface-aware)
// plus a dashboard-specific group; providers run at open time so disabled
// states / labels can read live data.
registerContextMenu("*", (ctx) => {
  const items: MenuItem[] = [];
  if (ctx.surface === "desktop") {
    items.push({
      label: "New Files window",
      icon: FolderPlus,
      onClick: () => openWindow("files-manager", "Files", undefined, { path: "~" }, { multi: true }),
    });
    // Desktop-icon items only where the icon layer + AddIconDialog actually mount
    // (macOS/Windows). The Dashboard shell renders neither, so showing them there
    // would be a no-op that also leaves the add-dialog kind stuck.
    if (ctx.shell !== "dashboard") {
      items.push({ label: "Add link…", icon: Link2, onClick: () => setAddDialog("link") });
      items.push({ label: "Add file…", icon: FilePlus, onClick: () => setAddDialog("file") });
      items.push({ label: "Reset desktop icons", icon: RotateCcw, onClick: resetDesktopIcons });
    }
  }
  items.push({
    label: "Change wallpaper…",
    icon: WallpaperIcon,
    onClick: () => openWindow("os-settings", "Settings"),
  });
  if (ctx.surface === "mobile") items.push({ label: "Lock screen", icon: Lock, onClick: lock });
  // "View as …" — switch the active shell persona for this surface (desktop:
  // macOS/Windows/Dashboard, mobile: iOS/Android), excluding the current one.
  for (const s of shellsForSurface(ctx.surface)) {
    if (s.id !== ctx.shell) {
      items.push({ label: `View as ${s.label}`, icon: s.icon, onClick: () => setShell(ctx.surface, s.id) });
    }
  }
  // Full-screen the whole cockpit (read live so the label reflects current state).
  const inFs = typeof document !== "undefined" && !!document.fullscreenElement;
  items.push({
    label: inFs ? "Exit Full Screen" : "Enter Full Screen",
    icon: inFs ? Shrink : Expand,
    onClick: () => {
      if (inFs) void document.exitFullscreen?.();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    },
  });
  return items;
});
registerContextMenu("dashboard", () => [
  { label: "Open System Monitor", icon: Activity, onClick: () => openWindow("system-monitor", "System Monitor") },
]);

