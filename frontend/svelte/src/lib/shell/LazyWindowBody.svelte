<script lang="ts">
  import type { Component } from "svelte";
  import { hasOperatorAccess } from "./shell-registry";
  import type { Session } from "../host-api";
  import type { ChromeChoice, ChromeProfile } from "./chrome-profile";
  import type { MobileNavSpec } from "./shell-design";
  import type { ShellPrefs } from "./shell-prefs-store";
  import type { WallpaperId } from "./wallpaper-store";
  import type { ShellLayoutState, WindowState } from "./window-store";

  let {
    win, session, layout, chromeChoice, resolvedChrome, viewportWidth,
    shellPrefs, wallpaper,
    onFilesPathChange, onThemeChange, onChromeChange, onShellPrefsChange, onWallpaperChange,
    onEditorDirtyChange, onOpenInEditor, onMobileNavChange,
  }: {
    win: WindowState;
    session: Session;
    layout: ShellLayoutState;
    chromeChoice: ChromeChoice;
    resolvedChrome: ChromeProfile;
    viewportWidth: number;
    shellPrefs?: ShellPrefs;
    wallpaper?: WallpaperId;
    onFilesPathChange: (winId: string, path: string) => void;
    onThemeChange: (theme: string) => void;
    onChromeChange: (c: ChromeChoice) => void;
    onShellPrefsChange?: (prefs: ShellPrefs) => void;
    onWallpaperChange?: (w: WallpaperId) => void;
    onEditorDirtyChange: (winId: string, dirty: boolean) => void;
    onOpenInEditor: (path: string) => void;
    onMobileNavChange?: (winId: string, nav: MobileNavSpec | null) => void;
  } = $props();

  type AnySliceComponent = Component<Record<string, unknown>>;
  type Loader = () => Promise<{ default: unknown }>;

  const LOADERS: Record<string, Loader> = {
    assistant: () => import("../assistant/AssistantApp.svelte"),
    files: () => import("../files/FilesManager.svelte"),
    processes: () => import("../monitor/ProcessesList.svelte"),
    services: () => import("../monitor/ServicesList.svelte"),
    packages: () => import("../managed-apps/PackagesView.svelte"),
    apps: () => import("../managed-apps/ManagedAppsView.svelte"),
    settings: () => import("../settings/SettingsApp.svelte"),
    "shell-settings": () => import("./ShellSettingsApp.svelte"),
    terminal: () => import("../terminal/TerminalApp.svelte"),
    devices: () => import("../DevicesPanel.svelte"),
    editor: () => import("../editor/CodeEditorApp.svelte"),
    docs: () => import("../docs/DocsApp.svelte"),
    workflows: () => import("../workflows/WorkflowsApp.svelte"),
    integrations: () => import("../integrations/IntegrationsView.svelte"),
    channels: () => import("../integrations/ChannelsView.svelte"),
    organization: () => import("../organization/OrganizationApp.svelte"),
    memory: () => import("../memory-graph/MemoryGraphApp.svelte"),
    store: () => import("../catalog/AppStoreView.svelte"),
    extensions: () => import("../catalog/ExtensionsView.svelte"),
    infra: () => import("../infra/InfrastructureView.svelte"),
    clipboard: () => import("./ClipboardPanel.svelte"),
    inspector: () => import("./InspectorPanel.svelte"),
    "agent-vault": () => import("../agent-vault/AgentVaultApp.svelte"),
    "agent-group": () => import("../agent-group/AgentGroupApp.svelte"),
    media: () => import("../media/MediaViewerApp.svelte"),
    pickers: () => import("../media/PickersApp.svelte"),
    "create-app": () => import("../create-app/CreateAppView.svelte"),
    camoufox: () => import("../runtime-apps/CamoufoxApp.svelte"),
    "bot-desktops": () => import("../runtime-apps/BotDesktopsApp.svelte"),
    n8n: () => import("../runtime-apps/N8nApp.svelte"),
    t3: () => import("../runtime-apps/T3Workspace.svelte"),
    "image-editor": () => import("../creative/ImageEditorApp.svelte"),
    "media-studio": () => import("../creative/MediaStudioApp.svelte"),
    "reel-editor": () => import("../creative/ReelEditorApp.svelte"),
  };

  const cache = new Map<string, Promise<AnySliceComponent>>();
  const ROLE_PROPS = new Set(["integrations", "channels", "store", "extensions", "infra", "agent-vault", "agent-group", "create-app", "camoufox", "bot-desktops"]);

  function getSlice(app: string): Promise<AnySliceComponent> | null {
    const loader = LOADERS[app];
    if (!loader) return null;
    let pending = cache.get(app);
    if (!pending) {
      pending = loader().then((mod) => mod.default as AnySliceComponent);
      cache.set(app, pending);
    }
    return pending;
  }

  function sliceProps(): Record<string, unknown> {
    if (win.app === "files") {
      return {
        winId: win.id,
        initialPath: typeof win.payload === "string" ? win.payload : "~",
        resolvedChrome,
        onPathChange: (path: string) => onFilesPathChange(win.id, path),
        onDirtyChange: (dirty: boolean) => onEditorDirtyChange(win.id, dirty),
        onMobileNavChange: (nav: MobileNavSpec | null) => onMobileNavChange?.(win.id, nav),
      };
    }
    if (win.app === "editor") {
      return {
        winId: win.id,
        initialPath: typeof win.payload === "string" ? win.payload : undefined,
        onDirtyChange: (dirty: boolean) => onEditorDirtyChange(win.id, dirty),
      };
    }
    if (win.app === "media" || win.app === "image-editor") return { initialPath: typeof win.payload === "string" ? win.payload : undefined };
    if (win.app === "settings") {
      return {
        winId: win.id,
        role: session.role,
        deviceLabel: session.deviceLabel,
        resolvedChrome,
        shellPrefs,
        wallpaper,
        onShellPrefsChange,
        onWallpaperChange,
        onThemeChange,
        onMobileNavChange: (nav: MobileNavSpec | null) => onMobileNavChange?.(win.id, nav),
      };
    }
    if (win.app === "shell-settings") {
      return {
        role: session.role,
        chromeChoice,
        shellPrefs,
        wallpaper,
        onChromeChange,
        onShellPrefsChange,
        onWallpaperChange,
        onThemeChange,
      };
    }
    if (win.app === "devices") return { currentDeviceId: session.deviceId };
    if (win.app === "memory") return { role: session.role, onOpenFile: onOpenInEditor };
    if (win.app === "inspector") return { layout, resolvedChrome, viewportWidth, role: session.role };
    if (ROLE_PROPS.has(win.app)) return { role: session.role };
    return {};
  }

  let promise = $derived(
    ((win.app === "devices" || win.app === "terminal") && session.role !== "owner")
    || (win.app === "t3" && !hasOperatorAccess(session.role)) ? null : getSlice(win.app),
  );
</script>

{#if promise}
  {#await promise}
    <p class="slice-loading" role="status">Loading {win.title}...</p>
  {:then SliceComponent}
    <SliceComponent {...sliceProps()} />
  {:catch}
    <p class="feedback error" role="alert">Could not load {win.title}. Retry or reopen the window.</p>
  {/await}
{:else}
  <p class="feedback pending">This app is unavailable for your current role.</p>
{/if}

<style>
  .slice-loading { margin: 0; color: var(--muted); font-size: 0.875rem; }
</style>
