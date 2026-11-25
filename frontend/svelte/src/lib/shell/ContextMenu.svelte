<script lang="ts">
  import { tick } from "svelte";
  import {
    clampMenuPosition,
    type ContextMenuItem,
    type ContextMenuState,
  } from "./context-menu-store";

  let {
    state: menu,
    onClose,
  }: {
    state: ContextMenuState;
    onClose: () => void;
  } = $props();

  let menuEl = $state<HTMLDivElement | null>(null);
  let measuredW = $state(206);
  let measuredH = $state(180);

  let hasCheckColumn = $derived(
    menu.items.some((item) => item.type !== "sep" && item.checked !== undefined),
  );

  let estimatedH = $derived.by(() => {
    let total = 12 + (menu.title ? 26 : 0);
    for (const item of menu.items) {
      total += item.type === "sep" ? 11 : 30;
    }
    return total;
  });

  let position = $derived.by(() => {
    const vw = typeof window === "undefined" ? 1440 : window.innerWidth;
    const vh = typeof window === "undefined" ? 900 : window.innerHeight;
    const w = measuredW > 0 ? measuredW : 206;
    const h = measuredH > 0 ? measuredH : estimatedH;
    return clampMenuPosition(menu.x, menu.y, w, h, vw, vh);
  });

  function getFocusableItems(): HTMLButtonElement[] {
    if (!menuEl) return [];
    return Array.from(
      menuEl.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])'),
    );
  }

  function focusAt(index: number) {
    const list = getFocusableItems();
    if (list.length === 0) return;
    const normalized = ((index % list.length) + list.length) % list.length;
    list[normalized]?.focus();
  }

  function selectItem(item: Extract<ContextMenuItem, { id: string }>) {
    if (item.disabled) return;
    onClose();
    item.onSelect();
  }

  $effect(() => {
    if (!menu.open || menu.items.length === 0) return;
    const prevFocus =
      typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;

    let cancelled = false;
    void tick().then(() => {
      if (cancelled || !menuEl) return;
      const rect = menuEl.getBoundingClientRect();
      if (rect.width > 0) measuredW = Math.ceil(rect.width);
      if (rect.height > 0) measuredH = Math.ceil(rect.height);
      const first = getFocusableItems()[0];
      first?.focus({ preventScroll: true });
    });

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuEl && target && menuEl.contains(target)) return;
      onClose();
    };

    const onScroll = () => {
      onClose();
    };

    const onResize = () => {
      onClose();
    };

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        onClose();
        return;
      }

      const list = getFocusableItems();
      if (list.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const currentIndex = list.indexOf(active as HTMLButtonElement);

      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusAt(currentIndex === -1 ? 0 : currentIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusAt(currentIndex === -1 ? list.length - 1 : currentIndex - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusAt(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusAt(list.length - 1);
      } else if (event.key === "Enter" && active && menuEl?.contains(active)) {
        if (active instanceof HTMLButtonElement && !active.disabled) {
          event.preventDefault();
          active.click();
        }
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeydown, true);

    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeydown, true);
      if (prevFocus && typeof prevFocus.focus === "function" && document.contains(prevFocus)) {
        prevFocus.focus({ preventScroll: true });
      }
    };
  });
</script>

{#if menu.open && menu.items.length > 0}
  <div
    class="ctx-backdrop"
    aria-hidden="true"
    onpointerdown={(event) => {
      event.stopPropagation();
      onClose();
    }}
    oncontextmenu={(event) => {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }}
  ></div>

  <div
    bind:this={menuEl}
    class="ctx-menu"
    role="menu"
    aria-label={menu.title ?? "Context menu"}
    tabindex="-1"
    style:left={`${position.x}px`}
    style:top={`${position.y}px`}
    oncontextmenu={(event) => event.preventDefault()}
  >
    {#if menu.title}
      <div class="ctx-title" role="presentation">{menu.title}</div>
    {/if}

    {#each menu.items as item, index (item.type === "sep" ? `sep-${index}` : item.id)}
      {#if item.type === "sep"}
        <div class="ctx-sep" role="separator"></div>
      {:else}
        <button
          type="button"
          class="ctx-item"
          class:danger={Boolean(item.danger)}
          class:checked={Boolean(item.checked)}
          role="menuitem"
          data-menu-item-id={item.id}
          data-checked={item.checked ? "true" : undefined}
          disabled={Boolean(item.disabled)}
          onclick={() => selectItem(item)}
        >
          {#if hasCheckColumn}
            <span class="ctx-check" aria-hidden="true">
              {#if item.checked}
                <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2.2 6.3 4.8 9 9.8 3.2" />
                </svg>
              {/if}
            </span>
          {/if}
          <span class="ctx-label">
            {item.label}
            {#if item.checked}
              <span class="sr-only"> (selected)</span>
            {/if}
          </span>
          {#if item.shortcut}
            <span class="ctx-shortcut" aria-hidden="true">{item.shortcut}</span>
          {/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  @keyframes ctxIn {
    from {
      opacity: 0;
      transform: scale(0.94);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 8500;
    background: transparent;
  }

  .ctx-menu {
    position: fixed;
    z-index: 8501;
    min-width: 206px;
    max-width: min(19rem, calc(100vw - 16px));
    max-height: calc(100dvh - 16px);
    overflow-y: auto;
    padding: 5px;
    border-radius: 11px;
    border: 0.5px solid var(--glass-stroke, rgba(255, 255, 255, 0.7));
    background: var(--glass-bg, rgba(252, 252, 254, 0.62));
    -webkit-backdrop-filter: blur(30px) saturate(180%);
    backdrop-filter: blur(30px) saturate(180%);
    box-shadow:
      0 14px 44px var(--glass-shadow, rgba(0, 0, 0, 0.18)),
      inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.95));
    color: var(--label, #1c1c1e);
    display: grid;
    gap: 1px;
    outline: none;
    animation: ctxIn 0.12s cubic-bezier(0.32, 0.72, 0, 1);
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .ctx-menu {
      border-color: var(--glass-stroke, rgba(255, 255, 255, 0.14));
      background: var(--glass-bg, rgba(44, 44, 50, 0.55));
      box-shadow:
        0 14px 44px var(--glass-shadow, rgba(0, 0, 0, 0.55)),
        inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.2));
      color: var(--label, #ffffff);
    }
  }

  :global(:root[data-theme="dark"]) .ctx-menu {
    border-color: var(--glass-stroke, rgba(255, 255, 255, 0.14));
    background: var(--glass-bg, rgba(44, 44, 50, 0.55));
    box-shadow:
      0 14px 44px var(--glass-shadow, rgba(0, 0, 0, 0.55)),
      inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.2));
    color: var(--label, #ffffff);
  }

  .ctx-title {
    padding: 3px 12px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--label2, rgba(60, 60, 67, 0.6));
    user-select: none;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .ctx-title {
      color: var(--label2, rgba(235, 235, 245, 0.6));
    }
  }

  :global(:root[data-theme="dark"]) .ctx-title {
    color: var(--label2, rgba(235, 235, 245, 0.6));
  }

  .ctx-sep {
    height: 0.5px;
    margin: 5px 8px;
    background: var(--sep, rgba(60, 60, 67, 0.16));
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .ctx-sep {
      background: var(--sep, rgba(255, 255, 255, 0.1));
    }
  }

  :global(:root[data-theme="dark"]) .ctx-sep {
    background: var(--sep, rgba(255, 255, 255, 0.1));
  }

  .ctx-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 28px;
    padding: 5px 12px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    font-size: 13.5px;
    font-weight: 400;
    line-height: 1.25;
    text-align: left;
    cursor: default;
    transition: background-color 80ms ease, color 80ms ease;
  }

  .ctx-item:hover:not(:disabled),
  .ctx-item:focus-visible:not(:disabled) {
    background: var(--tint, var(--accent, #007aff));
    color: #ffffff;
    outline: none;
  }

  .ctx-item.danger {
    color: #ff453a;
  }

  .ctx-item.danger:hover:not(:disabled),
  .ctx-item.danger:focus-visible:not(:disabled) {
    background: #ff453a;
    color: #ffffff;
  }

  .ctx-item:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .ctx-check {
    width: 14px;
    height: 14px;
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
  }

  .ctx-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ctx-shortcut {
    flex-shrink: 0;
    margin-left: 20px;
    font-size: 12px;
    font-family: inherit;
    font-variant-numeric: tabular-nums;
    opacity: 0.5;
  }

  .ctx-item:hover:not(:disabled) .ctx-shortcut,
  .ctx-item:focus-visible:not(:disabled) .ctx-shortcut {
    opacity: 0.92;
    color: #ffffff;
  }

  @media (pointer: coarse) {
    .ctx-item {
      min-height: 2.5rem;
      font-size: 15px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ctx-menu {
      animation: none;
    }
  }
</style>
