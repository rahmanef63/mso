<script lang="ts">
  import { untrack } from "svelte";
  import type { OrganizationSeat, OrganizationUnit } from "./org-api.ts";
  import {
    draftTarget, emptySeatDraft, emptyUnitDraft, seatDraftFrom, unitDraftFrom,
    validateSeatDraft, validateUnitDraft, type SeatDraft, type UnitDraft,
  } from "./org-mutations.ts";

  let {
    mode, unit, seat, units, seats, busy, error, onsubmit, onclose,
  }: {
    mode: "unit" | "seat";
    unit: OrganizationUnit | null;
    seat: OrganizationSeat | null;
    units: OrganizationUnit[];
    seats: OrganizationSeat[];
    busy: boolean;
    error: string;
    onsubmit: (payload: { unit?: Record<string, unknown>; seat?: Record<string, unknown> }) => void;
    onclose: () => void;
  } = $props();

  let draftUnit = $state<UnitDraft>(untrack(() => (unit ? unitDraftFrom(unit) : emptyUnitDraft())));
  let draftSeat = $state<SeatDraft>(untrack(() => (seat ? seatDraftFrom(seat) : emptySeatDraft())));
  let localError = $state("");

  let unitKinds: OrganizationUnit["kind"][] = ["holding", "company", "division", "team", "client", "other"];
  let seatStates: OrganizationSeat["state"][] = ["active", "vacant", "inactive"];
  let seatModes: OrganizationSeat["seatMode"][] = ["permanent", "on_demand", "inactive"];
  let targetKinds: OrganizationSeat["target"]["kind"][] = ["none", "project-agent", "local-agent", "a2a"];

  let title = $derived(mode === "unit"
    ? (unit ? `Edit unit: ${unit.name}` : "New unit")
    : (seat ? `Edit seat: ${seat.name}` : "New seat"));

  function submit(event: Event) {
    event.preventDefault();
    if (busy) return;
    if (mode === "unit") {
      const problem = validateUnitDraft(draftUnit);
      if (problem) { localError = problem; return; }
      localError = "";
      onsubmit({
        unit: {
          ...draftUnit,
          key: draftUnit.key.trim().toLowerCase(),
          name: draftUnit.name.trim(),
          description: draftUnit.description.trim(),
          parentUnitId: draftUnit.parentUnitId || undefined,
        },
      });
      return;
    }
    const problem = validateSeatDraft(draftSeat);
    if (problem) { localError = problem; return; }
    localError = "";
    onsubmit({
      seat: {
        ...draftSeat,
        name: draftSeat.name.trim(),
        title: draftSeat.title.trim(),
        role: draftSeat.role.trim(),
        description: draftSeat.description.trim(),
        reportsToSeatId: draftSeat.reportsToSeatId || undefined,
        responsibilities: draftSeat.responsibilities.split("\n").map((line) => line.trim()).filter(Boolean),
        target: draftTarget(draftSeat),
      },
    });
  }
</script>

<div class="org-drawer" role="dialog" aria-modal="true" aria-labelledby="org-drawer-title">
  <form class="org-drawer-body" onsubmit={submit}>
    <header class="org-drawer-head">
      <h3 id="org-drawer-title">{title}</h3>
      <button type="button" onclick={onclose} aria-label="Close editor">Close</button>
    </header>

    {#if localError}<p class="feedback error" role="alert">{localError}</p>{/if}
    {#if error}<p class="feedback error" role="alert">{error}</p>{/if}

    {#if mode === "unit"}
      <div class="org-fields">
        <div class="field">
          <label for="unit-name">Unit name</label>
          <input id="unit-name" bind:value={draftUnit.name} maxlength="120" required />
        </div>
        <div class="field">
          <label for="unit-key">Unit key</label>
          <input id="unit-key" bind:value={draftUnit.key} maxlength="64" required placeholder="core-platform" />
        </div>
        <div class="field">
          <label for="unit-kind">Kind</label>
          <select id="unit-kind" bind:value={draftUnit.kind}>
            {#each unitKinds as kind (kind)}<option value={kind}>{kind}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="unit-status">Status</label>
          <select id="unit-status" bind:value={draftUnit.status}>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </div>
        <div class="field">
          <label for="unit-parent">Parent unit</label>
          <select id="unit-parent" bind:value={draftUnit.parentUnitId}>
            <option value="">No parent (top level)</option>
            {#each units.filter((row) => row.id !== draftUnit.id) as option (option.id)}
              <option value={option.id}>{option.name}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="unit-order">Sort order</label>
          <input id="unit-order" type="number" bind:value={draftUnit.sortOrder} />
        </div>
        <div class="field org-wide">
          <label for="unit-desc">Description</label>
          <textarea id="unit-desc" rows="2" bind:value={draftUnit.description} maxlength="1000"></textarea>
        </div>
      </div>
    {:else}
      <div class="org-fields">
        <div class="field">
          <label for="seat-name">Seat name</label>
          <input id="seat-name" bind:value={draftSeat.name} maxlength="120" required />
        </div>
        <div class="field">
          <label for="seat-title">Title</label>
          <input id="seat-title" bind:value={draftSeat.title} maxlength="160" required />
        </div>
        <div class="field">
          <label for="seat-role">Role</label>
          <input id="seat-role" bind:value={draftSeat.role} maxlength="80" required />
        </div>
        <div class="field">
          <label for="seat-unit">Unit</label>
          <select id="seat-unit" bind:value={draftSeat.unitId} required>
            {#each units as option (option.id)}<option value={option.id}>{option.name}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="seat-state">State</label>
          <select id="seat-state" bind:value={draftSeat.state}>
            {#each seatStates as value (value)}<option value={value}>{value}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="seat-mode">Seat mode</label>
          <select id="seat-mode" bind:value={draftSeat.seatMode}>
            {#each seatModes as value (value)}<option value={value}>{value}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="seat-reports">Reports to</label>
          <select id="seat-reports" bind:value={draftSeat.reportsToSeatId}>
            <option value="">No reporting parent</option>
            {#each seats.filter((row) => row.id !== draftSeat.id) as option (option.id)}
              <option value={option.id}>{option.title} ({option.name})</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="seat-order">Sort order</label>
          <input id="seat-order" type="number" bind:value={draftSeat.sortOrder} />
        </div>
        <div class="field">
          <label for="seat-target">Execution target</label>
          <select id="seat-target" bind:value={draftSeat.targetKind}>
            {#each targetKinds as value (value)}<option value={value}>{value}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="seat-ref">Target reference</label>
          <input
            id="seat-ref"
            bind:value={draftSeat.targetRef}
            disabled={draftSeat.targetKind === "none"}
            placeholder={draftSeat.targetKind === "project-agent" ? "project id" : "agent reference"}
          />
        </div>
        <div class="field org-wide">
          <label for="seat-resp">Responsibilities, one per line</label>
          <textarea id="seat-resp" rows="3" bind:value={draftSeat.responsibilities}></textarea>
        </div>
        <div class="field org-wide">
          <label for="seat-desc">Description</label>
          <textarea id="seat-desc" rows="2" bind:value={draftSeat.description} maxlength="1000"></textarea>
        </div>
      </div>
      <p class="org-hint">Changing an execution binding requires Owner authority. Operator edits keep the current target.</p>
    {/if}

    <footer class="org-drawer-foot">
      <button type="submit" class="primary" disabled={busy}>{busy ? "Saving..." : "Save"}</button>
      <button type="button" onclick={onclose} disabled={busy}>Cancel</button>
    </footer>
  </form>
</div>

<style>
  .org-drawer { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; background: color-mix(in srgb, var(--text) 35%, transparent); padding: 0.75rem; }
  .org-drawer-body { width: min(100%, 34rem); max-height: min(88vh, 42rem); overflow-y: auto; display: grid; gap: 0.75rem; padding: 1rem; border: 1px solid var(--border); border-radius: 0.75rem; background: var(--panel-solid); }
  .org-drawer-head, .org-drawer-foot { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .org-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr)); gap: 0.625rem; }
  .org-fields .field input, .org-fields .field select, .org-fields .field textarea { width: 100%; min-width: 0; }
  .org-wide { grid-column: 1 / -1; }
  .org-hint { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  @media (max-width: 26rem) {
    .org-fields { grid-template-columns: 1fr; }
  }
</style>
