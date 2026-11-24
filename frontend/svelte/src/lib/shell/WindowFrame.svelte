<script lang="ts">
  import type { Snippet } from "svelte";
  import {
    computeSnapRect,
    type DesktopBounds,
    type SnapZone,
    type WindowRect,
    type WindowState,
  } from "./window-store";

  type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

  const MIN_W = 240;
  const MIN_H = 180;
  const SNAP_EDGE_PX = 16;
  const SNAP_CORNER_PX = 80;

  const SNAP_LAYOUT_OPTIONS: readonly { zone: SnapZone; label: string }[] = [
    { zone: "left", label: "Left Half" },
    { zone: "right", label: "Right Half" },
    { zone: "full", label: "Full" },
    { zone: "tl", label: "Top-Left" },
    { zone: "tr", label: "Top-Right" },
    { zone: "bl", label: "Bottom-Left" },
    { zone: "br", label: "Bottom-Right" },
  ];

  const RESIZE_HANDLES: readonly ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

  let {
    win,
    focused,
    floating = false,
    chrome = "macos",
    desktopBounds = { width: 1440, height: 820, top: 32, bottom: 76 },
    onFocus,
    onMinimize,
    onMaximize,
    onClose,
    onMove,
    onResize,
    onSnap,
    onTogglePin,
    onContextMenu,
    children,
  }: {
    win: WindowState;
    focused: boolean;
    floating?: boolean;
    chrome?: string;
    desktopBounds?: DesktopBounds;
    onFocus: (id: string) => void;
    onMinimize: (id: string) => void;
    onMaximize: (id: string) => void;
    onClose: (id: string) => void;
    onMove?: (id: string, x: number, y: number) => void;
    onResize?: (id: string, w: number, h: number) => void;
    onSnap?: (id: string, zone: SnapZone) => void;
    onTogglePin?: (id: string) => void;
    onContextMenu?: (event: MouseEvent, win: WindowState) => void;
    children: Snippet;
  } = $props();

  let frameEl = $state<HTMLElement | null>(null);
  let liveRect = $state<WindowRect | null>(null);
  let interacting = $state(false);
  let dragSnapZone = $state<SnapZone | null>(null);
  let snapMenuOpen = $state(false);

  let activeCleanup: (() => void) | null = null;
  let snapCloseTimer: ReturnType<typeof setTimeout> | null = null;

  let zIndex = $derived(win.pinned ? 200 + win.z : 10 + win.z);
  let displayX = $derived(liveRect ? liveRect.x : win.x);
  let displayY = $derived(liveRect ? liveRect.y : win.y);
  let displayW = $derived(liveRect ? liveRect.w : win.w);
  let displayH = $derived(liveRect ? liveRect.h : win.h);

  let frameStyle = $derived.by(() => {
    if (!floating) return "";
    if (win.maximized) return `z-index: ${zIndex};`;
    return `left: ${displayX}px; top: ${displayY}px; width: ${displayW}px; height: ${displayH}px; z-index: ${zIndex};`;
  });

  let snapPreviewRect = $derived(
    floating && dragSnapZone ? computeSnapRect(dragSnapZone, desktopBounds) : null,
  );

  function stopFocus(event: PointerEvent) {
    event.stopPropagation();
  }

  function clearSnapTimer() {
    if (snapCloseTimer !== null) {
      clearTimeout(snapCloseTimer);
      snapCloseTimer = null;
    }
  }

  function openSnapMenu() {
    if (!floating) return;
    clearSnapTimer();
    snapMenuOpen = true;
  }

  function scheduleSnapMenuClose() {
    clearSnapTimer();
    snapCloseTimer = setTimeout(() => {
      snapMenuOpen = false;
      snapCloseTimer = null;
    }, 150);
  }

  function closeSnapMenu() {
    clearSnapTimer();
    snapMenuOpen = false;
  }

  function applySnap(zone: SnapZone) {
    onFocus(win.id);
    if (onSnap) {
      onSnap(win.id, zone);
    } else if (zone === "full") {
      if (!win.maximized) onMaximize(win.id);
    } else {
      const rect = computeSnapRect(zone, desktopBounds);
      onMove?.(win.id, rect.x, rect.y);
      onResize?.(win.id, rect.w, rect.h);
    }
    closeSnapMenu();
  }

  function detectSnapZone(clientX: number, clientY: number): SnapZone | null {
    const parent = frameEl?.offsetParent as HTMLElement | null;
    const parentRect = parent?.getBoundingClientRect();
    const areaLeft = parentRect ? parentRect.left : 0;
    const areaTop = parentRect ? parentRect.top : 0;
    const areaW = parentRect && parentRect.width > 0 ? parentRect.width : desktopBounds.width;
    const areaH = parentRect && parentRect.height > 0 ? parentRect.height : desktopBounds.height;

    const relX = clientX - areaLeft;
    const relY = clientY - areaTop;

    if (relX <= SNAP_EDGE_PX) {
      if (relY <= SNAP_CORNER_PX) return "tl";
      if (relY >= areaH - SNAP_CORNER_PX) return "bl";
      return "left";
    }
    if (relX >= areaW - SNAP_EDGE_PX) {
      if (relY <= SNAP_CORNER_PX) return "tr";
      if (relY >= areaH - SNAP_CORNER_PX) return "br";
      return "right";
    }
    if (relY <= SNAP_EDGE_PX) {
      return "full";
    }
    return null;
  }

  function isControlTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("button, .win-controls, .snap-popover, .win-pin-btn"));
  }

  function startTitlebarDrag(event: PointerEvent) {
    if (!floating || event.button !== 0 || isControlTarget(event.target)) return;
    event.preventDefault();
    onFocus(win.id);
    closeSnapMenu();

    activeCleanup?.();

    const startX = event.clientX;
    const startY = event.clientY;
    const wasMaximized = win.maximized;
    let originX = win.x;
    let originY = win.y;
    let width = win.w;
    let height = win.h;
    let unmaximized = false;
    let moved = false;
    let currentX = originX;
    let currentY = originY;
    let currentZone: SnapZone | null = null;
    let rafId = 0;

    let pointerX = startX;
    let pointerY = startY;

    const applyFrame = () => {
      rafId = 0;
      const dx = pointerX - startX;
      const dy = pointerY - startY;

      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      moved = true;
      interacting = true;

      if (wasMaximized && !unmaximized) {
        unmaximized = true;
        const restoreRect = win.prevRect ?? { x: win.x, y: win.y, w: win.w, h: win.h };
        width = restoreRect.w;
        height = restoreRect.h;
        const parentRect = (frameEl?.offsetParent as HTMLElement | null)?.getBoundingClientRect();
        const relStartX = pointerX - (parentRect?.left ?? 0);
        originX = Math.round(relStartX - width / 2);
        originY = Math.max(0, Math.round(pointerY - (parentRect?.top ?? 0) - 18));
        onMaximize(win.id);
      }

      const maxX = Math.max(0, desktopBounds.width - 80);
      const minX = -Math.max(0, width - 80);
      currentX = Math.round(Math.max(minX, Math.min(maxX, originX + (unmaximized ? pointerX - startX : dx))));
      currentY = Math.round(Math.max(0, originY + (unmaximized ? pointerY - startY : dy)));
      liveRect = { x: currentX, y: currentY, w: width, h: height };
      currentZone = detectSnapZone(pointerX, pointerY);
      dragSnapZone = currentZone;
    };

    const onPointerMove = (ev: PointerEvent) => {
      pointerX = ev.clientX;
      pointerY = ev.clientY;
      if (!rafId) rafId = requestAnimationFrame(applyFrame);
    };

    const finish = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
        applyFrame();
      }
      cleanup();
      const finalZone = currentZone;
      dragSnapZone = null;
      liveRect = null;
      interacting = false;
      if (finalZone) {
        applySnap(finalZone);
      } else if (moved) {
        onMove?.(win.id, currentX, currentY);
      }
    };

    const cleanup = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      activeCleanup = null;
    };

    activeCleanup = cleanup;
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function startResize(event: PointerEvent, dir: ResizeDir) {
    if (!floating || win.maximized || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    onFocus(win.id);
    closeSnapMenu();

    activeCleanup?.();

    const startX = event.clientX;
    const startY = event.clientY;
    const origX = win.x;
    const origY = win.y;
    const origW = win.w;
    const origH = win.h;

    let nextX = origX;
    let nextY = origY;
    let nextW = origW;
    let nextH = origH;
    let pointerX = startX;
    let pointerY = startY;
    let rafId = 0;
    interacting = true;

    const applyFrame = () => {
      rafId = 0;
      const dx = pointerX - startX;
      const dy = pointerY - startY;

      let x = origX;
      let y = origY;
      let w = origW;
      let h = origH;

      if (dir.includes("e")) {
        w = Math.max(MIN_W, Math.round(origW + dx));
      }
      if (dir.includes("s")) {
        h = Math.max(MIN_H, Math.round(origH + dy));
      }
      if (dir.includes("w")) {
        w = Math.max(MIN_W, Math.round(origW - dx));
        x = Math.round(origX + (origW - w));
      }
      if (dir.includes("n")) {
        const rawY = Math.max(0, Math.round(origY + dy));
        const maxTop = origY + origH - MIN_H;
        y = Math.min(rawY, maxTop);
        h = Math.max(MIN_H, Math.round(origY + origH - y));
      }

      nextX = x;
      nextY = y;
      nextW = w;
      nextH = h;
      liveRect = { x: nextX, y: nextY, w: nextW, h: nextH };
    };

    const onPointerMove = (ev: PointerEvent) => {
      pointerX = ev.clientX;
      pointerY = ev.clientY;
      if (!rafId) rafId = requestAnimationFrame(applyFrame);
    };

    const finish = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
        applyFrame();
      }
      cleanup();
      liveRect = null;
      interacting = false;
      if (nextX !== origX || nextY !== origY) {
        onMove?.(win.id, nextX, nextY);
      }
      if (nextW !== origW || nextH !== origH) {
        onResize?.(win.id, nextW, nextH);
      }
    };

    const cleanup = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      activeCleanup = null;
    };

    activeCleanup = cleanup;
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function handleTitlebarDblClick(event: MouseEvent) {
    if (isControlTarget(event.target)) return;
    onMaximize(win.id);
  }

  function handleTitlebarContextMenu(event: MouseEvent) {
    if (!onContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    onFocus(win.id);
    onContextMenu(event, win);
  }

  $effect(() => {
    if (!snapMenuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSnapMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });

  $effect(() => {
    return () => {
      activeCleanup?.();
      clearSnapTimer();
    };
  });
</script>

{#if snapPreviewRect && !win.minimized}
  <div
    class="snap-preview-overlay"
    aria-hidden="true"
    data-snap-zone={dragSnapZone}
    style:left={`${snapPreviewRect.x}px`}
    style:top={`${snapPreviewRect.y}px`}
    style:width={`${snapPreviewRect.w}px`}
    style:height={`${snapPreviewRect.h}px`}
    style:z-index={Math.max(1, zIndex - 1)}
  ></div>
{/if}

<article
  bind:this={frameEl}
  class="win-frame"
  class:focused
  class:floating
  class:maximized={win.maximized}
  class:pinned={Boolean(win.pinned)}
  class:interacting
  hidden={win.minimized}
  data-win-id={win.id}
  data-win-app={win.app}
  data-chrome={chrome}
  data-floating={floating}
  data-focused={focused}
  data-maximized={win.maximized}
  data-pinned={Boolean(win.pinned)}
  aria-label={win.title}
  style={frameStyle}
  onpointerdown={() => onFocus(win.id)}
>
  <div
    class="win-bar"
    class:draggable={floating}
    role="toolbar"
    aria-label={`${win.title} title bar`}
    tabindex="-1"
    onpointerdown={startTitlebarDrag}
    ondblclick={handleTitlebarDblClick}
    oncontextmenu={handleTitlebarContextMenu}
  >
    <h2 class="win-title">{win.title}</h2>

    {#if onTogglePin || win.pinned}
      <div class="win-pin-slot">
        <button
          type="button"
          class="win-pin-btn"
          class:active={Boolean(win.pinned)}
          aria-label={win.pinned ? `Unpin ${win.title}` : `Keep ${win.title} on top`}
          aria-pressed={Boolean(win.pinned)}
          title={win.pinned ? "Unpin from top" : "Keep on top"}
          onpointerdown={stopFocus}
          onclick={() => onTogglePin?.(win.id)}
        >
          <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 2h4l.7 3.5L11 7v1H3V7l1.3-1.5L5 2Z" />
            <path d="M7 8v4" />
          </svg>
        </button>
      </div>
    {/if}

    <div class="win-controls">
      <button
        type="button"
        class="win-btn win-btn-min"
        aria-label={`Minimize ${win.title}`}
        onpointerdown={stopFocus}
        onclick={() => onMinimize(win.id)}
      >
        <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
          <path d="M1.5 5h7" />
        </svg>
      </button>

      <div
        class="win-max-wrap"
        role="none"
        onpointerenter={openSnapMenu}
        onpointerleave={scheduleSnapMenuClose}
      >
        <button
          type="button"
          class="win-btn win-btn-max"
          aria-label={win.maximized ? `Restore ${win.title}` : `Maximize ${win.title}`}
          aria-pressed={win.maximized}
          onpointerdown={stopFocus}
          onclick={() => onMaximize(win.id)}
        >
          {#if win.maximized}
            <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
              <rect x="1.2" y="2.8" width="5.5" height="5.5" rx="0.6" />
              <path d="M3.2 2.8V1.6c0-.3.3-.6.6-.6h4.6c.3 0 .6.3.6.6v4.6c0 .3-.3.6-.6.6H7.2" />
            </svg>
          {:else}
            <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
              <rect x="1.5" y="1.5" width="7" height="7" rx="0.7" />
            </svg>
          {/if}
        </button>

        {#if floating && snapMenuOpen}
          <div
            class="snap-popover"
            class:align-left={chrome === "macos"}
            role="menu"
            tabindex="-1"
            aria-label={`Snap layouts for ${win.title}`}
            onpointerdown={stopFocus}
            onpointerenter={openSnapMenu}
            onpointerleave={scheduleSnapMenuClose}
          >
            <div class="snap-popover-title" role="presentation">Snap Layout</div>
            <div class="snap-grid">
              {#each SNAP_LAYOUT_OPTIONS as opt (opt.zone)}
                <button
                  type="button"
                  role="menuitem"
                  class="snap-opt"
                  aria-label={`${opt.label} (${win.title})`}
                  title={opt.label}
                  data-snap-option={opt.zone}
                  onpointerdown={stopFocus}
                  onclick={(event) => {
                    event.stopPropagation();
                    applySnap(opt.zone);
                  }}
                >
                  <span class={`snap-glyph zone-${opt.zone}`} aria-hidden="true">
                    <span class="snap-fill"></span>
                  </span>
                  <span class="snap-opt-label">{opt.label}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <button
        type="button"
        class="win-btn win-btn-close win-close"
        aria-label={`Close ${win.title}`}
        onpointerdown={stopFocus}
        onclick={() => onClose(win.id)}
      >
        <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
          <path d="M2 2l6 6M8 2L2 8" />
        </svg>
      </button>
    </div>
  </div>

  <div class="win-body">
    <svelte:boundary>
      {@render children()}
      {#snippet failed(_error, reset)}
        <div class="win-crash" role="alert">
          <p><strong>{win.title} stopped unexpectedly.</strong></p>
          <p>Other open windows remain available. Retry this window or close it.</p>
          <div class="actions">
            <button type="button" class="primary" onclick={reset}>Retry</button>
            <button type="button" onclick={() => onClose(win.id)}>Close window</button>
          </div>
        </div>
      {/snippet}
    </svelte:boundary>
  </div>

  {#if floating && !win.maximized}
    {#each RESIZE_HANDLES as dir (dir)}
      <div
        class={`resize-handle resize-${dir}`}
        aria-hidden="true"
        data-resize-dir={dir}
        onpointerdown={(event) => startResize(event, dir)}
      ></div>
    {/each}
  {/if}
</article>

<style>
  .snap-preview-overlay {
    position: absolute;
    pointer-events: none;
    border-radius: 0.75rem;
    border: 2px solid var(--accent, #1f6df0);
    background: color-mix(in srgb, var(--accent, #1f6df0) 18%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 10px 30px rgba(31, 109, 240, 0.22);
    transition: left 90ms ease, top 90ms ease, width 90ms ease, height 90ms ease;
  }

  .win-frame {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    width: 100%;
    min-width: 0;
    max-width: 100%;
    background: var(--window-bg);
    backdrop-filter: blur(var(--blur)) saturate(170%);
    -webkit-backdrop-filter: blur(var(--blur)) saturate(170%);
    border: 1px solid var(--border);
    border-radius: 0.875rem;
    box-shadow: var(--shadow-win);
    overflow: visible;
  }

  .win-frame.floating {
    position: absolute;
    width: auto;
    max-width: none;
  }

  .win-frame.floating.maximized {
    position: absolute;
    inset: 0;
    width: auto;
    height: auto;
    min-height: 0;
    border-radius: 0.5rem;
  }

  .win-frame.interacting {
    user-select: none;
    transition: none;
  }

  .win-frame.focused {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  }

  .win-frame:not(.floating).maximized {
    width: 100%;
    min-height: 68vh;
  }

  .win-bar {
    position: relative;
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.625rem;
    padding: 0.5rem 0.75rem;
    background: var(--window-head);
    border-bottom: 1px solid var(--border);
    border-top-left-radius: inherit;
    border-top-right-radius: inherit;
    min-width: 0;
    user-select: none;
  }

  .win-bar.draggable {
    cursor: grab;
    touch-action: none;
  }

  .win-bar.draggable:active {
    cursor: grabbing;
  }

  .win-title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1 1 auto;
  }

  .win-pin-slot {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  .win-frame[data-chrome="macos"] .win-pin-slot {
    grid-column: 3;
    justify-self: end;
  }

  .win-pin-btn {
    min-width: 1.625rem;
    min-height: 1.625rem;
    padding: 0.2rem;
    display: inline-grid;
    place-items: center;
    border-radius: 0.375rem;
    border: 1px solid transparent;
    background: transparent;
    color: var(--muted);
  }

  .win-pin-btn:hover,
  .win-pin-btn:focus-visible {
    color: var(--text);
    background: color-mix(in srgb, var(--border) 65%, transparent);
  }

  .win-pin-btn.active {
    color: var(--accent, #1f6df0);
    background: color-mix(in srgb, var(--accent, #1f6df0) 14%, transparent);
    border-color: color-mix(in srgb, var(--accent, #1f6df0) 35%, transparent);
  }

  .win-controls {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-shrink: 0;
  }

  .win-frame[data-chrome="macos"] .win-btn-close {
    order: 3;
  }

  .win-frame[data-chrome="macos"] .win-btn-min {
    order: 2;
  }

  .win-frame[data-chrome="macos"] .win-max-wrap {
    order: 1;
  }

  .win-max-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .win-btn {
    min-width: 2rem;
    min-height: 2rem;
    padding: 0.2rem 0.45rem;
    font-size: 0.8125rem;
    line-height: 1;
    display: inline-grid;
    place-items: center;
  }

  .win-close:hover {
    border-color: var(--danger);
    color: var(--danger);
  }

  .snap-popover {
    position: absolute;
    top: calc(100% + 0.375rem);
    right: 0;
    z-index: 60;
    width: 15.5rem;
    padding: 0.5rem;
    border-radius: 0.625rem;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--panel) 95%, var(--panel-solid));
    backdrop-filter: blur(var(--blur, 24px)) saturate(180%);
    -webkit-backdrop-filter: blur(var(--blur, 24px)) saturate(180%);
    box-shadow: var(--shadow-pop);
    display: grid;
    gap: 0.375rem;
  }

  .snap-popover.align-left {
    left: 0;
    right: auto;
  }

  .snap-popover-title {
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 0 0.125rem;
  }

  .snap-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.3125rem;
  }

  .snap-opt {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2rem;
    padding: 0.3125rem 0.45rem;
    border-radius: 0.4375rem;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--panel-solid) 65%, transparent);
    color: var(--text);
    font-size: 0.75rem;
    font-weight: 500;
    text-align: left;
  }

  .snap-opt:hover,
  .snap-opt:focus-visible {
    background: #1f6df0;
    border-color: #1f6df0;
    color: #ffffff;
    outline: none;
  }

  .snap-glyph {
    position: relative;
    width: 1.25rem;
    height: 0.875rem;
    border-radius: 0.1875rem;
    border: 1px solid currentColor;
    opacity: 0.85;
    flex-shrink: 0;
    overflow: hidden;
  }

  .snap-fill {
    position: absolute;
    background: currentColor;
    opacity: 0.75;
  }

  .snap-glyph.zone-left .snap-fill { left: 0; top: 0; width: 50%; height: 100%; }
  .snap-glyph.zone-right .snap-fill { right: 0; top: 0; width: 50%; height: 100%; }
  .snap-glyph.zone-full .snap-fill { inset: 0; }
  .snap-glyph.zone-tl .snap-fill { left: 0; top: 0; width: 50%; height: 50%; }
  .snap-glyph.zone-tr .snap-fill { right: 0; top: 0; width: 50%; height: 50%; }
  .snap-glyph.zone-bl .snap-fill { left: 0; bottom: 0; width: 50%; height: 50%; }
  .snap-glyph.zone-br .snap-fill { right: 0; bottom: 0; width: 50%; height: 50%; }

  .snap-opt-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .win-body {
    padding: var(--feature-padding, 1rem);
    min-width: 0;
    min-height: 0;
    overflow: auto;
    border-bottom-left-radius: inherit;
    border-bottom-right-radius: inherit;
  }

  .win-crash {
    display: grid;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid var(--danger);
    border-radius: 0.5rem;
    background: var(--danger-bg);
    color: var(--danger);
  }

  .win-crash p { margin: 0; color: inherit; }

  .resize-handle {
    position: absolute;
    z-index: 6;
    touch-action: none;
  }

  .resize-n { top: -3px; left: 10px; right: 10px; height: 7px; cursor: ns-resize; }
  .resize-s { bottom: -3px; left: 10px; right: 10px; height: 7px; cursor: ns-resize; }
  .resize-e { right: -3px; top: 10px; bottom: 10px; width: 7px; cursor: ew-resize; }
  .resize-w { left: -3px; top: 10px; bottom: 10px; width: 7px; cursor: ew-resize; }
  .resize-nw { top: -4px; left: -4px; width: 12px; height: 12px; cursor: nwse-resize; }
  .resize-ne { top: -4px; right: -4px; width: 12px; height: 12px; cursor: nesw-resize; }
  .resize-sw { bottom: -4px; left: -4px; width: 12px; height: 12px; cursor: nesw-resize; }
  .resize-se { bottom: -4px; right: -4px; width: 12px; height: 12px; cursor: nwse-resize; }
</style>
