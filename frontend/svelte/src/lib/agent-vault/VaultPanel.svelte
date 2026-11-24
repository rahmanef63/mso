<script lang="ts">
  import type { AgentVaultNote, AgentVaultSnapshot } from "./agent-vault-api.ts";
  import { frontmatter } from "./markdown.ts";

  let {
    note, content, snapshot, backlinks, onopen,
  }: {
    note: AgentVaultNote | null;
    content: string | null;
    snapshot: AgentVaultSnapshot | null;
    backlinks: AgentVaultNote[];
    onopen: (path: string) => void;
  } = $props();

  let meta = $derived(content ? frontmatter(content) : []);
  let stats = $derived.by(() => {
    if (!content) return { words: 0, lines: 0 };
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
    return {
      words: body.split(/\s+/).filter(Boolean).length,
      lines: body.split(/\r?\n/).length,
    };
  });

  function formatTime(iso: string | null): string {
    if (!iso) return "Never";
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString();
  }
</script>

<aside class="vault-panel" aria-label="Note details">
  {#if note}
    <section class="vault-block">
      <h3>{note.title}</h3>
      <p class="vault-meta">{note.kind} · {note.source || "generated"}</p>
      <p class="vault-meta vault-path">{note.path}</p>
      <p class="vault-meta">{stats.words} words · {stats.lines} lines</p>
    </section>

    <section class="vault-block">
      <h4>Frontmatter</h4>
      {#if meta.length === 0}
        <p class="vault-meta">This note has no YAML frontmatter.</p>
      {:else}
        <dl class="vault-dl">
          {#each meta as row (row.key)}
            <div><dt>{row.key}</dt><dd>{row.value || "(empty)"}</dd></div>
          {/each}
        </dl>
      {/if}
    </section>

    <section class="vault-block">
      <h4>Backlinks ({backlinks.length})</h4>
      {#if backlinks.length === 0}
        <p class="vault-meta">No other note in this snapshot links here.</p>
      {:else}
        <ul class="vault-backlinks">
          {#each backlinks as link (link.path)}
            <li><button type="button" onclick={() => onopen(link.path)}>{link.title}</button></li>
          {/each}
        </ul>
      {/if}
    </section>
   
    <section class="vault-block">
      <h4>Snapshot</h4>
      {#if snapshot}
        <dl class="vault-dl">
          <div><dt>Captured</dt><dd>{formatTime(snapshot.capturedAt)}</dd></div>
          <div><dt>Notes</dt><dd>{snapshot.notes.length}</dd></div>
          <div><dt>Partial</dt><dd>{snapshot.truncated ? "yes" : "no"}</dd></div>
        </dl>
        {#if snapshot.warnings.length > 0}
          <ul class="vault-warnings">
            {#each snapshot.warnings as warning, i (i)}<li>{warning}</li>{/each}
          </ul>
        {/if}
      {:else}
        <p class="vault-meta">No snapshot captured yet.</p>
      {/if}
    </section>
  {:else}
    <p class="vault-meta">Select a note to read its metadata, frontmatter, and backlinks.</p>
  {/if}
</aside>

<style>
  .vault-panel { display: grid; gap: 0.75rem; min-width: 0; align-content: start; }
  .vault-block { display: grid; gap: 0.3rem; padding: 0.625rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); min-width: 0; }
  .vault-block h3, .vault-block h4 { margin: 0; overflow-wrap: anywhere; }
  .vault-block h4 { font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .vault-meta { margin: 0; font-size: 0.75rem; color: var(--muted); overflow-wrap: anywhere; }
  .vault-path { font-family: var(--font-mono); font-size: 0.7rem; }
  .vault-dl { margin: 0; display: grid; gap: 0.3rem; }
  .vault-dl > div { padding: 0.25rem 0.375rem; border: 1px solid var(--border); border-radius: 0.25rem; background: var(--panel-solid); }
  .vault-dl dt { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .vault-dl dd { margin: 0; font-size: 0.75rem; color: var(--text); overflow-wrap: anywhere; }
  .vault-backlinks { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.25rem; }
  .vault-backlinks button { width: 100%; text-align: left; font-size: 0.75rem; min-height: 1.9rem; padding: 0.2rem 0.4rem; }
  .vault-warnings { margin: 0; padding-left: 1rem; font-size: 0.7rem; color: var(--warn); display: grid; gap: 0.15rem; }
</style>
