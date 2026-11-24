<script lang="ts">
  import type { AgentGroupRun, AgentGroupView } from "./agent-group-api.ts";
  import AgentGroupTranscript from "./AgentGroupTranscript.svelte";

  let {
    group, run, topic, busy, busyAction, mutationBusy,
    ontopic, onstart, onstop, onedit, ondelete,
  }: {
    group: AgentGroupView;
    run: AgentGroupRun | null;
    topic: string;
    busy: boolean;
    busyAction: "run" | "stop" | null;
    mutationBusy: boolean;
    ontopic: (value: string) => void;
    onstart: (event: Event) => void;
    onstop: (runId: string) => void;
    onedit: () => void;
    ondelete: () => void;
  } = $props();
</script>

<div class="ag-room" aria-label="Discussion room">
  <div class="ag-room-head">
    <div class="ag-row">
      <h3>{group.name}</h3>
      <span class="pill">{group.members.length} {group.members.length === 1 ? "agent" : "agents"}</span>
      <span class="pill">{group.maxRounds} {group.maxRounds === 1 ? "round" : "rounds"}</span>
    </div>
    <div class="actions">
      <button type="button" onclick={onedit}>Edit</button>
      <button type="button" class="danger" disabled={mutationBusy} onclick={ondelete}>Delete</button>
    </div>
  </div>

  <form class="ag-topic-form" onsubmit={onstart}>
    <div class="field">
      <label for="ag-topic">Discussion topic</label>
      <textarea
        id="ag-topic"
        rows="2"
        value={topic}
        disabled={!group.enabled || busy}
        placeholder={group.enabled ? "What should the group discuss?" : "This group is disabled"}
        oninput={(event) => ontopic(event.currentTarget.value)}
      ></textarea>
    </div>
    <div class="actions">
      <button type="submit" class="primary" disabled={!group.enabled || busy || !topic.trim()}>
        {busyAction === "run" ? "Starting..." : "Start run"}
      </button>
      {#if run?.state === "running"}
        <button type="button" class="danger" disabled={busy} onclick={() => onstop(run!.id)}>
          {busyAction === "stop" ? "Stopping..." : "Stop run"}
        </button>
      {/if}
    </div>
  </form>

  {#if run}
    <AgentGroupTranscript run={run} busy={busy} onstop={onstop} />
  {:else}
    <p class="ag-meta">No runs yet. Set a topic and start the first discussion.</p>
  {/if}
</div>

<style>
  .ag-room { padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); display: grid; gap: 0.75rem; min-width: 0; }
  .ag-room-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .ag-row { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; min-width: 0; }
  .ag-topic-form { display: grid; gap: 0.5rem; }
  .ag-topic-form textarea { width: 100%; min-width: 0; }
  .ag-meta { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.7rem; color: var(--muted); }
</style>
