<script lang="ts">
  import { resolveAppIcon } from "./app-icons.ts";
  import type { DockAppDef } from "./shell-registry.ts";
  import type { WindowState } from "./window-store.ts";

  const SEP_W = 13;
  const GAP = 8;
  const MAG_SIGMA = 100;
  const MIN_ICON = 36;
  const MAX_ICON = 46;

  type DockSlot =
    | { kind: "app"; item: DockAppDef }
    | { kind: "sep"; key: string }
    | { kind: "plain"; id: "launchpad" | "mission-control"; label: string; image: string };

  let {
    dockApps,
    openAppSet,
    minimizedWindows = [],
    onOpenApp,
    onLaunchpad,
    onMissionControl,
    onRestoreWindow,
    onAppContextMenu,
  }: {
    dockApps: readonly DockAppDef[];
    openAppSet: ReadonlySet<string>;
    minimizedWindows?: readonly WindowState[];
    onOpenApp: (app: string, title: string, payload?: unknown, multi?: boolean) => void;
    onLaunchpad: () => void;
    onMissionControl: () => void;
    onRestoreWindow: (id: string) => void;
    onAppContextMenu?: (event: MouseEvent, item: DockAppDef) => void;
  } = $props();

  let viewportWidth = $state(typeof window === "undefined" ? 1440 : window.innerWidth);
  let rowEl = $state<HTMLElement | null>(null);
  let brokenImages = $state<Record<string, boolean>>({});
  let slotEls: Array<HTMLDivElement | null> = [];
  let zoneEls: Array<HTMLDivElement | null> = [];
  let mouseX: number | null = null;
  let rafId = 0;

  let slots = $derived.by<DockSlot[]>(() => [
    ...dockApps.map((item): DockSlot => ({ kind: "app", item })),
    { kind: "sep", key: "sep-system" },
    { kind: "plain", id: "launchpad", label: "Launchpad", image: "/app-icons/launchpad.webp" },
    { kind: "plain", id: "mission-control", label: "Mission Control", image: "/app-icons/mission-control.webp" },
  ]);

  let fit = $derived.by(() => {
    const count = slots.length;
    const seps = slots.filter((s) => s.kind === "sep").length;
    const chipReserve = minimizedWindows.length > 0 ? Math.min(260, minimizedWindows.length * 116) : 0;
    const reserve = Math.round(MAX_ICON * 2.05);
    const room = viewportWidth - 36 - chipReserve - GAP * Math.max(0, count - 1) - SEP_W * seps - reserve;
    const rawFit = Math.floor(room / Math.max(1, count - seps));
    const cramped = rawFit < MIN_ICON || viewportWidth < 768;
    const base = Math.max(MIN_ICON, Math.min(MAX_ICON, rawFit));
    const dockExtra = cramped ? 0 : Math.round(base * 2.05);
    return { base, cramped, dockExtra };
  });

  let restMetrics = $derived.by(() => {
    const widths = slots.map((s) => (s.kind === "sep" ? SEP_W : fit.base));
    const total =
      widths.reduce((acc, w) => acc + w, 0) + GAP * Math.max(0, slots.length - 1);
    let cursor = -total / 2;
    const offsets = widths.map((w) => {
      const center = cursor + w / 2;
      cursor += w + GAP;
      return center;
    });
    const norm = Math.max(
      4.5,
      offsets.reduce(
        (acc, off, i) =>
          slots[i]?.kind === "sep"
            ? acc
            : acc + Math.exp(-(off * off) / (2 * MAG_SIGMA * MAG_SIGMA)),
        0,
      ),
    );
    return { offsets, norm };
  });

  function applyMagnification() {
    rafId = 0;
    if (!rowEl) return;
    const hovering = mouseX !== null && !fit.cramped && fit.dockExtra > 0;
    const rect = rowEl.getBoundingClientRect();
    const rowCenter = rect.left + rect.width / 2;
    const currentSlots = slots;
    const { offsets, norm } = restMetrics;

    for (let i = 0; i < currentSlots.length; i += 1) {
      const slot = currentSlots[i];
      if (!slot || slot.kind === "sep") continue;
      let width = fit.base;
      if (hovering && mouseX !== null) {
        const dist = mouseX - (rowCenter + offsets[i]);
        const weight = Math.exp(-(dist * dist) / (2 * MAG_SIGMA * MAG_SIGMA));
        const extra = Math.min(fit.base * 0.45, fit.dockExtra * (weight / norm));
        width = fit.base + extra;
      }
      const slotNode = slotEls[i];
      const zoneNode = zoneEls[i];
      if (slotNode) slotNode.style.width = `${width}px`;
      if (zoneNode) zoneNode.style.height = `${width}px`;
    }
  }

  function scheduleMagnification() {
    if (!rafId && typeof requestAnimationFrame !== "undefined") {
      rafId = requestAnimationFrame(applyMagnification);
    }
  }

  function handlePointerMove(event: PointerEvent) {
    if (event.pointerType !== "mouse" || fit.cramped) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    mouseX = event.clientX;
    scheduleMagnification();
  }

  function handlePointerLeave() {
    mouseX = null;
    scheduleMagnification();
  }

  function markImageBroken(key: string) {
    brokenImages = { ...brokenImages, [key]: true };
  }

  function handleContextMenu(event: MouseEvent, item: DockAppDef) {
    if (!onAppContextMenu) return;
    event.preventDefault();
    onAppContextMenu(event, item);
  }

  $effect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      viewportWidth = window.innerWidth;
      mouseX = null;
      scheduleMagnification();
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };
  });

  $effect(() => {
    void slots.length;
    void fit.base;
    void fit.cramped;
    if (mouseX !== null) {
      scheduleMagnification();
    } else {
      for (let i = 0; i < slots.length; i += 1) {
        const slotNode = slotEls[i];
        const zoneNode = zoneEls[i];
        if (slotNode) slotNode.style.width = `${fit.base}px`;
        if (zoneNode) zoneNode.style.height = `${fit.base}px`;
      }
    }
  });
</script>

<div class="dock-shell macos-dock-shell">
  <div class="dock-scroll-wrap" class:cramped={fit.cramped}>
    <nav
      class="app-dock macos-dock"
      class:cramped={fit.cramped}
      aria-label="Workspace apps"
      bind:this={rowEl}
      style:gap={`${GAP}px`}
      onpointermove={handlePointerMove}
      onpointerleave={handlePointerLeave}
    >
      {#each slots as slot, i (slot.kind === "app" ? slot.item.app : slot.kind === "sep" ? slot.key : slot.id)}
        {#if slot.kind === "sep"}
          <div class="dock-sep" style:width={`${SEP_W}px`} aria-hidden="true">
            <span class="dock-sep-line"></span>
          </div>
        {:else if slot.kind === "app"}
          {@const visual = resolveAppIcon(slot.item.app, "macos")}
          {@const running = openAppSet.has(slot.item.app)}
          {@const showImg = Boolean(visual.image) && !brokenImages[slot.item.app]}
          <div
            class="dock-slot"
            bind:this={slotEls[i]}
            style:width={`${fit.base}px`}
            style:height={`${fit.base}px`}
          >
            <div class="dock-zone" bind:this={zoneEls[i]} style:height={`${fit.base}px`}>
              <span class="dock-tooltip" aria-hidden="true">{slot.item.title}</span>
              <button
                type="button"
                class="macos-dock-btn"
                aria-label={slot.item.label}
                title={slot.item.title}
                onclick={() => onOpenApp(slot.item.app, slot.item.title, slot.item.payload, slot.item.multi)}
                oncontextmenu={(e) => handleContextMenu(e, slot.item)}
              >
                <span class="macos-icon-squircle" style:background={visual.gradient} aria-hidden="true">
                  {#if showImg && visual.image}
                    <img
                      src={visual.image}
                      alt=""
                      loading="lazy"
                      draggable="false"
                      onerror={() => markImageBroken(slot.item.app)}
                    />
                  {:else}
                    <span class="macos-icon-mono">{visual.monogram}</span>
                  {/if}
                </span>
              </button>
              {#if running}
                <span class="macos-running-dot" aria-hidden="true"></span>
              {/if}
            </div>
          </div>
        {:else}
          {@const showPlainImg = !brokenImages[slot.id]}
          <div
            class="dock-slot"
            bind:this={slotEls[i]}
            style:width={`${fit.base}px`}
            style:height={`${fit.base}px`}
          >
            <div class="dock-zone" bind:this={zoneEls[i]} style:height={`${fit.base}px`}>
              <span class="dock-tooltip" aria-hidden="true">{slot.label}</span>
              <button
                type="button"
                class="macos-dock-btn"
                aria-label={slot.label}
                title={slot.label}
                onclick={() => (slot.id === "launchpad" ? onLaunchpad() : onMissionControl())}
              >
                <span
                  class="macos-icon-squircle"
                  style:background={slot.id === "launchpad"
                    ? "linear-gradient(135deg, #0ea5e9, #6366f1, #ec4899)"
                    : "linear-gradient(135deg, #1d4ed8, #0f172a)"}
                  aria-hidden="true"
                >
                  {#if showPlainImg}
                    <img
                      src={slot.image}
                      alt=""
                      loading="lazy"
                      draggable="false"
                      onerror={() => markImageBroken(slot.id)}
                    />
                  {:else if slot.id === "launchpad"}
                    <svg viewBox="0 0 24 24" class="system-glyph" fill="currentColor">
                      <rect x="3" y="3" width="4.5" height="4.5" rx="1.2" />
                      <rect x="9.75" y="3" width="4.5" height="4.5" rx="1.2" />
                      <rect x="16.5" y="3" width="4.5" height="4.5" rx="1.2" />
                      <rect x="3" y="9.75" width="4.5" height="4.5" rx="1.2" />
                      <rect x="9.75" y="9.75" width="4.5" height="4.5" rx="1.2" />
                      <rect x="16.5" y="9.75" width="4.5" height="4.5" rx="1.2" />
                      <rect x="3" y="16.5" width="4.5" height="4.5" rx="1.2" />
                      <rect x="9.75" y="16.5" width="4.5" height="4.5" rx="1.2" />
                      <rect x="16.5" y="16.5" width="4.5" height="4.5" rx="1.2" />
                    </svg>
                  {:else}
                    <svg viewBox="0 0 24 24" class="system-glyph" fill="none" stroke="currentColor" stroke-width="1.8">
                      <rect x="3" y="4" width="8" height="6" rx="1.5" />
                      <rect x="13" y="4" width="8" height="8" rx="1.5" />
                      <rect x="4" y="13" width="11" height="7" rx="1.5" />
                    </svg>
                  {/if}
                </span>
              </button>
            </div>
          </div>
        {/if}
      {/each}

      {#if minimizedWindows.length > 0}
        <div class="dock-sep" style:width={`${SEP_W}px`} aria-hidden="true">
          <span class="dock-sep-line"></span>
        </div>
        {#each minimizedWindows as win (win.id)}
          <button
            type="button"
            class="minimized-chip macos-min-chip"
            onclick={() => onRestoreWindow(win.id)}
          >
            Restore {win.title}
          </button>
        {/each}
      {/if}
    </nav>
  </div>
</div>

<style>
  .macos-dock-shell {
    position: sticky;
    bottom: max(0.5rem, env(safe-area-inset-bottom));
    z-index: 8050;
    display: flex;
    justify-content: center;
    padding: 0 0.5rem 0.45rem;
    pointer-events: none;
    max-width: 100%;
  }

  .dock-scroll-wrap {
    display: contents;
  }

  .dock-scroll-wrap.cramped {
    display: block;
    max-width: calc(100vw - 16px);
    overflow-x: auto;
    overflow-y: visible;
    scrollbar-width: none;
    margin-top: -3.25rem;
    padding-top: 3.25rem;
    pointer-events: none;
  }

  .dock-scroll-wrap.cramped::-webkit-scrollbar {
    display: none;
  }

  .macos-dock {
    pointer-events: auto;
    display: flex;
    align-items: flex-end;
    flex-wrap: nowrap;
    overflow: visible;
    max-width: none;
    padding: 0.45rem 0.65rem 0.55rem;
    border-radius: 22px;
    background: var(--dock-bg, rgba(255, 255, 255, 0.38));
    border: 1px solid rgba(255, 255, 255, 0.42);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.42),
      0 18px 50px -10px rgba(0, 0, 0, 0.48);
    backdrop-filter: blur(24px) saturate(185%);
    -webkit-backdrop-filter: blur(24px) saturate(185%);
  }

  .macos-dock.cramped {
    width: max-content;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .macos-dock {
      border-color: rgba(255, 255, 255, 0.16);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.14),
        0 20px 56px -10px rgba(0, 0, 0, 0.65);
    }
  }

  :global(:root[data-theme="dark"]) .macos-dock {
    border-color: rgba(255, 255, 255, 0.16);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.14),
      0 20px 56px -10px rgba(0, 0, 0, 0.65);
  }

  .dock-sep {
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: stretch;
    flex-shrink: 0;
  }

  .dock-sep-line {
    width: 1px;
    height: 72%;
    background: rgba(255, 255, 255, 0.34);
  }

  .dock-slot {
    position: relative;
    flex: 0 0 auto;
    transition: width 160ms ease-out;
  }

  .dock-zone {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: height 160ms ease-out;
  }

  .dock-tooltip {
    pointer-events: none;
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%) translateY(4px);
    opacity: 0;
    visibility: hidden;
    white-space: nowrap;
    padding: 0.25rem 0.6rem;
    border-radius: 0.5rem;
    font-size: 12px;
    font-weight: 600;
    color: #ffffff;
    background: rgba(22, 24, 34, 0.86);
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.36);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    transition: opacity 130ms ease, transform 130ms ease, visibility 130ms ease;
    z-index: 8150;
  }

  .dock-zone:hover .dock-tooltip,
  .dock-zone:focus-within .dock-tooltip {
    opacity: 1;
    visibility: visible;
    transform: translateX(-50%) translateY(0);
  }

  .macos-dock-btn {
    width: 100%;
    height: 100%;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 22%;
    background: transparent;
    display: block;
    filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.3));
  }

  .macos-dock-btn:active {
    transform: scale(0.94);
  }

  .macos-icon-squircle {
    width: 100%;
    height: 100%;
    border-radius: 22%;
    overflow: hidden;
    display: grid;
    place-items: center;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.26);
  }

  .macos-icon-squircle img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .macos-icon-mono {
    font-size: 0.85rem;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 0.02em;
  }

  .system-glyph {
    width: 58%;
    height: 58%;
    color: #ffffff;
  }

  .macos-running-dot {
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    width: 4.5px;
    height: 4.5px;
    border-radius: 999px;
    background: #ffffff;
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.9);
  }

  .macos-min-chip {
    min-height: 30px;
    padding: 0.25rem 0.6rem;
    border-radius: 0.625rem;
    border: 1px dashed rgba(255, 255, 255, 0.4);
    background: rgba(24, 26, 36, 0.72);
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    align-self: center;
    flex-shrink: 0;
  }

  .macos-min-chip:hover {
    background: rgba(36, 40, 56, 0.88);
  }

  @media (prefers-reduced-motion: reduce) {
    .dock-slot,
    .dock-zone,
    .dock-tooltip {
      transition: none;
    }
  }
</style>
