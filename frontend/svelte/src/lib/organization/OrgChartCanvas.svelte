<script lang="ts">
  import type { OrganizationChart, OrganizationSeat, OrganizationSeatRuntime, OrganizationUnit } from "./org-api.ts";
  import { connector, layoutSeats, layoutUnits } from "./org-layout.ts";

  let {
    chart, runtime, unitId, selectedSeatId, onselectunit, onselectseat, onopenseat,
  }: {
    chart: OrganizationChart;
    runtime: OrganizationSeatRuntime[];
    unitId: string;
    selectedSeatId: string | null;
    onselectunit: (id: string) => void;
    onselectseat: (seat: OrganizationSeat | null) => void;
    onopenseat: (seat: OrganizationSeat) => void;
  } = $props();

  const UNIT_W = 176, UNIT_H = 62, SEAT_W = 186, SEAT_H = 58;

  let runtimeBySeat = $derived(new Map(runtime.map((row) => [row.seatId, row])));
  let unitById = $derived(new Map(chart.units.map((unit) => [unit.id, unit])));

  let unitNodes = $derived(layoutUnits(chart, { maxColumns: 3, startX: 20, startY: 16 }));
  let seatNodes = $derived(unitId ? layoutSeats(chart, unitId, { maxColumns: 3, startX: 20, startY: 16 }) : []);

  let width = $derived(Math.max(...[...unitNodes, ...seatNodes].map((p) => p.x + SEAT_W), 260) + 24);
  let height = $derived(Math.max(...[...unitNodes, ...seatNodes].map((p) => p.y + SEAT_H), 90) + 28);

  let unitEdges = $derived.by(() => {
    const visible = new Set(unitNodes.map((node) => node.item.id));
    return chart.units
      .filter((unit) => unit.parentUnitId && visible.has(unit.parentUnitId))
      .map((unit) => ({ id: `u-${unit.parentUnitId}-${unit.id}`, from: unit.parentUnitId!, to: unit.id }));
  });

  let seatEdges = $derived.by(() => {
    const visible = new Set(seatNodes.map((node) => node.item.id));
    return seatNodes
      .filter((node) => node.item.reportsToSeatId && visible.has(node.item.reportsToSeatId))
      .map((node) => ({ id: `s-${node.item.reportsToSeatId}-${node.item.id}`, from: node.item.reportsToSeatId!, to: node.item.id, seat: node.item }));
  });

  let unitPoints = $derived(new Map(unitNodes.map((node) => [node.item.id, node])));
  let seatPoints = $derived(new Map(seatNodes.map((node) => [node.item.id, node])));

  function statusTone(status: OrganizationSeatRuntime["status"] | undefined): string {
    if (status === "ready") return "ok";
    if (status === "busy") return "warn";
    if (status === "offline" || status === "unresolved") return "danger";
    return "neutral";
  }

  function seatCount(unit: OrganizationUnit): number {
    return chart.seats.filter((seat) => seat.unitId === unit.id).length;
  }
</script>

<div class="org-canvas" data-org-canvas={unitId || "units"}>
  <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={unitId ? "Seats in the selected unit" : "Organization units tree"}>
    <g class="org-edges">
      {#if unitId}
        {#each seatEdges as edge (edge.id)}
          {@const from = seatPoints.get(edge.from)}
          {@const to = seatPoints.get(edge.to)}
          {#if from && to}
            {@const busy = runtimeBySeat.get(edge.from)?.status === "busy" || runtimeBySeat.get(edge.to)?.status === "busy"}
            <path
              d={connector(from.x + SEAT_W / 2, from.y + SEAT_H, to.x + SEAT_W / 2, to.y)}
              fill="none"
              stroke={busy ? "var(--warn)" : "var(--muted)"}
              stroke-width={busy ? 2.2 : 1.4}
              stroke-dasharray={edge.seat.reportsToSeatId && seatPoints.get(edge.seat.reportsToSeatId)?.external ? "6 4" : undefined}
            />
          {/if}
        {/each}
      {:else}
        {#each unitEdges as edge (edge.id)}
          {@const from = unitPoints.get(edge.from)}
          {@const to = unitPoints.get(edge.to)}
          {#if from && to}
            <path d={connector(from.x + UNIT_W / 2, from.y + UNIT_H, to.x + UNIT_W / 2, to.y)} fill="none" stroke="var(--muted)" stroke-width="1.4" />
          {/if}
        {/each}
      {/if}
    </g>

    {#if unitId}
      {#each seatNodes as node (node.item.id)}
        {@const rt = runtimeBySeat.get(node.item.id)}
        {@const tone = statusTone(rt?.status ?? (node.item.state === "vacant" ? "vacant" : undefined))}
        <g
          transform={`translate(${node.x} ${node.y})`}
          class="org-card"
          class:external={node.external}
          class:selected={selectedSeatId === node.item.id}
          role="button" tabindex="0"
          aria-pressed={selectedSeatId === node.item.id}
          aria-label={`${node.item.name}, ${node.item.title}, status ${rt?.status ?? node.item.state}`}
          onclick={() => onselectseat(node.item)}
          ondblclick={() => onopenseat(node.item)}
          onkeydown={(event) => {
            if (event.key === " " || event.key === "Enter") { event.preventDefault(); onselectseat(node.item); }
          }}
        >
          <rect width={SEAT_W} height={SEAT_H} rx="10" fill="var(--panel-solid)" stroke={selectedSeatId === node.item.id ? "var(--accent)" : "var(--border)"} stroke-width={selectedSeatId === node.item.id ? 2 : 1} />
          <circle cx="14" cy="18" r="4.5" fill={`var(--${tone === "ok" ? "ok" : tone === "warn" ? "warn" : tone === "danger" ? "danger" : "muted"})`} />
          <text x="26" y="22" font-size="11" font-weight="600" fill="var(--text)">{node.item.title.slice(0, 24)}</text>
          <text x="12" y="37" font-size="10" fill="var(--muted)">{node.item.name.slice(0, 26)}</text>
          <text x="12" y="50" font-size="9.5" fill="var(--muted)">{node.item.role.slice(0, 18)}{node.external ? " · parent unit" : ""}</text>
        </g>
      {/each}
      {#if seatNodes.length === 0}
        <text x={width / 2} y="46" text-anchor="middle" font-size="12" fill="var(--muted)">No seats assigned to this unit</text>
      {/if}
    {:else}
      {#each unitNodes as node (node.item.id)}
        <g
          transform={`translate(${node.x} ${node.y})`}
          class="org-card"
          role="button" tabindex="0"
          aria-label={`${node.item.name}, ${node.item.kind}, ${seatCount(node.item)} seats`}
          onclick={() => onselectunit(node.item.id)}
          onkeydown={(event) => {
            if (event.key === " " || event.key === "Enter") { event.preventDefault(); onselectunit(node.item.id); }
          }}
        >
          <rect width={UNIT_W} height={UNIT_H} rx="10" fill="var(--panel-solid)" stroke="var(--border)" />
          <text x="12" y="22" font-size="11.5" font-weight="600" fill="var(--text)">{node.item.name.slice(0, 24)}</text>
          <text x="12" y="37" font-size="9.5" fill="var(--muted)">{node.item.kind} · {node.item.status}</text>
          <text x="12" y="50" font-size="9.5" fill="var(--muted)">{seatCount(node.item)} {seatCount(node.item) === 1 ? "seat" : "seats"} · {node.item.key}</text>
        </g>
      {/each}
    {/if}
  </svg>
</div>

<style>
  .org-canvas { min-width: 0; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel); overflow: auto; }
  .org-canvas svg { display: block; width: 100%; height: auto; min-height: 8rem; max-height: 26rem; }
  .org-card { cursor: pointer; }
  .org-card.external { opacity: 0.72; }
  .org-card text { pointer-events: none; }
  .org-card:focus-visible rect { stroke: var(--accent); stroke-width: 2.5; }
</style>
