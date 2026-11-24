<script lang="ts">
  import type { AgentGroupRunState, AgentGroupView } from "./agent-group-api.ts";

  let { groups, selectedGroupId, onselect }: {
    groups: AgentGroupView[];
    selectedGroupId: string | null;
    onselect: (id: string) => void;
  } = $props();

  function runTone(state: AgentGroupRunState): "ok" | "warn" | "danger" | "neutral" {
    if (state === "completed") return "ok";
    if (state === "running") return "warn";
    return state === "failed" ? "danger" : "neutral";
  }

  function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
</script>

<aside class="ag-sidebar" aria-label="Agent groups">
  <ul class="ag-groups">
    {#each groups as group (group.id)}
      {@const latest = group.runs[0]}
      <li>
        <button
          type="button"
          class="ag-group-btn"
          class:selected={selectedGroupId === group.id}
          aria-pressed={selectedGroupId === group.id}
          onclick={() => onselect(group.id)}
        >
          <span class="ag-row">
            <strong class="ag-group-name">{group.name}</strong>
            <span class="pill" data-tone={group.enabled ? "ok" : "neutral"}>{group.enabled ? "enabled" : "disabled"}</span>
            {#if latest}<span class="pill" data-tone={runTone(latest.state)}>{latest.state}</span>{/if}
          </span>
          <span class="ag-members-row">
            {#each group.members as member (member.id)}
              <span class="ag-member-chip" title={`${member.name} (${member.profile})`}>
                <span class="ag-mini-avatar" aria-hidden="true">{initials(member.name)}</span>
                <span class="ag-member-label">{member.name}</span>
                <span class="ag-member-profile">{member.profile}</span>
              </span>
            {/each}
          </span>
        </button>
      </li>
    {/each}
  </ul>
</aside>

<style>
  .ag-sidebar { min-width: 0; }
  .ag-groups { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.5rem; max-height: 30rem; overflow-y: auto; }
  .ag-group-btn { width: 100%; display: grid; gap: 0.375rem; text-align: left; }
  .ag-group-btn.selected { border-color: var(--accent); background: var(--surface); }
  .ag-row { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; min-width: 0; }
  .ag-group-name { overflow-wrap: anywhere; }
  .ag-members-row { display: flex; flex-wrap: wrap; gap: 0.25rem; }
  .ag-member-chip { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.125rem 0.375rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.7rem; color: var(--muted); max-width: 100%; }
  .ag-member-label { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ag-member-profile { opacity: 0.8; }
  .ag-mini-avatar { width: 1.05rem; height: 1.05rem; border-radius: 999px; display: grid; place-items: center; font-size: 0.55rem; font-weight: 700; background: color-mix(in srgb, var(--accent) 24%, var(--panel-solid)); color: var(--text); }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.7rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .pill[data-tone="danger"] { color: var(--danger); background: var(--danger-bg); border-color: var(--danger); }
</style>
