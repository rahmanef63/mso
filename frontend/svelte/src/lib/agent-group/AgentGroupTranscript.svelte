<script lang="ts">
  import type { AgentGroupRun, AgentGroupTurn } from "./agent-group-api.ts";

  let { run, busy, onstop }: {
    run: AgentGroupRun;
    busy: boolean;
    onstop: (runId: string) => void;
  } = $props();

  function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }

  function toneFor(index: number): string {
    const tones = ["a", "b", "c", "d", "e"];
    return tones[index % tones.length]!;
  }

  function formatTime(iso: string): string {
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleTimeString();
  }

  function groupTurns(turns: AgentGroupTurn[]): Array<{ round: number; turns: AgentGroupTurn[] }> {
    const byRound = new Map<number, AgentGroupTurn[]>();
    for (const turn of turns) byRound.set(turn.round, [...(byRound.get(turn.round) ?? []), turn]);
    return [...byRound.entries()].map(([round, list]) => ({ round, turns: list })).sort((a, b) => a.round - b.round);
  }

  let rounds = $derived(groupTurns(run.turns));
</script>

<div class="ag-transcript" aria-label="Discussion transcript" aria-live="polite">
  <div class="ag-run-head">
    <div class="ag-row">
      <span class="pill" data-tone={run.state === "completed" ? "ok" : run.state === "failed" ? "danger" : run.state === "running" ? "warn" : "neutral"}>{run.state}</span>
      <span class="ag-meta">{run.turns.length} {run.turns.length === 1 ? "turn" : "turns"}</span>
      <span class="ag-meta">Started {formatTime(run.startedAt)}</span>
    </div>
    {#if run.state === "running"}
      <button type="button" class="danger" disabled={busy} onclick={() => onstop(run.id)}>Stop run</button>
    {/if}
  </div>
  <p class="ag-topic"><strong>Topic:</strong> {run.prompt}</p>
  {#if run.error}<p class="ag-err" role="alert">Error: {run.error}</p>{/if}

  {#if rounds.length === 0}
    <p class="ag-meta">{run.state === "running" ? "Waiting for the first agent reply..." : "This run produced no turns."}</p>
  {:else}
    {#each rounds as round (round.round)}
      <section class="ag-round" aria-label={`Round ${round.round}`}>
        <h4 class="ag-round-label">Round {round.round}</h4>
        {#each round.turns as turn, index (`${turn.round}:${turn.memberId}:${index}`)}
          <article class="ag-turn" data-turn-error={Boolean(turn.error)}>
            <div class="ag-avatar" data-tone={toneFor(index)} aria-hidden="true">{initials(turn.name)}</div>
            <div class="ag-turn-body">
              <div class="ag-row">
                <strong class="ag-turn-name">{turn.name}</strong>
                <span class="pill">{turn.profile}</span>
                <span class="ag-meta">turn {index + 1} · {formatTime(turn.at)}</span>
              </div>
              <p class="ag-turn-text">{turn.text}</p>
              {#if turn.error}<p class="ag-err" role="alert">{turn.error}</p>{/if}
            </div>
          </article>
        {/each}
      </section>
    {/each}
  {/if}
</div>

<style>
  .ag-transcript { display: grid; gap: 0.75rem; min-width: 0; }
  .ag-run-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .ag-row { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; min-width: 0; }
  .ag-topic { margin: 0; font-size: 0.875rem; color: var(--text); overflow-wrap: anywhere; }
  .ag-meta { margin: 0; font-size: 0.75rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .ag-err { margin: 0; font-size: 0.8125rem; color: var(--danger); overflow-wrap: anywhere; }
  .ag-round { display: grid; gap: 0.5rem; }
  .ag-round-label { margin: 0; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .ag-turn { display: flex; gap: 0.625rem; padding: 0.625rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel-solid); min-width: 0; }
  .ag-turn[data-turn-error="true"] { border-color: var(--danger); }
  .ag-avatar { flex: 0 0 auto; width: 2rem; height: 2rem; border-radius: 999px; display: grid; place-items: center; font-size: 0.75rem; font-weight: 700; color: var(--text); border: 1px solid var(--border); background: color-mix(in srgb, var(--accent) 22%, var(--panel-solid)); }
  .ag-avatar[data-tone="b"] { background: color-mix(in srgb, var(--ok) 24%, var(--panel-solid)); }
  .ag-avatar[data-tone="c"] { background: color-mix(in srgb, var(--warn) 26%, var(--panel-solid)); }
  .ag-avatar[data-tone="d"] { background: color-mix(in srgb, var(--danger) 20%, var(--panel-solid)); }
  .ag-avatar[data-tone="e"] { background: color-mix(in srgb, var(--muted) 26%, var(--panel-solid)); }
  .ag-turn-body { display: grid; gap: 0.25rem; min-width: 0; flex: 1; }
  .ag-turn-name { overflow-wrap: anywhere; }
  .ag-turn-text { margin: 0; font-size: 0.875rem; color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.7rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
</style>
