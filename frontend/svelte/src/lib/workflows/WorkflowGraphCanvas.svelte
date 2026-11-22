<script module lang="ts">
  import type { WorkflowGraphSummary } from "./workflows-api.ts";

  export type PreviewNode = { id: string; label: string; col: number; x: number; y: number; w: number; h: number };
  export type PreviewEdge = { id: string; from: string; to: string; d: string };
  export type WorkflowPreviewLayout = {
    width: number; height: number; nodes: PreviewNode[]; edges: PreviewEdge[];
    overflowNodes: number; strokeToken: string; fillToken: string; tone: "ok" | "warn" | "muted";
  };

  const MAX_NODES = 8;
  const NODE_W = 104;
  const NODE_H = 38;
  const COL_GAP = 140;
  const PAD_X = 20;

  function statusTokens(status: WorkflowGraphSummary["status"]) {
    if (status === "active") return { strokeToken: "var(--ok)", fillToken: "var(--ok-bg)", tone: "ok" as const };
    if (status === "draft") return { strokeToken: "var(--warn)", fillToken: "var(--warn-bg)", tone: "warn" as const };
    return { strokeToken: "var(--muted)", fillToken: "var(--surface)", tone: "muted" as const };
  }

  export function layoutWorkflowPreview(
    graph: Pick<WorkflowGraphSummary, "name" | "status" | "nodeCount" | "edgeCount">,
  ): WorkflowPreviewLayout {
    const tokens = statusTokens(graph.status);
    const totalNodes = Math.max(0, Math.floor(graph.nodeCount));
    const totalEdges = Math.max(0, Math.floor(graph.edgeCount));
    const visible = Math.min(totalNodes, MAX_NODES);
    const overflowNodes = Math.max(0, totalNodes - MAX_NODES);

    if (visible === 0) {
      return { width: 360, height: 120, nodes: [], edges: [], overflowNodes: 0, ...tokens };
    }

    const nodes: PreviewNode[] = [];
    let height = 126;
    let totalCols = visible;

    if (visible <= 4) {
      for (let i = 0; i < visible; i++) {
        const label = visible === 1 ? "Step 1" : i === 0 ? "Trigger" : i === visible - 1 ? "Output" : `Step ${i + 1}`;
        nodes.push({ id: `n-${i}`, label, col: i, x: PAD_X + i * COL_GAP, y: 44, w: NODE_W, h: NODE_H });
      }
    } else {
      height = 176;
      const midCount = visible - 2;
      const midCols = Math.ceil(midCount / 2);
      totalCols = midCols + 2;
      nodes.push({ id: "n-0", label: "Trigger", col: 0, x: PAD_X, y: 69, w: NODE_W, h: NODE_H });
      for (let k = 0; k < midCount; k++) {
        const col = 1 + Math.floor(k / 2);
        const solo = k % 2 === 0 && k === midCount - 1;
        const y = solo ? 69 : k % 2 === 0 ? 24 : 114;
        nodes.push({ id: `n-${k + 1}`, label: `Step ${k + 2}`, col, x: PAD_X + col * COL_GAP, y, w: NODE_W, h: NODE_H });
      }
      const lastX = PAD_X + (totalCols - 1) * COL_GAP;
      nodes.push({ id: `n-${visible - 1}`, label: "Output", col: totalCols - 1, x: lastX, y: 69, w: NODE_W, h: NODE_H });
    }

    const candidates: Array<[number, number]> = [];
    const seen = new Set<string>();
    const pushPair = (a: number, b: number) => {
      const key = `${a}->${b}`;
      if (a === b || seen.has(key)) return;
      seen.add(key);
      candidates.push([a, b]);
    };

    for (let c = 0; c < totalCols - 1; c++) {
      const left = nodes.map((n, i) => ({ n, i })).filter((x) => x.n.col === c);
      const right = nodes.map((n, i) => ({ n, i })).filter((x) => x.n.col === c + 1);
      for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const a = left[Math.min(i, left.length - 1)];
        const b = right[Math.min(i, right.length - 1)];
        if (a && b) pushPair(a.i, b.i);
      }
      for (const a of left) for (const b of right) pushPair(a.i, b.i);
    }
    for (let a = 0; a < nodes.length; a++) {
      for (let b = 0; b < nodes.length; b++) {
        if (nodes[b]!.col > nodes[a]!.col + 1) pushPair(a, b);
      }
    }

    const edges: PreviewEdge[] = candidates.slice(0, totalEdges).map(([aIdx, bIdx], idx) => {
      const a = nodes[aIdx]!;
      const b = nodes[bIdx]!;
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x - 4, y2 = b.y + b.h / 2;
      const cx = Math.round((x1 + x2) / 2);
      return { id: `e-${idx}`, from: a.id, to: b.id, d: `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}` };
    });

    const width = Math.max(320, PAD_X * 2 + (totalCols - 1) * COL_GAP + NODE_W);
    return { width, height, nodes, edges, overflowNodes, ...tokens };
  }
</script>

<script lang="ts">
  let { graph }: { graph: WorkflowGraphSummary } = $props();
  const uid = $props.id();
  let layout = $derived(layoutWorkflowPreview(graph));
  let svgLabel = $derived(
    `Workflow topology preview for ${graph.name}: ${graph.nodeCount} ${graph.nodeCount === 1 ? "node" : "nodes"}, ${graph.edgeCount} ${graph.edgeCount === 1 ? "edge" : "edges"}, status ${graph.status}`,
  );
</script>

<figure class="wf-canvas-card" data-workflow-canvas={graph.id} data-canvas-tone={layout.tone}>
  <figcaption class="wf-canvas-header">
    <div class="wf-canvas-title">
      <strong>{graph.name}</strong>
      <span class="wf-canvas-badge" data-tone={layout.tone}>{graph.status}</span>
    </div>
    <div class="wf-canvas-stats">
      <span>{graph.nodeCount} {graph.nodeCount === 1 ? "node" : "nodes"}</span>
      <span>{graph.edgeCount} {graph.edgeCount === 1 ? "edge" : "edges"}</span>
      {#if layout.overflowNodes > 0}<span>+{layout.overflowNodes} more</span>{/if}
    </div>
  </figcaption>

  <div class="wf-svg-wrap">
    <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={svgLabel} preserveAspectRatio="xMidYMid meet">
      <title>{svgLabel}</title>
      <defs>
        <marker id={`${uid}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill={layout.strokeToken} />
        </marker>
      </defs>
      {#if layout.nodes.length === 0}
        <text x={layout.width / 2} y={layout.height / 2} text-anchor="middle" dominant-baseline="middle" fill="var(--muted)" font-size="13">
          No nodes configured in this workflow graph
        </text>
      {:else}
        {#each layout.edges as edge (edge.id)}
          <path d={edge.d} fill="none" stroke={layout.strokeToken} stroke-width="2" stroke-opacity="0.85" marker-end={`url(#${uid}-arrow)`} />
        {/each}
        {#each layout.nodes as node (node.id)}
          <g transform={`translate(${node.x}, ${node.y})`}>
            <rect width={node.w} height={node.h} rx="8" fill={layout.fillToken} stroke={layout.strokeToken} stroke-width="1.5" />
            <text x={node.w / 2} y={node.h / 2 + 1} text-anchor="middle" dominant-baseline="middle" fill="var(--text)" font-size="12" font-weight="600">
              {node.label}
            </text>
          </g>
        {/each}
      {/if}
    </svg>
  </div>
</figure>

<style>
  .wf-canvas-card { margin: 0; padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); display: grid; gap: 0.625rem; min-width: 0; }
  .wf-canvas-header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; min-width: 0; }
  .wf-canvas-title { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; min-width: 0; }
  .wf-canvas-stats { display: flex; align-items: center; gap: 0.625rem; font-size: 0.8125rem; color: var(--muted); font-variant-numeric: tabular-nums; flex-wrap: wrap; }
  .wf-canvas-badge { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .wf-canvas-badge[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .wf-canvas-badge[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .wf-svg-wrap { width: 100%; min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 0.375rem; background: var(--panel); }
  .wf-svg-wrap svg { display: block; width: 100%; max-width: 100%; height: auto; }
</style>
