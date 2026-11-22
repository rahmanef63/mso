<script lang="ts">
  import { onMount } from "svelte";
  import {
    createOrganizationController,
    type OrganizationRuntimeStatus,
    type OrganizationSeat,
    type OrganizationSeatRuntime,
    type OrganizationState,
    type OrganizationTarget,
    type OrganizationUnit,
  } from "./org-api.ts";

  let view = $state<OrganizationState>({ kind: "loading" });
  let filterQuery = $state("");
  let controller: ReturnType<typeof createOrganizationController> | undefined;

  type UnitGroup = { unit: OrganizationUnit; seats: OrganizationSeat[] };

  let runtimeBySeat = $derived.by(() => {
    if (view.kind !== "ready") return new Map<string, OrganizationSeatRuntime>();
    return new Map(view.runtime.map((entry) => [entry.seatId, entry]));
  });

  function seatRuntime(seat: OrganizationSeat): OrganizationSeatRuntime {
    const found = runtimeBySeat.get(seat.id);
    if (found) return found;
    if (seat.state === "vacant") return { seatId: seat.id, targetKind: seat.target.kind, status: "vacant" };
    if (seat.target.kind === "none") return { seatId: seat.id, targetKind: "none", status: "unbound" };
    return { seatId: seat.id, targetKind: seat.target.kind, status: "unresolved" };
  }

  function targetDetail(target: OrganizationTarget): string {
    if (target.kind === "project-agent") return target.project;
    if (target.kind === "local-agent" || target.kind === "a2a") return target.ref;
    return "";
  }

  function runtimeTone(status: OrganizationRuntimeStatus): "ok" | "warn" | "danger" | "neutral" {
    if (status === "ready") return "ok";
    if (status === "busy") return "warn";
    if (status === "offline" || status === "unresolved") return "danger";
    return "neutral";
  }

  let groupedUnits = $derived.by<UnitGroup[]>(() => {
    if (view.kind !== "ready") return [];
    const q = filterQuery.trim().toLowerCase();
    const sortedUnits = [...view.chart.units].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const sortedSeats = [...view.chart.seats].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const seatsByUnit = new Map<string, OrganizationSeat[]>();
    for (const seat of sortedSeats) {
      const list = seatsByUnit.get(seat.unitId);
      if (list) list.push(seat);
      else seatsByUnit.set(seat.unitId, [seat]);
    }
    const groups: UnitGroup[] = [];
    for (const unit of sortedUnits) {
      const unitSeats = seatsByUnit.get(unit.id) ?? [];
      if (!q) { groups.push({ unit, seats: unitSeats }); continue; }
      const unitHaystack = `${unit.name} ${unit.key} ${unit.kind} ${unit.status} ${unit.description ?? ""}`.toLowerCase();
      if (unitHaystack.includes(q)) { groups.push({ unit, seats: unitSeats }); continue; }
      const matchedSeats = unitSeats.filter((seat) => {
        const rt = seatRuntime(seat);
        return `${seat.name} ${seat.title} ${seat.role} ${seat.state} ${seat.seatMode} ${seat.target.kind} ${targetDetail(seat.target)} ${rt.status} ${rt.label ?? ""} ${seat.responsibilities.join(" ")}`
          .toLowerCase().includes(q);
      });
      if (matchedSeats.length > 0) groups.push({ unit, seats: matchedSeats });
    }
    return groups;
  });

  let stateTag = $derived.by(() => {
    if (view.kind !== "ready") return view.kind;
    if (view.chart.units.length === 0 && view.chart.seats.length === 0) return "empty";
    return groupedUnits.length === 0 ? "no-filter-matches" : "ready";
  });

  export function refresh() {
    void controller?.refresh();
  }

  onMount(() => {
    controller = createOrganizationController((next) => { view = next; });
    void controller.refresh();
    return () => controller?.dispose();
  });
</script>

<section aria-labelledby="org-title" aria-busy={view.kind === "loading"} data-org-state={stateTag}>
  <header class="feature-header">
    <div class="org-title-wrap">
      <h2 id="org-title">{view.kind === "ready" ? view.chart.name : "Organization"}</h2>
      {#if view.kind === "ready"}
        <code class="org-rev" title={view.chart.revision}>rev {view.chart.revision.slice(0, 12)}</code>
      {/if}
    </div>
    <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
      {view.kind === "loading" ? "Loading..." : "Refresh"}
    </button>
  </header>

  <div class="org-filter-wrap">
    <label for="org-filter">Filter units and seats</label>
    <input id="org-filter" type="search" bind:value={filterQuery} placeholder="Unit, seat name, role, target kind, or runtime status" />
  </div>

  <div role="status" aria-live="polite">
    {#if view.kind === "loading"}
      <p>Loading organization chart...</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else if view.chart.units.length === 0 && view.chart.seats.length === 0}
      <p>No organization units or seats are configured yet.</p>
    {:else if groupedUnits.length === 0}
      <p>No units or seats match "{filterQuery.trim()}".</p>
    {:else}
      <p class="org-summary">
        {view.chart.units.length} {view.chart.units.length === 1 ? "unit" : "units"} |
        {view.chart.seats.length} {view.chart.seats.length === 1 ? "seat" : "seats"}
      </p>
      <ul class="org-unit-list" aria-label="Organization units">
        {#each groupedUnits as group (group.unit.id)}
          <li class="org-unit">
            <div class="org-unit-head">
              <strong>{group.unit.name}</strong>
              <code>{group.unit.key}</code>
              <span class="pill">{group.unit.kind}</span>
              <span class="pill" data-tone={group.unit.status === "active" ? "ok" : "neutral"}>{group.unit.status}</span>
            </div>
            {#if group.unit.description}
              <p class="org-desc">{group.unit.description}</p>
            {/if}
            {#if group.seats.length === 0}
              <p class="org-meta">No seats assigned to this unit.</p>
            {:else}
              <ul class="org-seat-list" aria-label={`Seats in ${group.unit.name}`}>
                {#each group.seats as seat (seat.id)}
                  {@const rt = seatRuntime(seat)}
                  {@const refText = rt.label || targetDetail(seat.target)}
                  <li class="org-seat">
                    <div class="org-seat-head">
                      <strong>{seat.name}</strong>
                      <span class="org-seat-title">{seat.title}</span>
                      <span class="pill" data-tone={runtimeTone(rt.status)}>{rt.status}</span>
                      <span class="pill">{seat.target.kind}</span>
                    </div>
                    <p class="org-meta">
                      Role: {seat.role} | Mode: {seat.seatMode}{#if refText} | Target: {refText}{/if}
                    </p>
                    {#if rt.detail}
                      <p class="org-meta">Runtime: {rt.detail}</p>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .org-title-wrap { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
  .org-rev { font-size: 0.75rem; color: var(--muted); padding: 0.125rem 0.375rem; border: 1px solid var(--border); border-radius: 0.25rem; }
  .org-filter-wrap { display: grid; gap: 0.375rem; margin: 1rem 0; }
  .org-filter-wrap label { font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .org-filter-wrap input { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .org-summary { margin: 0 0 0.5rem; font-size: 0.875rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .org-unit-list, .org-seat-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.625rem; }
  .org-unit-list { max-height: 26rem; overflow-y: auto; }
  .org-unit { padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); display: grid; gap: 0.5rem; }
  .org-unit-head, .org-seat-head { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .org-unit-head code, .org-seat-title { font-size: 0.8125rem; color: var(--muted); }
  .org-seat { padding: 0.625rem; border: 1px solid var(--border); border-radius: 0.375rem; background: var(--panel); display: grid; gap: 0.25rem; }
  .org-desc { margin: 0; font-size: 0.875rem; color: var(--muted); }
  .org-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
</style>
