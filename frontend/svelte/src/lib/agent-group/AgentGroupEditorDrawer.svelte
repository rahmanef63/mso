<script lang="ts">
  import { untrack } from "svelte";
  import type { AgentGroupView } from "./agent-group-api.ts";
  import { draftFrom, emptyDraft, validateDraft, type AgentGroupDraft } from "./agent-group-mutations.ts";

  let { group, busy, error, onsubmit, onclose }: {
    group: AgentGroupView | null;
    busy: boolean;
    error: string;
    onsubmit: (draft: AgentGroupDraft) => void;
    onclose: () => void;
  } = $props();

  let draft = $state<AgentGroupDraft>(untrack(() => (group ? draftFrom(group) : emptyDraft())));
  let localError = $state("");

  let title = $derived(group ? `Edit group: ${group.name}` : "New agent group");

  function addMember() {
    draft = { ...draft, members: [...draft.members, { name: "", profile: "" }] };
  }

  function removeMember(index: number) {
    draft = { ...draft, members: draft.members.filter((_member, i) => i !== index) };
  }

  function patchMember(index: number, patch: { name?: string; profile?: string }) {
    draft = {
      ...draft,
      members: draft.members.map((member, i) => (i === index ? { ...member, ...patch } : member)),
    };
  }

  function submit(event: Event) {
    event.preventDefault();
    if (busy) return;
    const problem = validateDraft(draft);
    if (problem) { localError = problem; return; }
    localError = "";
    onsubmit(draft);
  }
</script>

<div class="ag-editor" role="dialog" aria-modal="true" aria-labelledby="ag-editor-title">
  <form class="ag-editor-body" onsubmit={submit}>
    <header class="ag-editor-head">
      <h3 id="ag-editor-title">{title}</h3>
      <button type="button" onclick={onclose} aria-label="Close group editor">Close</button>
    </header>

    {#if localError}<p class="feedback error" role="alert">{localError}</p>{/if}
    {#if error}<p class="feedback error" role="alert">{error}</p>{/if}

    <div class="ag-editor-fields">
      <div class="field">
        <label for="ag-name">Group name</label>
        <input id="ag-name" bind:value={draft.name} maxlength="120" required />
      </div>
      <div class="field">
        <label for="ag-rounds">Max rounds</label>
        <input id="ag-rounds" type="number" min="1" max="20" bind:value={draft.maxRounds} required />
      </div>
      <label class="ag-check">
        <input type="checkbox" bind:checked={draft.enabled} />
        Group is enabled
      </label>
    </div>

    <fieldset class="ag-members">
      <legend>Members ({draft.members.length})</legend>
      {#each draft.members as member, index (index)}
        <div class="ag-member-row">
          <div class="field">
            <label for={`ag-member-name-${index}`}>Name</label>
            <input
              id={`ag-member-name-${index}`}
              value={member.name}
              oninput={(event) => patchMember(index, { name: event.currentTarget.value })}
              placeholder="Architect"
            />
          </div>
          <div class="field">
            <label for={`ag-member-profile-${index}`}>Hermes profile</label>
            <input
              id={`ag-member-profile-${index}`}
              value={member.profile}
              oninput={(event) => patchMember(index, { profile: event.currentTarget.value })}
              placeholder="architect"
            />
          </div>
          <button type="button" class="danger" disabled={draft.members.length <= 1} onclick={() => removeMember(index)}>Remove</button>
        </div>
      {/each}
      <button type="button" onclick={addMember}>Add agent</button>
    </fieldset>

    <p class="ag-hint">Each member runs as its own Hermes profile. Telegram mirroring is configured from Channels.</p>

    <footer class="ag-editor-foot">
      <button type="submit" class="primary" disabled={busy}>{busy ? "Saving..." : "Save group"}</button>
      <button type="button" onclick={onclose} disabled={busy}>Cancel</button>
    </footer>
  </form>
</div>

<style>
  .ag-editor { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; background: color-mix(in srgb, var(--text) 35%, transparent); padding: 0.75rem; }
  .ag-editor-body { width: min(100%, 36rem); max-height: min(88vh, 44rem); overflow-y: auto; display: grid; gap: 0.75rem; padding: 1rem; border: 1px solid var(--border); border-radius: 0.75rem; background: var(--panel-solid); }
  .ag-editor-head, .ag-editor-foot { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .ag-editor-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr)); gap: 0.625rem; align-items: end; }
  .ag-editor-fields .field input { width: 100%; min-width: 0; }
  .ag-check { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.875rem; color: var(--muted); min-height: var(--ui-control-height); }
  .ag-check input { width: 1rem; height: 1rem; min-height: 0; padding: 0; }
  .ag-members { display: grid; gap: 0.5rem; border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.625rem; min-width: 0; }
  .ag-members legend { font-size: 0.8125rem; font-weight: 600; color: var(--text); padding: 0 0.25rem; }
  .ag-member-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 0.5rem; align-items: end; }
  .ag-member-row .field input { width: 100%; min-width: 0; }
  .ag-hint { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  @media (max-width: 30rem) {
    .ag-member-row { grid-template-columns: 1fr; }
  }
</style>
