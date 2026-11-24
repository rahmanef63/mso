<script lang="ts">
  import type { OrganizationSeat, OrganizationSeatRuntime, OrganizationUnit } from "./org-api.ts";

  let {
    scopedToUnit, units, seats, runtime, selectedSeatId, onselectunit, onselectseat,
  }: {
    scopedToUnit: boolean;
    units: OrganizationUnit[];
    seats: OrganizationSeat[];
    runtime: Map<string, OrganizationSeatRuntime>;
    selectedSeatId: string | null;
    onselectunit: (id: string) => void;
    onselectseat: (seat: OrganizationSeat) => void;
  } = $props();

  function statusTone(status: OrganizationSeatRuntime["status"] | OrganizationSeat["state"] | undefined): string {
    if (status === "ready" || status === "active") return "ok";
    if (status === "busy") return "warn";
    if (status === "offline" || status === "unresolved") return "danger";
    return "neutral";
  }
</script>

<ul class="org-list" aria-label="Organization records">
  {#each scopedToUnit ? seats : units as row (row.id)}
    <li>
      {#if scopedToUnit && "unitId" in row}
        {@const seat = row as OrganizationSeat}
        {@const status = runtime.get(seat.id)?.status ?? seat.state}
        <button type="button" class="org-row" class:selected={selectedSeatId === seat.id} aria-pressed={selectedSeatId === seat.id} onclick={() => onselectseat(seat)}>
          <span class="org-row-title">{seat.title}</span>
          <span class="org-row-sub">{seat.name} · {seat.role}</span>
          <span class="pill" data-tone={statusTone(status)}>{status}</span>
          <span class="pill">{seat.target.kind}</span>
        </button>
      {:else}
        {@const unit = row as OrganizationUnit}
        <button type="button" class="org-row" onclick={() => onselectunit(unit.id)}>
          <span class="org-row-title">{unit.name}</span>
          <span class="org-row-sub">{unit.kind} · {unit.key}</span>
          <span class="pill" data-tone={statusTone(unit.status)}>{unit.status}</span>
          <span class="pill">{seats.filter((seat) => seat.unitId === unit.id).length} seats</span>
        </button>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .org-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.375rem; max-height: 26rem; overflow-y: auto; }
  .org-row { width: 100%; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; text-align: left; }
  .org-row.selected { border-color: var(--accent); background: var(--surface); }
  .org-row-title { font-weight: 600; overflow-wrap: anywhere; }
  .org-row-sub { font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
</style>
