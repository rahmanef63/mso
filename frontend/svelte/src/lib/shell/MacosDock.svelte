<script lang="ts">
  import { resolveAppIcon } from "./app-icons.ts";
  import type { DockAppDef } from "./shell-registry.ts";
  import type { WindowState } from "./window-store.ts";

  const SEP_W = 9;
  const GAP = 8;
  const MAG_SIGMA = 104;
  const MIN_ICON = 38;
  const MAX_ICON = 52;
  const BOUNCE_MS = 520;

  type DockSlot =
    | { kind: "app"; item: DockAppDef }
    | { kind: "sep"; key: string }
    | { kind: "plain"; id: "launchpad" | "mission-control" | "trash"; label: string; image?: string };

  let {
    dockApps,
    openAppSet,
    minimizedWindows = [],
    onOpenApp,
    onFocusOrOpenApp,
    onLaunchpad,
    onMissionControl,
    onRestoreWindow,
    onAppContextMenu,
    onTrash,
  }: {
    dockApps: readonly DockAppDef[];
    openAppSet: ReadonlySet<string>;
    minimizedWindows?: readonly WindowState[];
    onOpenApp: (app: string, title: string, payload?: unknown, multi?: boolean) => void;
    onFocusOrOpenApp?: (item: DockAppDef) => void;
    onLaunchpad: () => void;
    onMissionControl: () => void;
    onRestoreWindow: (id: string) => void;
    onAppContextMenu?: (event: MouseEvent, item: DockAppDef) => void;
    onTrash?: () => void;
  } = $props();

  let viewportWidth = $state(typeof window === "undefined" ? 1440 : window.innerWidth);
  let rowEl = $state<HTMLElement | null>(null);
  let brokenImages = $state<Record<string, boolean>>({});
  let bounceKey = $state<string | null>(null);
  let bounceSeq = $state(0);
  let trashToast = $state<{ title: string; detail: string } | null>(null);
  let trashToastTimer: ReturnType<typeof setTimeout> | null = null;
  let slotEls: Array<HTMLDivElement | null> = [];
  let zoneEls: Array<HTMLDivElement | null> = [];
  let mouseX: number | null = null;
  let rafId = 0;
  let bounceTimer: ReturnType<typeof setTimeout> | null = null;

  const TRASH_PATH = "~/.local/share/Trash/files";

  let slots = $derived.by<DockSlot[]>(() => [
    ...dockApps.map((item): DockSlot => ({ kind: "app", item })),
    { kind: "sep", key: "sep-system" },
    { kind: "plain", id: "launchpad", label: "Launchpad", image: "/app-icons/launchpad.webp" },
    { kind: "plain", id: "mission-control", label: "Mission Control", image: "/app-icons/mission-control.webp" },
    { kind: "plain", id: "trash", label: "Trash" },
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
        const extra = Math.min(fit.base * 0.42, fit.dockExtra * (weight / norm));
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
    if (prefersReducedMotion()) return;
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

  function handleAppClick(item: DockAppDef) {
    triggerBounce(item.app);
    if (onFocusOrOpenApp) {
      onFocusOrOpenApp(item);
      return;
    }
    onOpenApp(item.app, item.title, item.payload, item.multi);
  }

  function handlePlainClick(id: "launchpad" | "mission-control" | "trash") {
    if (id === "launchpad") {
      triggerBounce("launchpad");
      onLaunchpad();
    } else if (id === "mission-control") {
      triggerBounce("mission-control");
      onMissionControl();
    } else {
      openTrash();
    }
  }

  function openTrash() {
    if (onTrash) {
      onTrash();
      return;
    }
    showTrashToast();
    onOpenApp("files", "Files", TRASH_PATH, true);
  }

  function showTrashToast() {
    if (trashToastTimer !== null) clearTimeout(trashToastTimer);
    trashToast = {
      title: "Trash",
      detail: `Opening ${TRASH_PATH}. Items stay until the host cleanup runs.`,
    };
    trashToastTimer = setTimeout(() => {
      trashToast = null;
      trashToastTimer = null;
    }, 4200);
  }

  function prefersReducedMotion(): boolean {
    if (typeof window === "undefined") return true;
    return (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || document.documentElement.dataset.reducedMotion === "true"
    );
  }

  function triggerBounce(key: string) {
    if (prefersReducedMotion()) return;
    if (bounceTimer !== null) clearTimeout(bounceTimer);
    bounceKey = key;
    bounceSeq += 1;
    bounceTimer = setTimeout(() => {
      bounceKey = null;
      bounceTimer = null;
    }, BOUNCE_MS);
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
      if (bounceTimer !== null) {
        clearTimeout(bounceTimer);
        bounceTimer = null;
      }
      if (trashToastTimer !== null) {
        clearTimeout(trashToastTimer);
        trashToastTimer = null;
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
            <div
              class="dock-zone"
              class:bouncing={bounceKey === slot.item.app}
              data-bounce={bounceKey === slot.item.app ? bounceSeq : undefined}
              bind:this={zoneEls[i]}
              style:height={`${fit.base}px`}
            >
              <span class="dock-tooltip" aria-hidden="true">{slot.item.title}</span>
              <button
                type="button"
                class="macos-dock-btn"
                aria-label={slot.item.label}
                title={slot.item.title}
                onclick={() => handleAppClick(slot.item)}
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
          {@const showPlainImg = Boolean(slot.image) && !brokenImages[slot.id]}
          <div
            class="dock-slot"
            bind:this={slotEls[i]}
            style:width={`${fit.base}px`}
            style:height={`${fit.base}px`}
          >
            <div
              class="dock-zone"
              class:bouncing={bounceKey === slot.id}
              bind:this={zoneEls[i]}
              style:height={`${fit.base}px`}
            >
              <span class="dock-tooltip" aria-hidden="true">{slot.label}</span>
              <button
                type="button"
                class="macos-dock-btn"
                aria-label={slot.label}
                title={slot.label}
                onclick={() => handlePlainClick(slot.id)}
              >
                <span
                  class="macos-icon-squircle"
                  class:trash-squircle={slot.id === "trash"}
                  style:background={slot.id === "launchpad"
                    ? "linear-gradient(135deg, #0ea5e9, #6366f1, #ec4899)"
                    : slot.id === "mission-control"
                      ? "linear-gradient(135deg, #1d4ed8, #0f172a)"
                      : "#e9e9ee"}
                  aria-hidden="true"
                >
                  {#if showPlainImg && slot.image}
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
                  {:else if slot.id === "mission-control"}
                    <svg viewBox="0 0 24 24" class="system-glyph" fill="none" stroke="currentColor" stroke-width="1.8">
                      <rect x="3" y="4" width="8" height="6" rx="1.5" />
                      <rect x="13" y="4" width="8" height="8" rx="1.5" />
                      <rect x="4" y="13" width="11" height="7" rx="1.5" />
                    </svg>
                  {:else}
                    <svg viewBox="0 0 60 60" class="trash-glyph" fill="none" stroke="#7c7c85" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M18 22h24M25 22v-2.5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2V22M21 22l1.6 18a2.4 2.4 0 0 0 2.4 2.2h10a2.4 2.4 0 0 0 2.4-2.2L41 22" />
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
    {#if trashToast}
      <div class="dock-toast" role="status">
        <strong>{trashToast.title}</strong>
        <span>{trashToast.detail}</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .macos-dock-shell {
    position: sticky;
    bottom: max(8px, env(safe-area-inset-bottom));
    z-index: 8050;
    display: flex;
    justify-content: center;
    padding: 0 8px 8px;
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

  .macos-dock.app-dock {
    pointer-events: auto;
    display: flex;
    align-items: flex-end;
    flex-wrap: nowrap;
    overflow: visible;
    max-width: none;
    padding: 7px 10px;
    border-radius: 22px;
    background: var(--glass-bg, rgba(252, 252, 254, 0.62));
    border: 0.5px solid var(--glass-stroke, rgba(255, 255, 255, 0.7));
    box-shadow:
      inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.95)),
      0 14px 44px var(--glass-shadow, rgba(0, 0, 0, 0.18));
    -webkit-backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
    backdrop-filter: blur(var(--blur, 26px)) saturate(180%);
  }

  .macos-dock.cramped {
    width: max-content;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .macos-dock.app-dock {
      background: var(--glass-bg, rgba(44, 44, 50, 0.55));
      border-color: var(--glass-stroke, rgba(255, 255, 255, 0.14));
      box-shadow:
        inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.2)),
        0 14px 44px var(--glass-shadow, rgba(0, 0, 0, 0.55));
    }
  }

  :global(:root[data-theme="dark"]) .macos-dock.app-dock {
    background: var(--glass-bg, rgba(44, 44, 50, 0.55));
    border-color: var(--glass-stroke, rgba(255, 255, 255, 0.14));
    box-shadow:
      inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.2)),
      0 14px 44px var(--glass-shadow, rgba(0, 0, 0, 0.55));
  }

  .dock-sep {
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    flex-shrink: 0;
  }

  .dock-sep-line {
    width: 0.5px;
    height: 46px;
    margin: 0 3px;
    background: var(--sep, rgba(60, 60, 67, 0.16));
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .dock-sep-line {
      background: var(--sep, rgba(255, 255, 255, 0.1));
    }
  }

  :global(:root[data-theme="dark"]) .dock-sep-line {
    background: var(--sep, rgba(255, 255, 255, 0.1));
  }

  @keyframes bounceUp {
    0% {
      transform: translateY(0) scale(1);
    }
    30% {
      transform: translateY(-42%) scale(1.06);
    }
    55% {
      transform: translateY(0) scale(0.97);
    }
    75% {
      transform: translateY(-16%) scale(1.02);
    }
    100% {
      transform: translateY(0) scale(1);
    }
  }

  .dock-zone.bouncing {
    transform-origin: 50% 100%;
    animation: bounceUp 520ms cubic-bezier(0.28, 0.84, 0.42, 1);
  }

  .dock-slot {
    position: relative;
    flex: 0 0 auto;
    transition: width 160ms cubic-bezier(0.3, 0.9, 0.3, 1);
  }

  .dock-zone {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: height 160ms cubic-bezier(0.3, 0.9, 0.3, 1);
  }

  .dock-tooltip {
    pointer-events: none;
    position: absolute;
    bottom: calc(100% + 12px);
    left: 50%;
    transform: translateX(-50%) translateY(4px);
    opacity: 0;
    visibility: hidden;
    white-space: nowrap;
    padding: 4px 10px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 500;
    color: var(--label, #1c1c1e);
    background: var(--glass-bg, rgba(252, 252, 254, 0.78));
    border: 0.5px solid var(--glass-stroke, rgba(255, 255, 255, 0.7));
    box-shadow:
      0 8px 24px var(--glass-shadow, rgba(0, 0, 0, 0.18)),
      inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.95));
    -webkit-backdrop-filter: blur(22px) saturate(180%);
    backdrop-filter: blur(22px) saturate(180%);
    transition: opacity 130ms ease, transform 130ms ease, visibility 130ms ease;
    z-index: 20;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .dock-tooltip {
      color: var(--label, #ffffff);
      background: var(--glass-bg, rgba(44, 44, 50, 0.76));
      border-color: var(--glass-stroke, rgba(255, 255, 255, 0.14));
      box-shadow:
        0 8px 24px var(--glass-shadow, rgba(0, 0, 0, 0.55)),
        inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.2));
    }
  }

  :global(:root[data-theme="dark"]) .dock-tooltip {
    color: var(--label, #ffffff);
    background: var(--glass-bg, rgba(44, 44, 50, 0.76));
    border-color: var(--glass-stroke, rgba(255, 255, 255, 0.14));
    box-shadow:
      0 8px 24px var(--glass-shadow, rgba(0, 0, 0, 0.55)),
      inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.2));
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
    border-radius: 23%;
    background: transparent;
    display: block;
    filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.28));
    transition: transform var(--durF, 0.2s) cubic-bezier(0.3, 0.9, 0.3, 1);
  }

  .dock-zone:hover .macos-dock-btn {
    transform: translateY(-6px);
  }

  .macos-dock-btn:active {
    transform: translateY(-2px) scale(0.94);
  }

  .macos-icon-squircle {
    width: 100%;
    height: 100%;
    border-radius: 23%;
    overflow: hidden;
    display: grid;
    place-items: center;
    box-shadow: inset 0 0.5px 0 rgba(255, 255, 255, 0.28);
  }

  .trash-squircle {
    box-shadow: inset 0 0.5px 0 rgba(255, 255, 255, 0.6);
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

  .trash-glyph {
    width: 100%;
    height: 100%;
    display: block;
  }

  .macos-running-dot {
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--label2, rgba(60, 60, 67, 0.6));
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .macos-running-dot {
      background: var(--label2, rgba(235, 235, 245, 0.6));
    }
  }

  :global(:root[data-theme="dark"]) .macos-running-dot {
    background: var(--label2, rgba(235, 235, 245, 0.6));
  }

  .macos-min-chip {
    min-height: 30px;
    padding: 0 10px;
    border-radius: 10px;
    border: 0.5px solid var(--glass-stroke, rgba(255, 255, 255, 0.45));
    background: var(--fill, rgba(118, 118, 128, 0.16));
    color: var(--label, #1c1c1e);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    align-self: center;
    flex-shrink: 0;
  }

  .macos-min-chip:hover {
    background: var(--fill2, rgba(118, 118, 128, 0.28));
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .macos-min-chip {
      color: var(--label, #ffffff);
      background: var(--fill, rgba(120, 120, 128, 0.24));
      border-color: var(--glass-stroke, rgba(255, 255, 255, 0.16));
    }
  }

  :global(:root[data-theme="dark"]) .macos-min-chip {
    color: var(--label, #ffffff);
    background: var(--fill, rgba(120, 120, 128, 0.24));
    border-color: var(--glass-stroke, rgba(255, 255, 255, 0.16));
  }

  .dock-toast {
    position: fixed;
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom) + 88px);
    transform: translateX(-50%);
    z-index: 40;
    display: grid;
    gap: 2px;
    min-width: 220px;
    max-width: min(26rem, calc(100vw - 2rem));
    padding: 9px 13px;
    border-radius: 14px;
    font-size: 12px;
    line-height: 1.3;
    text-align: left;
    color: var(--label, #1c1c1e);
    background: var(--glass-bg, rgba(252, 252, 254, 0.82));
    border: 0.5px solid var(--glass-stroke, rgba(255, 255, 255, 0.7));
    box-shadow:
      inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.95)),
      0 14px 40px var(--glass-shadow, rgba(0, 0, 0, 0.18));
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    backdrop-filter: blur(24px) saturate(180%);
    pointer-events: none;
    animation: trashIn 0.24s cubic-bezier(0.32, 0.72, 0, 1);
  }

  .dock-toast strong {
    font-size: 12.5px;
    font-weight: 600;
  }

  .dock-toast span {
    color: var(--label2, rgba(60, 60, 67, 0.72));
    overflow-wrap: anywhere;
  }

  @keyframes trashIn {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .dock-toast {
      color: var(--label, #ffffff);
      background: var(--glass-bg, rgba(44, 44, 50, 0.82));
      border-color: var(--glass-stroke, rgba(255, 255, 255, 0.14));
      box-shadow:
        inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.2)),
        0 14px 40px var(--glass-shadow, rgba(0, 0, 0, 0.55));
    }
    :global(:root:not([data-theme="light"])) .dock-toast span {
      color: var(--label2, rgba(235, 235, 245, 0.72));
    }
  }

  :global(:root[data-theme="dark"]) .dock-toast {
    color: var(--label, #ffffff);
    background: var(--glass-bg, rgba(44, 44, 50, 0.82));
    border-color: var(--glass-stroke, rgba(255, 255, 255, 0.14));
    box-shadow:
      inset 0 0.5px 0 var(--glass-hi, rgba(255, 255, 255, 0.2)),
      0 14px 40px var(--glass-shadow, rgba(0, 0, 0, 0.55));
  }

  :global(:root[data-theme="dark"]) .dock-toast span {
    color: var(--label2, rgba(235, 235, 245, 0.72));
  }

  :global(:root[data-reduced-motion="true"]) .dock-zone:hover .macos-dock-btn {
    transform: none;
  }

  :global(:root[data-reduced-motion="true"]) .dock-zone.bouncing {
    animation: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .dock-slot,
    .dock-zone,
    .dock-tooltip,
    .macos-dock-btn {
      transition: none;
    }

    .dock-zone:hover .macos-dock-btn {
      transform: none;
    }

    .dock-zone.bouncing {
      animation: none;
    }

    .dock-toast {
      animation: none;
    }
  }
</style>
