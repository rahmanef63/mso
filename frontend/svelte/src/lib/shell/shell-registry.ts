import type { CommandItem } from "./command-palette.ts";
import type { AppSlugMap } from "./window-store.ts";

export type DockAppDef = {
  app: string;
  label: string;
  title: string;
  payload?: unknown;
  multi?: boolean;
  ownerOnly?: boolean;
};

export const APP_SLUGS: AppSlugMap = {
  assistant: "assistant", files: "files", editor: "editor", docs: "docs", workflows: "workflows",
  organization: "organization", memory: "memory", store: "store", extensions: "extensions", infra: "infra",
  integrations: "integrations", channels: "channels", processes: "processes", services: "services",
  packages: "packages", apps: "apps", settings: "settings", "shell-settings": "shell-settings",
  terminal: "terminal", devices: "devices", clipboard: "clipboard", inspector: "inspector",
  "agent-vault": "agent-vault", "agent-group": "agent-group", media: "media", pickers: "pickers",
  "create-app": "create-app",
};

export const SHORTCUTS: ReadonlyArray<{ keys: string; description: string }> = [
  { keys: "Ctrl/Cmd + K", description: "Open command palette" },
  { keys: "Shift + ?", description: "Open keyboard shortcuts" },
  { keys: "Ctrl/Cmd + S", description: "Save active file in Code Editor" },
  { keys: "Escape", description: "Close open dialog" },
];

export const DOCK_APPS: readonly DockAppDef[] = [
  { app: "assistant", label: "Open Alfa", title: "Alfa Assistant" },
  { app: "files", label: "Open Files", title: "Files", payload: "~", multi: true },
  { app: "editor", label: "Open Editor", title: "Code Editor", multi: true },
  { app: "docs", label: "Docs", title: "Docs" },
  { app: "workflows", label: "Workflows", title: "Workflows" },
  { app: "organization", label: "Organization", title: "Organization" },
  { app: "extensions", label: "Extensions", title: "Extensions" },
  { app: "media", label: "Media Viewer", title: "Media Viewer" },
  { app: "pickers", label: "Pickers", title: "Pickers" },
  { app: "processes", label: "Open Processes", title: "Processes" },
  { app: "services", label: "Open Services", title: "Services" },
  { app: "packages", label: "Open Packages", title: "Packages" },
  { app: "apps", label: "Managed Apps", title: "Managed Apps" },
  { app: "settings", label: "Settings", title: "Settings" },
  { app: "shell-settings", label: "Shell Settings", title: "Shell Settings" },
  { app: "clipboard", label: "Clipboard", title: "Clipboard" },
  { app: "inspector", label: "Inspector", title: "Inspector" },
  { app: "agent-vault", label: "Agent Vault", title: "Agent Vault", ownerOnly: true },
  { app: "agent-group", label: "Agent Groups", title: "Agent Groups", ownerOnly: true },
  { app: "create-app", label: "Create App", title: "Create App", ownerOnly: true },
  { app: "memory", label: "Memory Graph", title: "Memory Graph", ownerOnly: true },
  { app: "store", label: "App Store", title: "App Store", ownerOnly: true },
  { app: "infra", label: "Infrastructure", title: "Infrastructure", ownerOnly: true },
  { app: "integrations", label: "Integrations", title: "Integrations", ownerOnly: true },
  { app: "channels", label: "Channels", title: "Channels", ownerOnly: true },
  { app: "terminal", label: "Open Terminal", title: "Terminal", ownerOnly: true },
  { app: "devices", label: "Devices", title: "Devices", ownerOnly: true },
];

export function visibleDockApps(role: string | null | undefined): DockAppDef[] {
  return DOCK_APPS.filter((item) => !item.ownerOnly || role === "owner");
}

export function buildShellCommands(args: {
  authenticated: boolean;
  role: string | null | undefined;
  onRefresh: () => void;
  onControlCenter: () => void;
  onForceQuit: () => void;
  onLock: () => void;
  onShortcuts: () => void;
  onSignOut: () => void;
  onOpenApp: (app: string, title: string, payload?: unknown, multi?: boolean) => void;
}): CommandItem[] {
  const items: CommandItem[] = [
    { id: "refresh-monitor", label: "Refresh system monitor", category: "System", run: args.onRefresh },
    { id: "control-center", label: "Open Control Center", category: "Shell", run: args.onControlCenter },
    { id: "force-quit", label: "Force quit windows", category: "Shell", run: args.onForceQuit },
    { id: "lock-screen", label: "Lock workspace screen", category: "Shell", run: args.onLock },
    { id: "shortcuts", label: "Show keyboard shortcuts", category: "Help", shortcut: "?", run: args.onShortcuts },
  ];
  if (!args.authenticated) return items;
  for (const item of visibleDockApps(args.role)) {
    items.push({
      id: `open-${item.app}`,
      label: `Open ${item.title}`,
      category: "Apps",
      keywords: [item.app, item.label],
      run: () => args.onOpenApp(item.app, item.title, item.payload, item.multi),
    });
  }
  items.push({ id: "sign-out", label: "Sign out", category: "Session", run: args.onSignOut });
  return items;
}
