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
              <img src={visual.image} alt="" loading="lazy" width="48" height="48" />
            {:else}
              <span class="desktop-icon-badge">{icon.badge}</span>
            {/if}
          </span>
          <span class="desktop-icon-label">{icon.title}</span>
        </button>
      </li>
    {/each}
  </ul>
</div>

<style>
  .desktop-icons {
    min-width: 0;
    width: 100%;
  }

  .desktop-icons-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(5.25rem, 100%), 1fr));
    gap: 0.5rem 0.375rem;
    min-width: 0;
  }

  .desktop-icon-cell {
    min-width: 0;
  }

  .desktop-icon-tile {
    width: 100%;
    min-height: 5.25rem;
    padding: 0.4rem 0.25rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 0.35rem;
    text-align: center;
    background: transparent;
    color: #ffffff;
    border: 1px solid transparent;
    border-radius: 0.625rem;
    transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease;
  }

  .desktop-icon-tile:hover {
    background: rgba(255, 255, 255, 0.16);
    border-color: rgba(255, 255, 255, 0.28);
    backdrop-filter: blur(8px);
  }

  .desktop-icon-tile:active {
    transform: scale(0.96);
  }

  .desktop-icon-art {
    width: 3rem;
    height: 3rem;
    border-radius: 22%;
    overflow: hidden;
    display: grid;
    place-items: center;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.34);
    flex-shrink: 0;
  }

  .desktop-icon-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .desktop-icon-badge {
    font-size: 0.875rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #ffffff;
  }

  .desktop-icon-label {
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1.2;
    color: #ffffff;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85), 0 0 8px rgba(0, 0, 0, 0.55);
    overflow-wrap: anywhere;
  }
</style>
