<script lang="ts">
  import { trimFromDrag, type TrimEdge } from "./reel-trim.ts";

  type Props = {
    edge: TrimEdge;
    clipId: string;
    clipTitle: string;
    /** Seconds the rendered block width represents: the effective (trimmed) duration. */
    durationSec: number;
    trimInSec: number;
    trimOutSec: number;
    onTrimCommit: (id: string, trimInSec: number, trimOutSec: number) => void;
  };

  let { edge, clipId, clipTitle, durationSec, trimInSec, trimOutSec, onTrimCommit }: Props = $props();

  const KEY_STEP_SEC = 0.5;
  let dragStartX = $state(0);
  let dragWidth = 0;
  let dragOffsetPx = $state(0);
  let dragging = $state(false);

  let label = $derived(edge === "in" ? `Trim start of ${clipTitle}` : `Trim end of ${clipTitle}`);

  function resolveFromPx(deltaPx: number) {
    return trimFromDrag({ edge, deltaPx, widthPx: dragWidth, durationSec, trimInSec, trimOutSec });
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    const lane = (event.currentTarget as HTMLElement).parentElement;
    dragWidth = lane?.getBoundingClientRect().width ?? 0;
    dragStartX = event.clientX;
    dragOffsetPx = 0;
    dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    const raw = event.clientX - dragStartX;
    dragOffsetPx = Math.max(-dragWidth, Math.min(dragWidth, raw));
  }

  function onPointerUp(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    const next = resolveFromPx(dragOffsetPx);
    dragOffsetPx = 0;
    if (next.trimInSec !== trimInSec || next.trimOutSec !== trimOutSec) {
      onTrimCommit(clipId, next.trimInSec, next.trimOutSec);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    const dir = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (dir === 0) return;
    event.preventDefault();
    const deltaSec = dir * KEY_STEP_SEC;
    if (edge === "in") onTrimCommit(clipId, Math.max(0, trimInSec + deltaSec), trimOutSec);
    else onTrimCommit(clipId, trimInSec, Math.max(0, trimOutSec - deltaSec));
  }
</script>

<button
  type="button"
  class="trim-handle {edge}"
  class:dragging
  aria-label={label}
  title={edge === "in" ? `Trim start of ${clipTitle} (${trimInSec}s trimmed)` : `Trim end of ${clipTitle} (${trimOutSec}s trimmed)`}
  style:transform={dragging ? `translateX(${dragOffsetPx}px)` : undefined}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onkeydown={onKeyDown}
></button>

<style>
  .trim-handle {
    flex: 0 0 0.55rem; align-self: stretch; min-height: 2.75rem; padding: 0; border: 0;
    background: transparent; cursor: ew-resize; touch-action: none; position: relative;
  }
  .trim-handle::after {
    content: ""; position: absolute; top: 12%; bottom: 12%; left: 50%; width: 2px;
    transform: translateX(-50%); border-radius: 1px; background: var(--border);
  }
  .trim-handle:hover::after, .trim-handle:focus-visible::after, .trim-handle.dragging::after {
    background: var(--accent); width: 3px;
  }
  .trim-handle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 0.2rem; }
  @media (pointer: coarse) { .trim-handle { flex-basis: 2.75rem; } }
</style>
