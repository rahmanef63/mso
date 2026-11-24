<script lang="ts">
  import type {
    OrganizationRuntimeStatus, OrganizationSeat, OrganizationSeatRuntime,
    OrganizationTarget, OrganizationUnit,
  } from "./org-api.ts";

  let {
    seat, unit, units, seats, runtime, saving, canEdit, oneditseat, oneditunit, ondelete,
  }: {
    seat: OrganizationSeat | null;
    unit: OrganizationUnit | null;
    units: OrganizationUnit[];
    seats: OrganizationSeat[];
    runtime: Map<string, OrganizationSeatRuntime>;
    saving: boolean;
    canEdit: boolean;
    oneditseat: (seat: OrganizationSeat) => void;
    oneditunit: (unit: OrganizationUnit) => void;
    ondelete: (kind: "unit" | "seat", id: string) => void;
  } = $props();

  function runtimeTone(status: OrganizationRuntimeStatus): "ok" | "warn" | "danger" | "neutral" {
    if (status === "ready") return "ok";
    if (status === "busy") return "warn";
    if (status === "offline" || status === "unresolved") return "danger";
    return "neutral";
  }

  function seatRuntime(target: OrganizationSeat): OrganizationSeatRuntime {
    const found = runtime.get(target.id);
    if (found) return found;
    if (target.state === "vacant") return { seatId: target.id, targetKind: target.target.kind, status: "vacant" };
    if (target.target.kind === "none") return { seatId: target.id, targetKind: "none", status: "unbound" };
    return { seatId: target.id, targetKind: target.target.kind, status: "unresolved" };
  }

  function targetDetail(target: OrganizationTarget): string {
    if (target.kind === "project-agent") return target.project;
    if (target.kind === "local-agent" || target.kind === "a2a") return target.ref;
    return "";
  }

  let scoped = $derived.by(() => {
    if (seat) {
      const status = seatRuntime(seat);
      return {
        kind: "seat" as const, seat, status,
        reference: status.label || targetDetail(seat.target),
        unitName: units.find((row) => row.id === seat.unitId)?.name ?? seat.unitId,
      };
    }
    if (unit) {
      return {
        kind: "unit" as const, unit,
        parentName: units.find((row) => row.id === unit.parentUnitId)?.name ?? "top level",
        seatCount: seats.filter((row) => row.unitId === unit.id).length,
      };
    }
    return null;
  });
</script>

<aside class="org-inspector" aria-label="Selection inspector">
  {#if scoped?.kind === "seat"}
    {@const current = scoped}
    <div class="org-row">
      <h3>{current.seat.title}</h3>
      <span class="pill" data-tone={runtimeTone(current.status.status)}>{current.status.status}</span>
    </div>
    <p class="org-meta">{current.seat.name} · {current.seat.role}</p>
    <dl class="org-meta-grid">
      <div><dt>Unit</dt><dd>{current.unitName}</dd></div>
      <div><dt>Mode</dt><dd>{current.seat.seatMode}</dd></div>
      <div><dt>Target</dt><dd>{current.seat.target.kind}</dd></div>
      <div><dt>Reference</dt><dd>{current.reference || "unbound"}</dd></div>
    </dl>
    {#if current.status.detail}<p class="org-meta">Runtime: {current.status.detail}</p>{/if}
    {#if current.seat.description}<p class="org-meta">{current.seat.description}</p>{/if}
    {#if current.seat.responsibilities.length > 0}
      <h4>Responsibilities</h4>
      <ul class="org-resp">
        {#each current.seat.responsibilities as item, i (`${i}:${item}`)}<li>{item}</li>{/each}
      </ul>
    {/if}
    {#if canEdit}
      <div class="actions">
        <button type="button" onclick={() => oneditseat(current.seat)}>Edit seat</button>
        <button type="button" class="danger" disabled={saving} onclick={() => ondelete("seat", current.seat.id)}>Delete seat</button>
      </div>
    {/if}
  {:else if scoped?.kind === "unit"}
    {@const current = scoped}
    <div class="org-row">
      <h3>{current.unit.name}</h3>
      <span class="pill" data-tone={current.unit.status === "active" ? "ok" : "neutral"}>{current.unit.status}</span>
    </div>
    <p class="org-meta">{current.unit.kind} · key {current.unit.key}</p>
    {#if current.unit.description}<p class="org-meta">{current.unit.description}</p>{/if}
    <dl class="org-meta-grid">
      <div><dt>Seats</dt><dd>{current.seatCount}</dd></div>
      <div><dt>Parent</dt><dd>{current.parentName}</dd></div>
    </dl>
    {#if canEdit}
      <div class="actions">
        <button type="button" onclick={() => oneditunit(current.unit)}>Edit unit</button>
        <button type="button" class="danger" disabled={saving} onclick={() => ondelete("unit", current.unit.id)}>Delete unit</button>
      </div>
    {/if}
  {:else}
    <p class="org-meta">Select a unit or seat to inspect its execution binding.</p>
  {/if}
</aside>

<style>
  .org-inspector { padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); display: grid; gap: 0.5rem; min-width: 0; }
  .org-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .org-inspector h4 { margin: 0.25rem 0 0; font-size: 0.875rem; }
  .org-meta-grid { margin: 0; grid-template-columns: repeat(auto-fit, minmax(min(6.5rem, 100%), 1fr)); }
  .org-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .org-resp { margin: 0; padding-left: 1.1rem; font-size: 0.8125rem; color: var(--text); display: grid; gap: 0.15rem; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
</style>
