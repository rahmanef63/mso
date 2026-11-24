<script lang="ts">
  import "./OrganizationApp.css";
  import { onMount } from "svelte";
  import {
    createOrganizationController,
    type OrganizationSeat,
    type OrganizationSeatRuntime,
    type OrganizationState,
    type OrganizationUnit,
  } from "./org-api.ts";
  import { mutateOrganization, type OrganizationMutation } from "./org-mutations.ts";
  import OrgChartCanvas from "./OrgChartCanvas.svelte";
  import OrgEditorDrawer from "./OrgEditorDrawer.svelte";
  import OrgInspector from "./OrgInspector.svelte";
  import OrgRecordList from "./OrgRecordList.svelte";
  import OrgToolbar from "./OrgToolbar.svelte";

  let { role = null }: { role?: "viewer" | "operator" | "owner" | null } = $props();

  type EditorState = { mode: "unit"; unit: OrganizationUnit | null } | { mode: "seat"; seat: OrganizationSeat | null } | null;

  let view = $state<OrganizationState>({ kind: "loading" });
  let filterQuery = $state("");
  let unitId = $state("");
  let selectedSeatId = $state<string | null>(null);
  let mode = $state<"chart" | "list">("chart");
  let editor = $state<EditorState>(null);
  let saving = $state(false);
  let actionError = $state("");
  let notice = $state("");
  let controller: ReturnType<typeof createOrganizationController> | undefined;

  // The shell does not pass a role to this app, so edits stay visible and the server decides.
  // Organization writes require operator (seat execution bindings require Owner).
  let canEdit = $derived(role !== "viewer");

  let runtimeBySeat = $derived.by(() => {
    if (view.kind !== "ready") return new Map<string, OrganizationSeatRuntime>();
    return new Map(view.runtime.map((entry) => [entry.seatId, entry]));
  });

  let units = $derived.by<OrganizationUnit[]>(() => (view.kind === "ready"
    ? [...view.chart.units].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    : []));

  let seats = $derived.by<OrganizationSeat[]>(() => (view.kind === "ready"
    ? [...view.chart.seats].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    : []));

  let selectedSeat = $derived.by<OrganizationSeat | null>(() =>
    selectedSeatId ? seats.find((seat) => seat.id === selectedSeatId) ?? null : null);

  let scopedUnit = $derived.by<OrganizationUnit | null>(() =>
    unitId ? units.find((unit) => unit.id === unitId) ?? null : null);

  let filteredSeats = $derived.by<OrganizationSeat[]>(() => {
    const query = filterQuery.trim().toLowerCase();
    const scoped = unitId ? seats.filter((seat) => seat.unitId === unitId) : seats;
    if (!query) return scoped;
    return scoped.filter((seat) => {
      const runtime = runtimeBySeat.get(seat.id);
      const detail = seat.target.kind === "project-agent" ? seat.target.project
        : seat.target.kind === "local-agent" || seat.target.kind === "a2a" ? seat.target.ref : "";
      return `${seat.name} ${seat.title} ${seat.role} ${seat.state} ${seat.seatMode} ${seat.target.kind} ${detail} ${runtime?.status ?? ""} ${runtime?.label ?? ""} ${seat.responsibilities.join(" ")}`
        .toLowerCase().includes(query);
    });
  });

  let filteredUnits = $derived.by<OrganizationUnit[]>(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) return units;
    return units.filter((unit) =>
      `${unit.name} ${unit.key} ${unit.kind} ${unit.status} ${unit.description ?? ""}`.toLowerCase().includes(query));
  });

  let stateTag = $derived.by(() => {
    if (view.kind !== "ready") return view.kind;
    if (units.length === 0 && seats.length === 0) return "empty";
    if (unitId ? filteredSeats.length === 0 : filteredUnits.length === 0) return "no-filter-matches";
    return "ready";
  });

  function selectUnit(id: string) {
    unitId = id;
    selectedSeatId = null;
    mode = "chart";
  }

  function clearScope() {
    unitId = "";
    selectedSeatId = null;
  }

  async function submitEdit(payload: { unit?: Record<string, unknown>; seat?: Record<string, unknown> }) {
    if (view.kind !== "ready" || saving) return;
    const mutation: OrganizationMutation = payload.unit
      ? { action: "unit_upsert", unit: payload.unit }
      : { action: "seat_upsert", seat: payload.seat ?? {} };
    saving = true;
    actionError = "";
    notice = "";
    try {
      await mutateOrganization(mutation, view.chart.revision, new AbortController().signal);
      notice = payload.unit ? "Unit saved." : "Seat saved.";
      editor = null;
      void controller?.refresh();
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : "Could not save the organization chart.";
    } finally {
      saving = false;
    }
  }

  async function removeRecord(kind: "unit" | "seat", id: string) {
    if (view.kind !== "ready" || saving) return;
    saving = true;
    actionError = "";
    notice = "";
    try {
      await mutateOrganization(
        { action: kind === "unit" ? "unit_delete" : "seat_delete", id },
        view.chart.revision,
        new AbortController().signal,
      );
      notice = kind === "unit" ? "Unit deleted." : "Seat deleted.";
      if (kind === "unit" && unitId === id) clearScope();
      if (kind === "seat" && selectedSeatId === id) selectedSeatId = null;
      void controller?.refresh();
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : "Could not delete the record.";
    } finally {
      saving = false;
    }
  }

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
  <OrgToolbar
    title={view.kind === "ready" ? view.chart.name : "Organization"}
    revision={view.kind === "ready" ? view.chart.revision : null}
    {mode}
    {canEdit}
    hasUnits={units.length > 0}
    loading={view.kind === "loading"}
    {unitId}
    counts={{ units: units.length, seats: seats.length }}
    onmode={(value) => { mode = value; }}
    onnewunit={() => { editor = { mode: "unit", unit: null }; }}
    onnewseat={() => { editor = { mode: "seat", seat: null }; }}
    onrefresh={refresh}
    onclearscope={clearScope}
  />

  <div class="org-filter-wrap">
    <label for="org-filter">Filter units and seats</label>
    <input id="org-filter" type="search" bind:value={filterQuery} placeholder="Unit, seat name, role, target, or runtime status" />
  </div>

  {#if notice}<p class="feedback ok" role="status">{notice}</p>{/if}
  {#if actionError}<p class="feedback error" role="alert">{actionError}</p>{/if}

  <div role="status" aria-live="polite">
    {#if view.kind === "loading"}
      <p>Loading organization chart...</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else if units.length === 0 && seats.length === 0}
      <p>No organization units or seats are configured yet.</p>
    {:else}
      <div class="org-workspace">
        <div class="org-main">
          {#if mode === "chart"}
            <OrgChartCanvas
              chart={{ ...view.chart, units: filteredUnits, seats: filteredSeats }}
              runtime={view.runtime}
              {unitId}
              {selectedSeatId}
              onselectunit={selectUnit}
              onselectseat={(seat) => { selectedSeatId = seat ? seat.id : null; }}
              onopenseat={(seat) => { selectedSeatId = seat.id; }}
            />
          {:else if (unitId ? filteredSeats.length : filteredUnits.length) === 0}
            <p>No units or seats match "{filterQuery.trim()}".</p>
          {:else}
            <OrgRecordList
              scopedToUnit={Boolean(unitId)}
              units={filteredUnits}
              seats={filteredSeats}
              runtime={runtimeBySeat}
              {selectedSeatId}
              onselectunit={selectUnit}
              onselectseat={(seat) => { selectedSeatId = seat.id; }}
            />
          {/if}
        </div>

        <OrgInspector
          seat={selectedSeat}
          unit={scopedUnit}
          {units}
          {seats}
          runtime={runtimeBySeat}
          {saving}
          {canEdit}
          oneditseat={(seat) => { editor = { mode: "seat", seat }; }}
          oneditunit={(unit) => { editor = { mode: "unit", unit }; }}
          ondelete={(kind, id) => void removeRecord(kind, id)}
        />
      </div>
    {/if}
  </div>
</section>

{#if editor}
  <OrgEditorDrawer
    mode={editor.mode}
    unit={editor.mode === "unit" ? editor.unit : null}
    seat={editor.mode === "seat" ? editor.seat : null}
    {units}
    {seats}
    busy={saving}
    error={actionError}
    onsubmit={(payload) => void submitEdit(payload)}
    onclose={() => { editor = null; actionError = ""; }}
  />
{/if}
