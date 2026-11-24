<script lang="ts">
  import {
    ApiError,
    readChangelog,
    type ChangelogDay,
  } from "./settings-extra-api.ts";

  let {
    role = null,
    deviceLabel = null,
    resolvedChrome = "macos",
  }: {
    role?: "viewer" | "operator" | "owner" | null;
    deviceLabel?: string | null;
    resolvedChrome?: string;
  } = $props();

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let generated = $state(false);
  let days = $state<ChangelogDay[]>([]);
  let filterText = $state("");

  let abortCtrl: AbortController | undefined;

  let filteredDays = $derived.by<ChangelogDay[]>(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return days;
    return days
      .map((day) => ({
        date: day.date,
        groups: day.groups
          .map((g) => ({
            label: g.label,
            entries: g.entries.filter((e) =>
              `${day.date} ${g.label} ${e.scope} ${e.text}`.toLowerCase().includes(q),
            ),
          }))
          .filter((g) => g.entries.length > 0),
      }))
      .filter((day) => day.groups.length > 0);
  });

  function formatError(err: unknown): string {
    return err instanceof ApiError ? err.message : "Could not load release changelog.";
  }

  async function refresh() {
    abortCtrl?.abort();
    const ctrl = new AbortController();
    abortCtrl = ctrl;
    loading = true;
    loadError = null;
    try {
      const res = await readChangelog(ctrl.signal);
      if (ctrl.signal.aborted) return;
      generated = res.generated;
      days = res.days;
    } catch (err) {
      if (ctrl.signal.aborted) return;
      loadError = formatError(err);
    } finally {
      if (!ctrl.signal.aborted) loading = false;
    }
  }

  $effect(() => {
    void refresh();
    return () => {
      abortCtrl?.abort();
    };
  });
</script>

<div class="about-section" data-about-settings-state={loading ? "loading" : loadError ? "error" : "ready"}>
  <div class="settings-card">
    <h3 class="card-heading">About MSO</h3>
    <dl class="metric-grid">
      <div class="metric-box">
        <dt>License</dt>
        <dd>PolyForm Noncommercial</dd>
      </div>
      <div class="metric-box">
        <dt>Active shell</dt>
        <dd>{resolvedChrome}</dd>
      </div>
      <div class="metric-box">
        <dt>Session role</dt>
        <dd>{role ?? "unknown"}</dd>
      </div>
      <div class="metric-box">
        <dt>Device</dt>
        <dd>{deviceLabel ?? "Current browser"}</dd>
      </div>
    </dl>
  </div>

  <div class="settings-card">
    <div class="card-head-row">
      <h3 class="card-heading">What's New</h3>
      <button type="button" disabled={loading} onclick={() => void refresh()}>
        {loading ? "Loading..." : "Refresh"}
      </button>
    </div>

    <div class="field">
      <label class="sr-only" for="about-changelog-filter">Filter release notes</label>
      <input
        id="about-changelog-filter"
        type="search"
        bind:value={filterText}
        placeholder="Search changelog by scope, date, or keyword..."
      />
    </div>

    {#if loading}
      <p class="status-msg" role="status">Loading release changelog...</p>
    {:else if loadError}
      <div class="feedback error" role="alert">
        <p>{loadError}</p>
        <button type="button" onclick={() => void refresh()}>Retry</button>
      </div>
    {:else if !generated || days.length === 0}
      <p class="status-msg">No generated changelog is available on this checkout yet.</p>
    {:else if filteredDays.length === 0}
      <p class="status-msg">No changelog entries match "{filterText}".</p>
    {:else}
      <div class="changelog-scroll" aria-label="Release changelog">
        {#each filteredDays as day (day.date)}
          <article class="changelog-day">
            <h4 class="day-date">{day.date}</h4>
            {#each day.groups as group (`${day.date}-${group.label}`)}
              <div class="day-group">
                <p class="group-label">{group.label}</p>
                <ul class="entry-list">
                  {#each group.entries as entry, idx (`${day.date}-${group.label}-${idx}`)}
                    <li class="entry-row">
                      {#if entry.scope}
                        <code class="scope-chip">{entry.scope}</code>
                      {/if}
                      <span class="entry-text">{entry.text}</span>
                    </li>
                  {/each}
                </ul>
              </div>
            {/each}
          </article>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .about-section { display: grid; gap: 0.75rem; min-width: 0; }
  .settings-card {
    display: grid;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    min-width: 0;
  }
  .card-heading { margin: 0; font-size: 0.875rem; font-weight: 600; color: var(--text); }
  .card-head-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .status-msg { margin: 0; font-size: 0.875rem; color: var(--muted); }
  .metric-grid {
    display: grid;
    gap: 0.625rem;
    margin: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(9rem, 100%), 1fr));
  }
  .metric-box {
    padding: 0.625rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
    min-width: 0;
  }
  .metric-box dt { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .metric-box dd { margin: 0.25rem 0 0; font-size: 0.84rem; font-weight: 600; color: var(--text); overflow-wrap: anywhere; }
  .changelog-scroll {
    display: grid;
    gap: 0.875rem;
    max-height: 24rem;
    overflow-y: auto;
    padding-right: 0.25rem;
  }
  .changelog-day {
    display: grid;
    gap: 0.5rem;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface);
  }
  .day-date { margin: 0; font-size: 0.875rem; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
  .day-group { display: grid; gap: 0.35rem; }
  .group-label {
    margin: 0;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .entry-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.3rem; }
  .entry-row { display: flex; align-items: baseline; gap: 0.45rem; flex-wrap: wrap; font-size: 0.84rem; color: var(--text); }
  .scope-chip {
    padding: 0.08rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: 0.3rem;
    background: var(--panel-solid);
    font-family: var(--font-mono);
    font-size: 0.74rem;
    color: var(--accent);
  }
  .entry-text { flex: 1 1 12rem; overflow-wrap: anywhere; }
</style>
