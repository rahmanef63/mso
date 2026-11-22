<script lang="ts">
  import { visibleDesktopIcons, type DesktopIconDef } from "./desktop-icons-data.ts";

  let {
    role = null,
    onOpenApp,
  }: {
    role?: "viewer" | "operator" | "owner" | null;
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
    <h2>Desktop shortcuts</h2>
    <span class="desktop-icons-count">{icons.length} apps</span>
  </header>

  <ul class="desktop-icons-grid" role="list">
    {#each icons as icon (icon.app)}
      <li class="desktop-icon-cell">
        <button
          type="button"
          class="desktop-icon-tile"
          data-app={icon.app}
          aria-label={`Open ${icon.title}`}
          onclick={() => openIcon(icon)}
        >
          <span class="desktop-icon-badge" aria-hidden="true">{icon.badge}</span>
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
    padding: 1rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 0.625rem;
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
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text);
  }

  .desktop-icons-count {
    font-size: 0.8125rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .desktop-icons-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(6.75rem, 100%), 1fr));
    gap: 0.625rem;
    min-width: 0;
  }

  .desktop-icon-cell {
    min-width: 0;
  }

  .desktop-icon-tile {
    width: 100%;
    min-height: 5.25rem;
    padding: 0.625rem 0.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    text-align: center;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    transition: border-color 120ms ease, background-color 120ms ease, transform 120ms ease;
  }

  .desktop-icon-tile:hover {
    border-color: var(--accent);
    background: var(--panel);
  }

  .desktop-icon-tile:active {
    transform: translateY(1px);
  }

  .desktop-icon-tile:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .desktop-icon-badge {
    width: 2.25rem;
    height: 2.25rem;
    display: grid;
    place-items: center;
    border-radius: 0.5rem;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }

  .desktop-icon-label {
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.25;
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  .desktop-icon-tag {
    font-size: 0.6875rem;
    line-height: 1.2;
    padding: 0.0625rem 0.375rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--muted);
    background: var(--panel);
  }
</style>
