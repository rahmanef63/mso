<script lang="ts">
  import { visibleDesktopIcons, type DesktopIconDef } from "./desktop-icons-data.ts";
  import { resolveAppIcon } from "./app-icons.ts";
  import type { ChromeProfile } from "./chrome-profile.ts";

  let {
    role = null,
    chrome = "macos",
    onOpenApp,
  }: {
    role?: "viewer" | "operator" | "owner" | null;
    chrome?: ChromeProfile;
    onOpenApp: (app: string, title: string, payload?: unknown, multi?: boolean) => void;
  } = $props();

  let icons = $derived<DesktopIconDef[]>(visibleDesktopIcons(role));

  function openIcon(icon: DesktopIconDef) {
    onOpenApp(icon.app, icon.title, icon.payload, icon.multi);
  }
</script>

<div
  class="desktop-icons"
  role="region"
  aria-label="Desktop shortcuts"
  data-icon-count={icons.length}
>
  <header class="desktop-icons-header">
    <h2>Applications</h2>
    <span class="desktop-icons-count">{icons.length} apps</span>
  </header>

  <ul class="desktop-icons-grid" role="list">
    {#each icons as icon (icon.app)}
      {@const visual = resolveAppIcon(icon.app, chrome)}
      <li class="desktop-icon-cell">
        <button
          type="button"
          class="desktop-icon-tile"
          data-app={icon.app}
          aria-label={`Open ${icon.title}`}
          onclick={() => openIcon(icon)}
        >
          <span class="desktop-icon-art" style:background={visual.gradient} aria-hidden="true">
            {#if visual.image}
              <img src={visual.image} alt="" loading="lazy" width="44" height="44" />
            {:else}
              <span class="desktop-icon-badge">{icon.badge}</span>
            {/if}
          </span>
          <span class="desktop-icon-label">{icon.title}</span>
          {#if icon.ownerOnly}
            <span class="desktop-icon-tag">Owner</span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
</div>

<style>
  .desktop-icons {
    display: grid;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    background: color-mix(in srgb, var(--panel) 74%, transparent);
    backdrop-filter: blur(var(--blur)) saturate(160%);
    -webkit-backdrop-filter: blur(var(--blur)) saturate(160%);
    border: 1px solid var(--glass-border);
    border-radius: 1rem;
    box-shadow: var(--shadow-pop);
    min-width: 0;
  }

  .desktop-icons-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .desktop-icons-header h2 {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text);
  }

  .desktop-icons-count {
    font-size: 0.75rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .desktop-icons-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(5.75rem, 100%), 1fr));
    gap: 0.5rem;
    min-width: 0;
  }

  .desktop-icon-cell {
    min-width: 0;
  }

  .desktop-icon-tile {
    width: 100%;
    min-height: 5.5rem;
    padding: 0.5rem 0.375rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    text-align: center;
    background: transparent;
    color: var(--text);
    border: 1px solid transparent;
    border-radius: 0.75rem;
    transition: border-color 120ms ease, background-color 120ms ease, transform 120ms ease;
  }

  .desktop-icon-tile:hover {
    border-color: var(--glass-border);
    background: color-mix(in srgb, var(--panel-solid) 68%, transparent);
    transform: translateY(-2px);
  }

  .desktop-icon-tile:active {
    transform: translateY(0);
  }

  .desktop-icon-art {
    width: 2.85rem;
    height: 2.85rem;
    border-radius: 22%;
    overflow: hidden;
    display: grid;
    place-items: center;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.24);
    flex-shrink: 0;
  }

  .desktop-icon-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .desktop-icon-badge {
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #ffffff;
  }

  .desktop-icon-label {
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .desktop-icon-tag {
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
</style>
