<script lang="ts">
  import type { MemoryEdgeKind, MemoryGraphEdge, MemoryGraphNode } from "./memory-graph-api.ts";
  import {
    computeBounds,
    groupColor,
    placeNodes,
    type Bounds,
    type GraphLayoutName,
    type Point,
  } from "./memory-graph-layout.ts";

  let {
    nodes, edges, layout, selectedId, hoverId, onselect, onhover, onopen,
  }: {
    nodes: MemoryGraphNode[];
    edges: MemoryGraphEdge[];
    layout: GraphLayoutName;
    selectedId: string | null;
    hoverId: string | null;
    onselect: (id: string) => void;
    onhover: (id: string | null) => void;
    onopen: (node: MemoryGraphNode) => void;
  } = $props();

  let stage = $state<HTMLDivElement | null>(null);
  let dragOffsets = $state<Record<string, Point>>({});
  let view = $state<Bounds | null>(null);
  let panning = $state<{ x: number; y: number; ox: number; oy: number } | null>(null);
  let dragging = $state<{ id: string; x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);

  let base = $derived(placeNodes(nodes, edges, layout));
  let groups = $derived([...new Set(nodes.map((node) => node.group))]);
  let points = $derived.by(() => {
    const next = new Map<string, Point>();
    for (const [id, point] of base) {
      const offset = dragOffsets[id];
      next.set(id, offset ? { x: point.x + offset.x, y: point.y + offset.y } : point);
    }
    return next;
  });
  let bounds = $derived(computeBounds(points));
  let current = $derived(view ?? bounds);

  let connected = $derived.by(() => {
    const focus = hoverId ?? selectedId;
    const set = new Set<string>();
    if (!focus) return set;
    set.add(focus);
    for (const edge of edges) {
      if (edge.source === focus) set.add(edge.target);
      else if (edge.target === focus) set.add(edge.source);
    }
    return set;
  });

  $effect(() => {
    if (layout && nodes.length >= 0) {
      dragOffsets = {};
      view = null;
    }
  });

  function zoom(factor: number) {
    const box = current;
    const w = Math.min(bounds.w * 4, Math.max(bounds.w / 4, box.w * factor));
    const ratio = w / box.w;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    view = { x: cx - w / 2, y: cy - (box.h * ratio) / 2, w, h: box.h * ratio };
  }

  function fit() {
    view = null;
    dragOffsets = {};
  }

  function scaleFactor(): number {
    const rect = stage?.querySelector("svg")?.getBoundingClientRect();
    return current.w / Math.max(rect?.width ?? 0, 1);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    const step = current.w * 0.1;
    const moves: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    view = { ...current, x: current.x + move.x, y: current.y + move.y };
  }

  function kindTone(kind: MemoryGraphNode["kind"]): string {
    if (kind === "folder") return "folder";
    if (kind === "ghost") return "ghost";
    return "node";
  }

  function radius(node: MemoryGraphNode): number {
    return node.kind === "folder" ? 16 : 8 + Math.min(node.degree, 8) * 1.6;
  }

  function edgeTitle(edge: MemoryGraphEdge): string {
    return `${edge.kind} ${edge.resolved ? "resolved" : "unresolved"} link`;
  }

  function dashFor(kind: MemoryEdgeKind, resolved: boolean): string | undefined {
    return resolved ? undefined : "4 3";
  }
</script>

<div class="mg-canvas" bind:this={stage} data-graph-layout={layout}>
  <div class="mg-zoom" role="group" aria-label="Graph zoom controls">
    <button type="button" onclick={() => zoom(0.8)} aria-label="Zoom in">+</button>
    <button type="button" onclick={() => zoom(1.25)} aria-label="Zoom out">-</button>
    <button type="button" onclick={fit}>Fit</button>
  </div>
  <!-- The canvas is an application widget: pointer pan/zoom and arrow-key panning are its own interaction model. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <svg
    viewBox={`${current.x} ${current.y} ${current.w} ${current.h}`}
    role="application"
    aria-label={`Memory graph canvas with ${nodes.length} nodes and ${edges.length} links`}
    tabindex="0"
    onkeydown={onKeydown}
    onpointerdown={(event) => {
      if (event.target !== event.currentTarget) return;
      panning = { x: event.clientX, y: event.clientY, ox: current.x, oy: current.y };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onpointermove={(event) => {
      if (dragging) {
        const scale = scaleFactor();
        const start = dragging;
        const dx = (event.clientX - start.x) * scale, dy = (event.clientY - start.y) * scale;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) dragging = { ...dragging, moved: true };
        dragOffsets = { ...dragOffsets, [start.id]: { x: start.ox + dx, y: start.oy + dy } };
        return;
      }
      if (!panning) return;
      const scale = scaleFactor();
      view = { ...current, x: panning.ox - (event.clientX - panning.x) * scale, y: panning.oy - (event.clientY - panning.y) * scale };
    }}
    onpointerup={() => { panning = null; dragging = null; }}
    onpointercancel={() => { panning = null; dragging = null; }}
    onlostpointercapture={() => { panning = null; dragging = null; }}
    onwheel={(event) => { event.preventDefault(); zoom(event.deltaY > 0 ? 1.08 : 0.92); }}
  >
    <g class="mg-edges">
      {#each edges as edge (`${edge.kind}:${edge.source}:${edge.target}`)}
        {@const source = points.get(edge.source)}
        {@const target = points.get(edge.target)}
        {#if source && target}
          {@const dim = connected.size > 0 && !(connected.has(edge.source) && connected.has(edge.target))}
          <line
            x1={source.x} y1={source.y} x2={target.x} y2={target.y}
            stroke={dim ? "var(--border)" : edge.resolved ? "var(--muted)" : "var(--warn)"}
            stroke-opacity={dim ? 0.25 : edge.resolved ? 0.6 : 0.45}
            stroke-width={connected.size > 0 && !dim ? 2 : 1.2}
            stroke-dasharray={dashFor(edge.kind, edge.resolved)}
          ><title>{edgeTitle(edge)}</title></line>
        {/if}
      {/each}
    </g>
    <g class="mg-nodes">
      {#each nodes as node (node.id)}
        {@const point = points.get(node.id)}
        {#if point}
          {@const r = radius(node)}
          {@const dim = connected.size > 0 && !connected.has(node.id)}
          {@const active = selectedId === node.id || hoverId === node.id}
          <g
            transform={`translate(${point.x} ${point.y})`}
            role="button"
            tabindex="0"
            aria-pressed={selectedId === node.id}
            aria-label={`${node.title}, ${node.kind}, ${node.degree} links`}
            class="mg-node"
            data-kind={kindTone(node.kind)}
            class:dimmed={dim}
            class:active
            onpointerdown={(event) => {
              event.stopPropagation();
              const offset = dragOffsets[node.id];
              dragging = { id: node.id, x: event.clientX, y: event.clientY, ox: offset?.x ?? 0, oy: offset?.y ?? 0, moved: false };
            }}
            onclick={() => { if (!dragging?.moved) onselect(node.id); }}
            ondblclick={() => onopen(node)}
            onmouseenter={() => onhover(node.id)}
            onmouseleave={() => onhover(null)}
            onfocus={() => onhover(node.id)}
            onblur={() => onhover(null)}
            onkeydown={(event) => {
              if (event.key === " " || event.key === "Enter") { event.preventDefault(); onselect(node.id); }
            }}
          >
            {#if node.kind === "folder"}
              <rect x={-r} y={-r} width={r * 2} height={r * 2} rx="4" fill={groupColor(node.group, groups)} stroke={active ? "var(--accent)" : "var(--border)"} stroke-width={active ? 3 : 1} />
            {:else}
              <circle
                r={r}
                fill={node.kind === "ghost" ? "var(--panel-solid)" : groupColor(node.group, groups)}
                fill-opacity={node.kind === "ghost" ? 0.3 : 0.92}
                stroke={active ? "var(--accent)" : node.kind === "ghost" ? "var(--muted)" : "var(--border)"}
                stroke-dasharray={node.kind === "ghost" ? "3 2" : undefined}
                stroke-width={active ? 3 : 1.4}
              />
            {/if}
            <text y={r + 14} text-anchor="middle" fill="var(--text)" font-size="11">{node.title.slice(0, 26)}</text>
          </g>
        {/if}
      {/each}
    </g>
  </svg>
</div>

<style>
  .mg-canvas { position: relative; min-width: 0; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); overflow: hidden; }
  .mg-canvas svg { display: block; width: 100%; height: 100%; min-height: 15rem; touch-action: none; cursor: grab; }
  .mg-canvas svg:active { cursor: grabbing; }
  .mg-zoom { position: absolute; top: 0.375rem; right: 0.375rem; z-index: 2; display: flex; gap: 0.25rem; }
  .mg-zoom button { min-height: 1.9rem; padding: 0.15rem 0.5rem; font-size: 0.8125rem; line-height: 1; }
  .mg-node { cursor: pointer; }
  .mg-node.dimmed { opacity: 0.35; }
  .mg-node text { pointer-events: none; }
  @media (max-width: 26rem) {
    .mg-canvas svg { min-height: 12rem; }
  }
</style>
