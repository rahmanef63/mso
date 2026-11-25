<script lang="ts">
  import type { CommandItem } from "./command-palette.ts";
  import type { ChromeChoice, ChromeProfile } from "./chrome-profile.ts";
  import type { WindowState } from "./window-store.ts";
  import { createModalLoaderCache, type LazyModalKey } from "./lazy-modals-meta.ts";

  type ThemeChoice = "system" | "light" | "dark";

  type ModalComponentMap = {
    palette: typeof import("./CommandPalette.svelte").default;
    control: typeof import("./ControlCenter.svelte").default;
    forceQuit: typeof import("./ForceQuitModal.svelte").default;
    shortcuts: typeof import("./ShortcutHelp.svelte").default;
    lock: typeof import("./LockScreen.svelte").default;
  };

  let {
    paletteOpen, controlOpen, forceQuitOpen, shortcutsOpen, locked,
    commands, shortcuts, theme, chromeChoice, resolvedChrome, role, deviceLabel, openWindows,
    brightness = 74, volume = 42, nightShift = false, isDark = false,
    onClosePalette, onCloseControl, onCloseForceQuit, onCloseShortcuts,
    onThemeChange, onChromeChange, onBrightnessChange, onVolumeChange, onNightShiftChange,
    onLock, onUnlock, onOpenForceQuit,
    onForceClose, onCloseAll, onSignOut,
  }: {
    paletteOpen: boolean;
    controlOpen: boolean;
    forceQuitOpen: boolean;
    shortcutsOpen: boolean;
    locked: boolean;
    commands: CommandItem[];
    shortcuts: ReadonlyArray<{ keys: string; description: string }>;
    theme: string;
    chromeChoice: ChromeChoice;
    resolvedChrome: ChromeProfile;
    role: string | null;
    deviceLabel: string | null;
    openWindows: readonly WindowState[];
    brightness?: number;
    volume?: number;
    nightShift?: boolean;
    isDark?: boolean;
    onClosePalette: () => void;
    onCloseControl: () => void;
    onCloseForceQuit: () => void;
    onCloseShortcuts: () => void;
    onThemeChange: (t: ThemeChoice) => void;
    onChromeChange: (c: ChromeChoice) => void;
    onBrightnessChange?: (v: number) => void;
    onVolumeChange?: (v: number) => void;
    onNightShiftChange?: (v: boolean) => void;
    onLock: () => void;
    onUnlock: () => void;
    onOpenForceQuit: () => void;
    onForceClose: (id: string) => void;
    onCloseAll: () => void;
    onSignOut: () => void;
  } = $props();

  const MODAL_LOADERS: { [K in LazyModalKey]: () => Promise<ModalComponentMap[K]> } = {
    palette: () => import("./CommandPalette.svelte").then((mod) => mod.default),
    control: () => import("./ControlCenter.svelte").then((mod) => mod.default),
    forceQuit: () => import("./ForceQuitModal.svelte").then((mod) => mod.default),
    shortcuts: () => import("./ShortcutHelp.svelte").then((mod) => mod.default),
    lock: () => import("./LockScreen.svelte").then((mod) => mod.default),
  };

  const modalCache = createModalLoaderCache<ModalComponentMap[LazyModalKey]>();

  let view = $state<{
    loaded: Partial<ModalComponentMap>;
    failed: Partial<Record<LazyModalKey, boolean>>;
  }>({ loaded: {}, failed: {} });

  function ensureLoaded<K extends LazyModalKey>(key: K) {
    const cached = modalCache.getResolved(key);
    if (cached) {
      if (!view.loaded[key]) view.loaded[key] = cached as ModalComponentMap[K];
      view.failed[key] = false;
      return;
    }
    view.failed[key] = false;
    void modalCache
      .load(key, MODAL_LOADERS[key])
      .then((comp) => {
        view.loaded[key] = comp as ModalComponentMap[K];
      })
      .catch(() => {
        view.failed[key] = true;
      });
  }

  $effect(() => {
    if (paletteOpen) ensureLoaded("palette");
    else if (view.failed.palette) view.failed.palette = false;
  });
  $effect(() => {
    if (controlOpen) ensureLoaded("control");
    else if (view.failed.control) view.failed.control = false;
  });
  $effect(() => {
    if (forceQuitOpen) ensureLoaded("forceQuit");
    else if (view.failed.forceQuit) view.failed.forceQuit = false;
  });
  $effect(() => {
    if (shortcutsOpen) ensureLoaded("shortcuts");
    else if (view.failed.shortcuts) view.failed.shortcuts = false;
  });
  $effect(() => {
    if (locked) ensureLoaded("lock");
    else if (view.failed.lock) view.failed.lock = false;
  });
</script>

{#snippet loadError(key: LazyModalKey, label: string, onDismiss: () => void)}
  <div class="lazy-modal-error" role="alert">
    <p>Could not load {label}.</p>
    <div class="lazy-modal-error-actions">
      <button type="button" onclick={() => ensureLoaded(key)}>Retry</button>
      <button type="button" onclick={onDismiss}>Close</button>
    </div>
  </div>
{/snippet}

{#if paletteOpen}
  {#if view.loaded.palette}
    {@const Palette = view.loaded.palette}
    <Palette open={paletteOpen} items={commands} onClose={onClosePalette} />
  {:else if view.failed.palette}
    {@render loadError("palette", "Command palette", onClosePalette)}
  {/if}
{/if}

{#if controlOpen}
  {#if view.loaded.control}
    {@const Control = view.loaded.control}
    <Control
      open={controlOpen}
      {theme}
      {chromeChoice}
      {resolvedChrome}
      {role}
      openWindowCount={openWindows.length}
      {brightness}
      {volume}
      {nightShift}
      {isDark}
      {onThemeChange}
      {onChromeChange}
      {onBrightnessChange}
      {onVolumeChange}
      {onNightShiftChange}
      {onLock}
      {onOpenForceQuit}
      onClose={onCloseControl}
    />
  {:else if view.failed.control}
    {@render loadError("control", "Control Center", onCloseControl)}
  {/if}
{/if}

{#if forceQuitOpen}
  {#if view.loaded.forceQuit}
    {@const ForceQuit = view.loaded.forceQuit}
    <ForceQuit
      open={forceQuitOpen}
      windows={openWindows}
      {onForceClose}
      {onCloseAll}
      onClose={onCloseForceQuit}
    />
  {:else if view.failed.forceQuit}
    {@render loadError("forceQuit", "Force quit dialog", onCloseForceQuit)}
  {/if}
{/if}

{#if shortcutsOpen}
  {#if view.loaded.shortcuts}
    {@const Shortcuts = view.loaded.shortcuts}
    <Shortcuts open={shortcutsOpen} {shortcuts} onClose={onCloseShortcuts} />
  {:else if view.failed.shortcuts}
    {@render loadError("shortcuts", "Keyboard shortcuts", onCloseShortcuts)}
  {/if}
{/if}

{#if locked}
  {#if view.loaded.lock}
    {@const Lock = view.loaded.lock}
    <Lock {locked} {deviceLabel} {role} {onUnlock} {onSignOut} />
  {:else if view.failed.lock}
    {@render loadError("lock", "Lock screen", onUnlock)}
  {/if}
{/if}

<style>
  .lazy-modal-error {
    position: fixed; right: 1rem; bottom: 1rem; z-index: 105;
    display: grid; gap: 0.5rem; padding: 0.75rem 1rem;
    background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 0.5rem;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.24);
  }
  .lazy-modal-error p { margin: 0; font-size: 0.875rem; }
  .lazy-modal-error-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
</style>
