<script lang="ts">
  import "./SettingsApp.css";
  import { onMount, untrack } from "svelte";
  import { fly } from "svelte/transition";
  import {
    createPrefsController,
    isSafeQuicklinkUrl,
    type PrefTweaks,
    type PrefsState,
    type Quicklink,
    type ThemeMode,
  } from "./prefs-api.ts";
  import AccountOnboardingCard from "../auth/AccountOnboardingCard.svelte";
  import SoftwareUpdateCard from "./SoftwareUpdateCard.svelte";
  import AuditLogCard from "./AuditLogCard.svelte";
  import AiModelsSection from "./AiModelsSection.svelte";
  import McpSection from "./McpSection.svelte";
  import MemorySection from "./MemorySection.svelte";
  import SystemSection from "./SystemSection.svelte";
  import AboutSection from "./AboutSection.svelte";
  import ThemePresetGallery from "./ThemePresetGallery.svelte";
  import AppleSegmented from "../shell/AppleSegmented.svelte";
  import AppleAccentPicker from "../shell/AppleAccentPicker.svelte";
  import AppleSwitch from "../shell/AppleSwitch.svelte";
  import { applyThemePresetToDom } from "./theme-presets.ts";
  import { CHROME_PROFILES, isChromeChoice, type ChromeChoice, type ChromeProfile } from "../shell/chrome-profile.ts";
  import { designProfileFor, type MobileNavSpec } from "../shell/shell-design.ts";
  import {
    applyAppearanceToDom,
    buildShellTweaksPatch,
    DEFAULT_SHELL_PREFS,
    isDesktopShell,
    isIosStyleVariant,
    isMobileShell,
    type ShellPrefs,
  } from "../shell/shell-prefs-store.ts";
  import { isWallpaperId, WALLPAPERS, type WallpaperId } from "../shell/wallpaper-store.ts";
  import { getWinState, setWinState } from "../shell/window-feature-state.ts";

  type SettingsSectionId =
  | "appearance" | "models" | "mcp" | "memory" | "system"
  | "quicklinks" | "account" | "updates" | "audit" | "about";

  type SectionMeta = {
    id: SettingsSectionId;
    label: string;
    subtitle: string;
    icon: string;
    tint: string;
  };

  const SECTIONS: readonly SectionMeta[] = [
    { id: "appearance", label: "Appearance & Shell", subtitle: "OS shell, theme, wallpaper, accessibility", icon: "g-moon", tint: "#2563eb" },
    { id: "quicklinks", label: "Quicklinks", subtitle: "Saved bookmarks and workspace shortcuts", icon: "g-share", tint: "#0e7490" },
    { id: "models", label: "AI Models", subtitle: "Providers, BYOK keys, catalog, and connection tests", icon: "g-sliders", tint: "#db2777" },
    { id: "mcp", label: "MCP Servers", subtitle: "Model Context Protocol servers, toolsets, and scopes", icon: "g-globe", tint: "#0f766e" },
    { id: "memory", label: "Memory", subtitle: "Agent memory stores, retention, and retrieval", icon: "g-clock", tint: "#9333ea" },
    { id: "system", label: "System & Storage", subtitle: "Cleanup, federation workers, update automation", icon: "g-disk", tint: "#b45309" },
    { id: "account", label: "Account & Device", subtitle: "Role, onboarding, and pairing status", icon: "g-people", tint: "#7c3aed" },
    { id: "updates", label: "Software Update", subtitle: "Version status and release channel", icon: "g-download", tint: "#047857" },
    { id: "audit", label: "Audit Log", subtitle: "Recent host actions and security events", icon: "g-lock", tint: "#a16207" },
    { id: "about", label: "About", subtitle: "Version, changelog, and build provenance", icon: "g-info", tint: "#475569" },
  ];

  const THEME_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  let {
    winId,
    role = null,
    deviceLabel = null,
    resolvedChrome = "macos",
    shellPrefs = { ...DEFAULT_SHELL_PREFS },
    wallpaper = "auto",
    onShellPrefsChange,
    onWallpaperChange,
    onThemeChange,
    onMobileNavChange,
  }: {
    winId?: string;
    role?: "viewer" | "operator" | "owner" | null;
    deviceLabel?: string | null;
    resolvedChrome?: ChromeProfile;
    shellPrefs?: ShellPrefs;
    wallpaper?: WallpaperId;
    onShellPrefsChange?: (prefs: ShellPrefs) => void;
    onWallpaperChange?: (w: WallpaperId) => void;
    onThemeChange?: (theme: string) => void;
    onMobileNavChange?: (nav: MobileNavSpec | null) => void;
  } = $props();

  let design = $derived(designProfileFor(resolvedChrome));
  let navMode = $derived(design.settingsNavigation);
  let isMobileStack = $derived(navMode === "ios-stack" || navMode === "android-list");

  let activeSection = $state<SettingsSectionId | null>(null);
  let query = $state("");
  let sidebarOpen = $state(false);
  let view = $state<PrefsState>({ kind: "loading" });
  let newTitle = $state("");
  let newUrl = $state("");
  let formError = $state<string | null>(null);
  let confirmRemoveId = $state<string | null>(null);
  let lastNotifiedTheme: string | null = null;
  let controller: ReturnType<typeof createPrefsController> | undefined;

  let isOwner = $derived(role === "owner");
  let tweaks = $derived<PrefTweaks>(view.kind === "ready" ? (view.prefs.tweaks ?? {}) : {});
  let themeMode = $derived<ThemeMode>(
    tweaks.theme === "light" || tweaks.theme === "dark" ? tweaks.theme : "system",
  );
  let activeWallpaper = $derived<WallpaperId>(
    isWallpaperId(tweaks.wallpaper) ? tweaks.wallpaper : wallpaper,
  );
  let reducedMotion = $derived<boolean>(Boolean(tweaks.reducedMotion));
  let reduceGlass = $derived<boolean>(Boolean(tweaks.reduceGlass));
  let highContrast = $derived<boolean>(Boolean(tweaks.highContrast));
  let activeAccent = $derived<string>(
    typeof tweaks.accent === "string" && /^#[0-9a-f]{6}$/i.test(tweaks.accent) ? tweaks.accent : "#0a84ff",
  );
  let quicklinks = $derived<Quicklink[]>(view.kind === "ready" ? (view.prefs.quicklinks ?? []) : []);

  let filteredSections = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(
      (s) => s.label.toLowerCase().includes(q) || s.subtitle.toLowerCase().includes(q),
    );
  });

  let effectiveDesktopSection = $derived<SettingsSectionId>(activeSection ?? "appearance");
  let activeMeta = $derived(SECTIONS.find((s) => s.id === (isMobileStack ? activeSection : effectiveDesktopSection)) ?? SECTIONS[0]);
  let themeModeLabel = $derived(
    themeMode === "light" ? "Light" : themeMode === "dark" ? "Dark" : "System",
  );
  let roleLabel = $derived(role ? role[0].toUpperCase() + role.slice(1) : null);
  let updateChannelLabel = $derived(
    view.kind === "ready"
      ? (view.prefs.updates?.channel === "main" ? "Main" : "Stable")
      : null,
  );
  let sectionValues = $derived<Partial<Record<SettingsSectionId, string>>>({
    appearance: themeModeLabel,
    account: roleLabel ?? undefined,
    updates: updateChannelLabel ?? undefined,
  });

  function selectSection(next: SettingsSectionId | null) {
    activeSection = next;
    sidebarOpen = false;
    setWinState(winId, "settings.section", next);
  }

  $effect(() => {
    const mobile = isMobileStack;
    const section = activeSection;
    untrack(() => {
      if (!onMobileNavChange) return;
      if (mobile && section) {
        const meta = SECTIONS.find((s) => s.id === section);
        onMobileNavChange({
          title: meta?.label ?? "Settings",
          backLabel: "Settings",
          onBack: () => selectSection(null),
        });
      } else {
        onMobileNavChange(null);
      }
    });
  });

  function notifyTheme(theme: ThemeMode) {
    if (lastNotifiedTheme !== theme) {
      lastNotifiedTheme = theme;
      onThemeChange?.(theme);
    }
  }

  export function refresh() {
    confirmRemoveId = null;
    formError = null;
    void controller?.refresh();
  }

  async function savePatch(patch: PrefTweaks, after?: () => void) {
    if (!isOwner) return;
    if (await controller?.saveTweaks(patch)) after?.();
  }

  function updateShell(next: ShellPrefs) {
    onShellPrefsChange?.(next);
    if (isOwner) {
      void savePatch(buildShellTweaksPatch(next, tweaks));
    }
  }

  function handleDesktopShell(event: Event) {
    const val = (event.currentTarget as HTMLSelectElement).value;
    if (isDesktopShell(val)) updateShell({ ...shellPrefs, desktop: val });
  }

  function handleMobileShell(event: Event) {
    const val = (event.currentTarget as HTMLSelectElement).value;
    if (isMobileShell(val)) updateShell({ ...shellPrefs, mobile: val });
  }

  function handleOverrideShell(event: Event) {
    const val = (event.currentTarget as HTMLSelectElement).value;
    if (isChromeChoice(val)) updateShell({ ...shellPrefs, override: val });
  }

  function handleIosStyle(event: Event) {
    const val = (event.currentTarget as HTMLSelectElement).value;
    if (isIosStyleVariant(val)) updateShell({ ...shellPrefs, iosStyle: val });
  }

  function handlePresetSelect(presetName: string | null) {
    applyThemePresetToDom(presetName);
    void savePatch({ preset: presetName });
  }

  function handleThemeChange(nextTheme: ThemeMode) {
    applyAppearanceToDom({ theme: nextTheme });
    notifyTheme(nextTheme);
    void savePatch({ theme: nextTheme });
  }

  function handleAccentChange(hex: string) {
    applyAccentToDom(hex);
    void savePatch({ accent: hex });
  }

  function applyAccentToDom(hex: string | null | undefined) {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex)) root.style.setProperty("--tint", hex);
    else root.style.removeProperty("--tint");
  }

  function handleWallpaperChange(event: Event) {
    const val = (event.currentTarget as HTMLSelectElement).value;
    if (!isWallpaperId(val)) return;
    onWallpaperChange?.(val);
    void savePatch({ wallpaper: val });
  }

  function handleA11yToggle(key: "reduceGlass" | "highContrast" | "reducedMotion", checked: boolean) {
    applyAppearanceToDom({ [key]: checked });
    void savePatch({ [key]: checked });
  }

  async function handleAddQuicklink(event: SubmitEvent) {
    event.preventDefault();
    formError = null;
    if (!isSafeQuicklinkUrl(newUrl)) {
      formError = "Enter a valid http:// or https:// URL.";
      return;
    }
    if (await controller?.addQuicklink(newTitle, newUrl)) {
      newTitle = "";
      newUrl = "";
    }
  }

  function confirmRemove(id: string) {
    confirmRemoveId = null;
    void controller?.removeQuicklink(id);
  }

  onMount(() => {
    activeSection = getWinState<SettingsSectionId | null>(winId, "settings.section", null);
    controller = createPrefsController((next) => {
      if (next.kind !== "ready") confirmRemoveId = null;
      else if (next.prefs.tweaks?.theme) notifyTheme(next.prefs.tweaks.theme);
      view = next;
    });
    void controller.refresh();
    return () => {
      onMobileNavChange?.(null);
      controller?.dispose();
    };
  });
</script>

{#snippet sectionContent(section: SettingsSectionId)}
  {#if section === "account"}
    <div class="detail-body"><AccountOnboardingCard {role} {deviceLabel} /></div>
  {:else if section === "updates"}
    <div class="detail-body"><SoftwareUpdateCard {role} /></div>
  {:else if section === "audit"}
    <div class="detail-body"><AuditLogCard {role} /></div>
  {:else if section === "models"}
    <div class="detail-body"><AiModelsSection {role} /></div>
  {:else if section === "mcp"}
    <div class="detail-body"><McpSection {role} /></div>
  {:else if section === "memory"}
    <div class="detail-body"><MemorySection {role} /></div>
  {:else if section === "system"}
    <div class="detail-body"><SystemSection {role} /></div>
  {:else if section === "about"}
    <div class="detail-body"><AboutSection {role} {deviceLabel} resolvedChrome={resolvedChrome} /></div>
  {:else}
    {#if !isOwner}
      <p class="feedback pending">Local shell preferences save on this device. Owner role is required to sync shared workspace settings.</p>
    {/if}
    <div role="status" aria-live="polite">
      {#if view.kind === "loading"}
        <p class="status-msg">Loading workspace preferences...</p>
      {:else if view.kind === "error"}
        <div class="feedback error" role="alert">
          <p>{view.message}</p>
          <button type="button" onclick={refresh}>Retry</button>
        </div>
      {:else}
        {#if view.notice}<p class="feedback ok">{view.notice}</p>{/if}
        {#if view.actionError}<p class="feedback error" role="alert">{view.actionError}</p>{/if}

        {#if section === "appearance"}
          <div class="settings-card">
            <h3 class="card-heading">Shell &amp; Display</h3>
            <div class="settings-grid">
              <div class="field">
                <label for="settings-desktop-shell">Desktop shell</label>
                <select id="settings-desktop-shell" value={shellPrefs.desktop} onchange={handleDesktopShell}>
                  <option value="macos">macOS</option>
                  <option value="windows">Windows</option>
                  <option value="dashboard">Dashboard</option>
                </select>
              </div>
              <div class="field">
                <label for="settings-mobile-shell">Mobile shell</label>
                <select id="settings-mobile-shell" value={shellPrefs.mobile} onchange={handleMobileShell}>
                  <option value="ios">iOS</option>
                  <option value="android">Android</option>
                </select>
              </div>
              <div class="field">
                <label for="settings-shell-override">Shell override</label>
                <select id="settings-shell-override" value={shellPrefs.override} onchange={handleOverrideShell}>
                  <option value="auto">Auto (match screen size)</option>
                  {#each CHROME_PROFILES as p (p.id)}
                    <option value={p.id}>Pin {p.label}</option>
                  {/each}
                </select>
              </div>
              <div class="field">
                <label for="settings-ios-style">iOS presentation</label>
                <select id="settings-ios-style" value={shellPrefs.iosStyle} onchange={handleIosStyle}>
                  <option value="classic">iOS Classic</option>
                  <option value="modern">iOS Modern</option>
                </select>
              </div>
            </div>
          </div>

          <div class="settings-card">
            <h3 class="card-heading">Theme Presets</h3>
            <ThemePresetGallery
              activePreset={view.prefs.tweaks?.preset ?? null}
              disabled={!isOwner || view.saving}
              onSelect={handlePresetSelect}
            />
          </div>

          <div class="settings-card">
            <h3 class="card-heading">Theme &amp; Accessibility</h3>
            <div class="settings-grid">
              <div class="field field-wide">
                <span class="field-label" id="settings-theme-label">Theme mode</span>
                <AppleSegmented
                  options={THEME_OPTIONS}
                  value={themeMode}
                  ariaLabel="Theme mode"
                  disabled={!isOwner || view.saving}
                  onChange={(next) => handleThemeChange(next as ThemeMode)}
                />
              </div>
              <div class="field field-wide">
                <span class="field-label" id="settings-accent-label">Accent color</span>
                <AppleAccentPicker
                  value={activeAccent}
                  disabled={!isOwner || view.saving}
                  onChange={handleAccentChange}
                />
              </div>
              <div class="field">
                <label for="settings-wallpaper">Wallpaper</label>
                <select
                  id="settings-wallpaper"
                  value={activeWallpaper}
                  disabled={!isOwner || view.saving}
                  onchange={handleWallpaperChange}
                >
                  {#each WALLPAPERS as wp (wp.id)}
                    <option value={wp.id}>{wp.label}</option>
                  {/each}
                </select>
              </div>
            </div>

            <div class="toggle-list">
              <div class="toggle-row">
                <span>Reduce glass transparency</span>
                <AppleSwitch
                  id="settings-reduce-glass"
                  checked={reduceGlass}
                  disabled={!isOwner || view.saving}
                  ariaLabel="Reduce glass transparency"
                  onChange={(next) => handleA11yToggle("reduceGlass", next)}
                />
              </div>
              <div class="toggle-row">
                <span>High contrast borders and text</span>
                <AppleSwitch
                  id="settings-high-contrast"
                  checked={highContrast}
                  disabled={!isOwner || view.saving}
                  ariaLabel="High contrast borders and text"
                  onChange={(next) => handleA11yToggle("highContrast", next)}
                />
              </div>
              <div class="toggle-row">
                <span>Reduce motion</span>
                <AppleSwitch
                  id="settings-reduced-motion"
                  checked={reducedMotion}
                  disabled={!isOwner || view.saving}
                  ariaLabel="Reduce motion"
                  onChange={(next) => handleA11yToggle("reducedMotion", next)}
                />
              </div>
            </div>
          </div>
        {:else if section === "quicklinks"}
          <div class="settings-card">
            <h3 class="card-heading">Quicklinks ({quicklinks.length})</h3>
            {#if quicklinks.length === 0}
              <p class="status-msg">No quicklinks saved yet.</p>
            {:else}
              <ul class="ql-list" aria-label="Saved quicklinks">
                {#each quicklinks as item (item.id)}
                  <li class="ql-row">
                    <a class="ql-link" href={item.url} target="_blank" rel="noopener noreferrer">
                      <strong>{item.title}</strong>
                      <span>{item.url}</span>
                    </a>
                    {#if isOwner}
                      <div class="ql-actions">
                        {#if confirmRemoveId === item.id}
                          <button type="button" class="danger" disabled={view.saving} onclick={() => confirmRemove(item.id)}>Confirm remove</button>
                          <button type="button" disabled={view.saving} onclick={() => { confirmRemoveId = null; }}>Cancel</button>
                        {:else}
                          <button type="button" disabled={view.saving} onclick={() => { confirmRemoveId = item.id; }}>Remove</button>
                        {/if}
                      </div>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
            {#if isOwner}
              <form class="ql-form" onsubmit={(e) => void handleAddQuicklink(e)} novalidate>
                <div class="field">
                  <label for="quicklink-title">Title</label>
                  <input id="quicklink-title" type="text" bind:value={newTitle} disabled={view.saving} placeholder="Docs" />
                </div>
                <div class="field">
                  <label for="quicklink-url">URL</label>
                  <input id="quicklink-url" type="url" bind:value={newUrl} disabled={view.saving} placeholder="https://example.com" required />
                </div>
                {#if formError}<p class="feedback error" role="alert">{formError}</p>{/if}
                <div class="actions">
                  <button type="submit" class="primary" disabled={view.saving}>
                    {view.saving ? "Saving..." : "Add quicklink"}
                  </button>
                </div>
              </form>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  {/if}
{/snippet}

<section
  class="settings-root"
  data-settings-state={view.kind}
  data-settings-variant={navMode}
  data-shell-family={design.family}
  aria-label="Settings"
  aria-busy={view.kind === "loading"}
>
  {#if navMode === "ios-stack"}
    <!-- iOS: two-level inset grouped stack; shell MobileAppBar owns title & Back -->
    <div class="ios-settings-wrap">
      {#key activeSection}
        {#if activeSection === null}
          <div class="ios-root-pane" in:fly={{ x: -24, duration: 220 }}>
            <h1 class="ios-large-title">Settings</h1>
            <div class="ios-search-wrap">
              <label class="sr-only" for="ios-settings-search">Search settings</label>
              <input id="ios-settings-search" class="ios-search-input" type="search" bind:value={query} placeholder="Search" />
            </div>
            <nav class="ios-inset-group" aria-label="Settings sections">
              {#each filteredSections as sec (sec.id)}
                <button type="button" class="ios-group-row" data-settings-section={sec.id} onclick={() => selectSection(sec.id)}>
                  <span class="ios-row-icon" style:background={sec.tint} aria-hidden="true">
                    <svg class="ios-row-glyph" viewBox="0 0 24 24"><use href={`#${sec.icon}`} /></svg>
                  </span>
                  <span class="ios-row-label">{sec.label}</span>
                  <span class="ios-row-chevron" aria-hidden="true">&#8250;</span>
                </button>
              {/each}
            </nav>
          </div>
        {:else}
          <div class="ios-detail-pane" in:fly={{ x: 28, duration: 220 }}>
            <h1 class="ios-large-title">{activeMeta.label}</h1>
            {@render sectionContent(activeSection)}
          </div>
        {/if}
      {/key}
    </div>
  {:else if navMode === "android-list"}
    <!-- Android: Material You expressive list with tonal circular icons & subtitles -->
    <div class="android-settings-wrap">
      {#if activeSection === null}
        <div class="m3-search-wrap">
          <label class="sr-only" for="m3-settings-search">Search settings</label>
          <input id="m3-settings-search" class="m3-search-input" type="search" bind:value={query} placeholder="Search settings" />
        </div>
        <nav class="m3-settings-list" aria-label="Settings sections">
          {#each filteredSections as sec (sec.id)}
            <button type="button" class="m3-list-row" data-settings-section={sec.id} onclick={() => selectSection(sec.id)}>
              <span class="m3-tonal-icon" style:--m3-tint={sec.tint} aria-hidden="true">
                <svg class="m3-tonal-glyph" viewBox="0 0 24 24"><use href={`#${sec.icon}`} /></svg>
              </span>
              <span class="m3-row-copy">
                <span class="m3-row-title">{sec.label}</span>
                <span class="m3-row-sub">{sec.subtitle}</span>
              </span>
            </button>
          {/each}
        </nav>
      {:else}
        <div class="m3-detail-pane">
          {@render sectionContent(activeSection)}
        </div>
      {/if}
    </div>
  {:else if navMode === "macos-sidebar" || navMode === "windows-rail"}
    <!-- Desktop split view: macOS translucent sidebar vs Windows Fluent NavigationView rail -->
    <div
      class="split-settings"
      class:is-windows={navMode === "windows-rail"}
      class:is-macos={navMode === "macos-sidebar"}
      class:nav-open={sidebarOpen}
    >
      <aside class="settings-sidebar" class:open={sidebarOpen} aria-label="Settings navigation">
        <button
          type="button"
          class="sidebar-narrow-close"
          onclick={() => { sidebarOpen = false; }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#g-chevron-left" /></svg>
          Done
        </button>
        <div class="sidebar-search">
          <label class="sr-only" for="desktop-settings-search">Search settings</label>
          <input id="desktop-settings-search" type="search" bind:value={query} placeholder={navMode === "windows-rail" ? "Find a setting" : "Search"} />
        </div>
        <nav class="sidebar-nav" id="settings-narrow-list" aria-label="Settings sections">
          {#each filteredSections as sec (sec.id)}
            {@const selected = effectiveDesktopSection === sec.id}
            <button
              type="button"
              class="sidebar-item"
              class:active={selected}
              aria-current={selected ? "page" : undefined}
              data-settings-section={sec.id}
              onclick={() => selectSection(sec.id)}
            >
              {#if navMode === "windows-rail"}
                <span class="win-nav-indicator" aria-hidden="true"></span>
              {/if}
              <span class="sidebar-glyph" style:--glyph-tint={sec.tint} aria-hidden="true">
                <svg class="sidebar-glyph-svg" viewBox="0 0 24 24"><use href={`#${sec.icon}`} /></svg>
              </span>
              <span class="sidebar-label">{sec.label}</span>
              {#if sectionValues[sec.id]}
                <span class="sidebar-value">{sectionValues[sec.id]}</span>
              {/if}
              <svg class="sidebar-chevron" viewBox="0 0 24 24" aria-hidden="true"><use href="#g-chevron-right" /></svg>
            </button>
          {/each}
          {#if filteredSections.length === 0}
            <p class="sidebar-empty">No settings match "{query.trim()}".</p>
          {/if}
        </nav>
      </aside>

      <div class="settings-main">
        <header class="split-header">
          <div class="split-title-group">
            <button
              type="button"
              class="narrow-nav-toggle"
              aria-expanded={sidebarOpen}
              aria-controls="settings-narrow-list"
              onclick={() => { sidebarOpen = !sidebarOpen; }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#g-chevron-left" /></svg>
              Sections
            </button>
            {#if navMode === "windows-rail"}
              <p class="win-crumb">Settings &gt; <strong>{activeMeta.label}</strong></p>
            {:else}
              <h2 class="macos-section-title">{activeMeta.label}</h2>
            {/if}
          </div>
          {#if effectiveDesktopSection !== "mcp"}
            <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
              {view.kind === "loading" ? "Loading..." : "Refresh"}
            </button>
          {/if}
        </header>
        <div class="split-detail">
          {@render sectionContent(effectiveDesktopSection)}
        </div>
      </div>
    </div>
  {:else}
    <!-- Dashboard: dense operational cockpit tab strip -->
    <div class="dash-settings">
      <header class="feature-header dash-settings-head">
        <h2>Settings</h2>
        {#if effectiveDesktopSection !== "mcp"}
          <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
            {view.kind === "loading" ? "Loading..." : "Refresh"}
          </button>
        {/if}
      </header>
      <div class="dash-tabs" role="tablist" aria-label="Settings sections">
        {#each SECTIONS as sec (sec.id)}
          <button
            type="button"
            role="tab"
            class="dash-tab"
            aria-selected={effectiveDesktopSection === sec.id}
            class:active={effectiveDesktopSection === sec.id}
            data-settings-section={sec.id}
            onclick={() => selectSection(sec.id)}
          >
            {sec.label}
          </button>
        {/each}
      </div>
      <div class="dash-detail">
        {@render sectionContent(effectiveDesktopSection)}
      </div>
    </div>
  {/if}
</section>
