<script module lang="ts">
  import type { WorkflowGraphSummary } from "./workflows-api.ts";
  import { computeLayoutPreview, type PreviewEdge, type PreviewNode, type WorkflowPreviewLayout } from "./workflow-canvas-math.ts";

  export type { PreviewNode, PreviewEdge, WorkflowPreviewLayout };
  export function layoutWorkflowPreview(graph: Pick<WorkflowGraphSummary, "name" | "status" | "nodeCount" | "edgeCount">): WorkflowPreviewLayout {
    return computeLayoutPreview(graph);
  }
</script>

<script lang="ts">
  import { bezierEdgePath, canAcceptInput, clampZoom, computeFitViewport, inputPortPos, outputPortPos, runStateStroke, STUDIO_NODE_H, STUDIO_NODE_W, statusTokens, synthesizeStudioGraph } from "./workflow-canvas-math.ts";
  import { nodeBadgeOf, sourceHandlesOf, type WorkflowEdge, type WorkflowNode, type WorkflowRunNodeState } from "./workflow-types.ts";

  type Props = {
    graph: WorkflowGraphSummary; nodes?: WorkflowNode[]; edges?: WorkflowEdge[];
    selectedNodeId?: string | null; selectedEdgeId?: string | null;
    runNodeStates?: Record<string, WorkflowRunNodeState>;
    onSelectNode?: (id: string | null) => void; onSelectEdge?: (id: string | null) => void;
    onMoveNode?: (id: string, x: number, y: number) => void;
    onConnect?: (sourceId: string, targetId: string, sourceHandle?: string) => void;
    onDeleteSelection?: () => void; onTidy?: () => void;
  };
  let { graph, nodes, edges, selectedNodeId = null, selectedEdgeId = null, runNodeStates = {}, onSelectNode, onSelectEdge, onMoveNode, onConnect, onDeleteSelection, onTidy }: Props = $props();
  const uid = $props.id();
  const VIEW_W = 860, VIEW_H = 380;

  let svgEl: SVGSVGElement | undefined;
  let zoom = $state(1), panX = $state(24), panY = $state(24);
  let dragMode = $state<null | { kind: "pan"; startX: number; startY: number; origX: number; origY: number } | { kind: "node"; nodeId: string; startX: number; startY: number; origX: number; origY: number }>(null);
  let pendingFrom = $state<{ nodeId: string; handle: string } | null>(null);
  let lastGraphId = $state("");

  let fallback = $derived(synthesizeStudioGraph(graph));
  let activeNodes = $derived(nodes ?? fallback.nodes);
  let activeEdges = $derived(edges ?? fallback.edges);
  let nodeMap = $derived(new Map(activeNodes.map((n) => [n.id, n])));
  let tokens = $derived(statusTokens(graph.status));
  let svgLabel = $derived(`Workflow topology preview for ${graph.name}: ${activeNodes.length} ${activeNodes.length === 1 ? "node" : "nodes"}, ${activeEdges.length} ${activeEdges.length === 1 ? "edge" : "edges"}, status ${graph.status}`);

  $effect(() => {
    if (graph.id !== lastGraphId) {
      lastGraphId = graph.id; pendingFrom = null;
      const fit = computeFitViewport(activeNodes, VIEW_W, VIEW_H);
      zoom = fit.zoom; panX = fit.panX; panY = fit.panY;
    }
  });

  function fitView() { const fit = computeFitViewport(activeNodes, VIEW_W, VIEW_H); zoom = fit.zoom; panX = fit.panX; panY = fit.panY; }
  function stepZoom(delta: number) { zoom = clampZoom(zoom + delta); }

  function svgPoint(ev: PointerEvent) {
    const rect = svgEl?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: ev.clientX, y: ev.clientY };
    return { x: ((ev.clientX - rect.left) / rect.width) * VIEW_W, y: ((ev.clientY - rect.top) / rect.height) * VIEW_H };
  }
  function startPan(ev: PointerEvent) {
    if (ev.button !== 0) return;
    const pt = svgPoint(ev);
    dragMode = { kind: "pan", startX: pt.x, startY: pt.y, origX: panX, origY: panY };
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
  }
  function startDragNode(ev: PointerEvent, node: WorkflowNode) {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    onSelectNode?.(node.id);
    const pt = svgPoint(ev);
    dragMode = { kind: "node", nodeId: node.id, startX: pt.x, startY: pt.y, origX: node.position.x, origY: node.position.y };
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
  }
  function onPointerMove(ev: PointerEvent) {
    if (!dragMode) return;
    const pt = svgPoint(ev), dx = pt.x - dragMode.startX, dy = pt.y - dragMode.startY;
    if (dragMode.kind === "pan") { panX = Math.round(dragMode.origX + dx); panY = Math.round(dragMode.origY + dy); }
    else onMoveNode?.(dragMode.nodeId, Math.round(dragMode.origX + dx / zoom), Math.round(dragMode.origY + dy / zoom));
  }
  function onPointerUp() { dragMode = null; }
  function clearSelection() { pendingFrom = null; onSelectNode?.(null); onSelectEdge?.(null); }
  function connectOut(nodeId: string, handle: string) { pendingFrom = { nodeId, handle }; }
  function connectIn(targetId: string) { if (!pendingFrom) return; onConnect?.(pendingFrom.nodeId, targetId, pendingFrom.handle); pendingFrom = null; }
  function onKeyActivate(ev: KeyboardEvent, fn: () => void) {
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); fn(); }
    else if (ev.key === "Escape") pendingFrom = null;
    else if ((ev.key === "Delete" || ev.key === "Backspace") && (selectedNodeId || selectedEdgeId)) { ev.preventDefault(); onDeleteSelection?.(); }
  }
</script>

<figure class="wf-canvas-card" data-workflow-canvas={graph.id} data-canvas-tone={tokens.tone}>
  <figcaption class="wf-canvas-header">
    <div class="wf-canvas-title">
      <strong>{graph.name}</strong>
      <span class="wf-canvas-badge" data-tone={tokens.tone}>{graph.status}</span>
      <span class="wf-canvas-count">{activeNodes.length}n / {activeEdges.length}e</span>
    </div>
    <div class="wf-canvas-controls">
      <button type="button" class="wf-tool-btn" aria-label="Zoom out" onclick={() => stepZoom(-0.15)}>-</button>
      <span class="wf-zoom-pct">{Math.round(zoom * 100)}%</span>
      <button type="button" class="wf-tool-btn" aria-label="Zoom in" onclick={() => stepZoom(0.15)}>+</button>
      <button type="button" class="wf-tool-btn" onclick={fitView}>Fit</button>
      {#if onTidy}<button type="button" class="wf-tool-btn" onclick={onTidy}>Tidy</button>{/if}
      {#if onDeleteSelection && (selectedNodeId || selectedEdgeId)}
        <button type="button" class="wf-tool-btn danger" onclick={onDeleteSelection}>Delete selected</button>
      {/if}
    </div>
  </figcaption>
  {#if pendingFrom}
    <div class="wf-connect-banner" role="status">
      <span>Click an input port to connect from <strong>{nodeMap.get(pendingFrom.nodeId)?.name ?? pendingFrom.nodeId}</strong> ({pendingFrom.handle}).</span>
      <button type="button" class="wf-tool-btn" onclick={() => { pendingFrom = null; }}>Cancel</button>
    </div>
  {/if}
  <div class="wf-svg-wrap">
    <svg bind:this={svgEl} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={svgLabel} preserveAspectRatio="xMidYMid meet" onpointermove={onPointerMove} onpointerup={onPointerUp} onpointercancel={onPointerUp}>
      <title>{svgLabel}</title>
      <defs>
        <pattern id={`${uid}-grid`} width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="var(--border)" /></pattern>
        <marker id={`${uid}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill={tokens.strokeToken} /></marker>
        <marker id={`${uid}-arrow-sel`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="var(--accent)" /></marker>
      </defs>
      <rect width={VIEW_W} height={VIEW_H} fill={`url(#${uid}-grid)`} class="wf-pan-bg" role="button" tabindex="0" aria-label="Pan canvas or clear selection" onpointerdown={startPan} onclick={clearSelection} onkeydown={(e) => onKeyActivate(e, clearSelection)} />
      <g transform={`translate(${panX} ${panY}) scale(${zoom})`}>
        {#if activeNodes.length === 0}
          <text x={VIEW_W / 2 - panX} y={VIEW_H / 2 - panY} text-anchor="middle" dominant-baseline="middle" fill="var(--muted)" font-size="13">No nodes configured in this workflow graph</text>
        {:else}
          {#each activeEdges as edge (edge.id)}
            {@const src = nodeMap.get(edge.source)}{@const tgt = nodeMap.get(edge.target)}
            {#if src && tgt}
              {@const p1 = outputPortPos(src, edge.sourceHandle)}{@const p2 = inputPortPos(tgt)}
              {@const d = bezierEdgePath(p1.x, p1.y, p2.x - 5, p2.y)}{@const isSel = selectedEdgeId === edge.id}
              <g class="wf-edge-group" role="button" tabindex="0" aria-label={`Select edge ${edge.source} to ${edge.target}`} onclick={(e) => { e.stopPropagation(); onSelectEdge?.(edge.id); }} onkeydown={(e) => onKeyActivate(e, () => onSelectEdge?.(edge.id))}>
                <path {d} fill="none" stroke="transparent" stroke-width="14" />
                <path {d} fill="none" stroke={isSel ? "var(--accent)" : tokens.strokeToken} stroke-width={isSel ? 3 : 2} stroke-dasharray={edge.disabled || edge.style === "dashed" ? "6 4" : undefined} stroke-opacity={edge.disabled ? 0.45 : 0.9} marker-end={`url(#${uid}-${isSel ? "arrow-sel" : "arrow"})`} />
                {#if edge.sourceHandle}<text x={(p1.x + p2.x) / 2} y={(p1.y + p2.y) / 2 - 6} text-anchor="middle" fill="var(--muted)" font-size="10">{edge.sourceHandle}</text>{/if}
              </g>
            {/if}
          {/each}
          {#each activeNodes as node (node.id)}
            {@const isSel = selectedNodeId === node.id}{@const rState = runNodeStates[node.id]}{@const handles = sourceHandlesOf(node)}
            {@const ringStroke = isSel ? "var(--accent)" : runStateStroke(rState, tokens.strokeToken)}
<g transform={`translate(${node.position.x} ${node.position.y})`} class="wf-node-group" data-node-id={node.id} opacity={node.disabled ? 0.55 : 1} role="button" tabindex="0" aria-label={`Node ${node.name} (${node.type})`} onpointerdown={(e) => startDragNode(e, node)} onclick={(e) => { e.stopPropagation(); onSelectNode?.(node.id); }} onkeydown={(e) => onKeyActivate(e, () =>
              onSelectNode?.(node.id))}>
              {#if rState || isSel}<rect x="-3" y="-3" width={STUDIO_NODE_W + 6} height={STUDIO_NODE_H + 6} rx="12" fill="none" stroke={ringStroke} stroke-width={isSel ? 2.5 : 2} stroke-opacity="0.85" />{/if}
              <rect width={STUDIO_NODE_W} height={STUDIO_NODE_H} rx="10" fill="var(--panel-solid)" stroke={ringStroke} stroke-width="1.5" />
              <rect x="10" y="10" width="66" height="18" rx="9" fill={tokens.fillToken} stroke={tokens.strokeToken} stroke-width="0.8" />
              <text x="43" y="20" text-anchor="middle" dominant-baseline="middle" fill="var(--text)" font-size="9.5" font-weight="600">{nodeBadgeOf(node)}</text>
              {#if rState}<text x={STUDIO_NODE_W - 10} y="20" text-anchor="end" dominant-baseline="middle" fill={ringStroke} font-size="9.5" font-weight="700">{rState}</text>{/if}
              <text x="12" y="47" fill="var(--text)" font-size="12" font-weight="600">{node.name.length > 22 ? `${node.name.slice(0, 21)}...` : node.name}</text>
              <text x="12" y="62" fill="var(--muted)" font-size="9.5">{node.type}</text>
              {#if canAcceptInput(node)}
<circle cx="0" cy={STUDIO_NODE_H / 2} r={pendingFrom ? 7 : 5.5} fill={pendingFrom ? "var(--accent)" : "var(--panel-solid)"} stroke={pendingFrom ? "var(--accent-text)" : "var(--muted)"} stroke-width="2" class="wf-port" data-port-in={node.id} role="button" tabindex="0" aria-label={`Connect input of ${node.name}`} onpointerdown={(e) => e.stopPropagation()} onclick={(e) => {
                  e.stopPropagation(); connectIn(node.id); }} onkeydown={(e) => onKeyActivate(e, () => connectIn(node.id))} />
              {/if}
              {#each handles as handle, hIdx (handle)}
                {@const py = handles.length === 1 ? STUDIO_NODE_H / 2 : STUDIO_NODE_H * ((hIdx + 1) / (handles.length + 1))}
<circle cx={STUDIO_NODE_W} cy={py} r="5.5" fill={pendingFrom?.nodeId === node.id && pendingFrom.handle === handle ? "var(--accent)" : tokens.strokeToken} stroke="var(--panel-solid)" stroke-width="2" class="wf-port" data-port-out={`${node.id}:${handle}`} role="button" tabindex="0" aria-label={`Connect output ${handle} of ${node.name}`} onpointerdown={(e) => e.stopPropagation()}
                  onclick={(e) => { e.stopPropagation(); connectOut(node.id, handle); }} onkeydown={(e) => onKeyActivate(e, () => connectOut(node.id, handle))} />
                {#if handles.length > 1}<text x={STUDIO_NODE_W - 10} y={py + 1} text-anchor="end" dominant-baseline="middle" fill="var(--muted)" font-size="9">{handle}</text>{/if}
              {/each}
            </g>
          {/each}
        {/if}
      </g>
    </svg>
  </div>
</figure>

<style>
  .wf-canvas-card { margin: 0; padding: 0.625rem; border: 1px solid var(--border); border-radius: 0.625rem; background: var(--surface); display: grid; gap: 0.5rem; min-width: 0; }
  .wf-canvas-header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; min-width: 0; }
  .wf-canvas-title, .wf-canvas-controls { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; min-width: 0; }
  .wf-canvas-count, .wf-zoom-pct { font-size: 0.75rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .wf-canvas-badge { display: inline-block; padding: 0.1rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.72rem; color: var(--muted); }
  .wf-canvas-badge[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .wf-canvas-badge[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .wf-tool-btn { min-height: 1.9rem; padding: 0.2rem 0.55rem; font-size: 0.78rem; }
  .wf-connect-banner { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; padding: 0.35rem 0.55rem; border: 1px solid var(--accent); border-radius: 0.5rem; background: var(--panel-solid); font-size: 0.8rem; }
  .wf-svg-wrap { width: 100%; min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); touch-action: none; }
  .wf-svg-wrap svg { display: block; width: 100%; max-width: 100%; height: clamp(15rem, 42vh, 26rem); user-select: none; }
  .wf-pan-bg { cursor: grab; } .wf-node-group { cursor: move; } .wf-edge-group, .wf-port { cursor: pointer; }
</style>
