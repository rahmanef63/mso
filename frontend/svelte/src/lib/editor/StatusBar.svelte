<script lang="ts">
  import { LANGUAGE_OPTIONS, type CursorPos, type EditorStats } from "./editor-api.ts";

  let {
    path,
    language,
    cursor,
    stats,
    dirty,
    saving,
    onLanguageChange,
    onOpenGoto,
    onSave,
    onRevert,
  }: {
    path: string | null;
    language: string;
    cursor: CursorPos;
    stats: EditorStats;
    dirty: boolean;
    saving: boolean;
    onLanguageChange: (language: string) => void;
    onOpenGoto: () => void;
    onSave: () => void;
    onRevert: () => void;
  } = $props();
</script>

<footer class="status-bar" aria-label="Editor status">
  <span class="status-path" title={path ?? "No file open"}>{path ?? "No file open"}</span>

  {#if path}
    <div class="status-right">
      <button
        type="button"
        class="status-link"
        title="Go to line (Ctrl+G or Cmd+G)"
        onclick={onOpenGoto}
      >Ln {cursor.ln}, Col {cursor.col}</button>

      <span class="status-item">{stats.lines} lines, {stats.chars} chars</span>
      <span class="status-item">UTF-8</span>

      <label class="sr-only" for="editor-lang-select">Syntax language</label>
      <select
        id="editor-lang-select"
        class="lang-select"
        value={language}
        onchange={(e) => onLanguageChange((e.currentTarget as HTMLSelectElement).value)}
      >
        {#each LANGUAGE_OPTIONS as opt (opt)}
          <option value={opt}>{opt}</option>
        {/each}
      </select>

      <button
        type="button"
        class="status-btn primary"
        disabled={!dirty || saving}
        title="Save (Ctrl+S or Cmd+S)"
        onclick={onSave}
      >{saving ? "Saving..." : "Save"}</button>

      <button
        type="button"
        class="status-btn"
        disabled={!dirty || saving}
        onclick={onRevert}
      >Revert</button>
    </div>
  {/if}
</footer>

<style>
  .status-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    flex-wrap: wrap; padding: 0.3rem 0.6rem; border-top: 1px solid var(--border);
    background: var(--panel); font-family: var(--font-mono); font-size: 0.73rem; color: var(--muted);
  }
  .status-path {
    min-width: 0; flex: 1 1 8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .status-right {
    display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;
  }
  .status-item { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .status-link {
    min-height: 1.55rem; padding: 0.1rem 0.35rem; border: 0; background: transparent;
    color: var(--text); font-family: var(--font-mono); font-size: 0.73rem;
    font-variant-numeric: tabular-nums; border-radius: 0.25rem;
  }
  .status-link:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
  .lang-select {
    min-height: 1.65rem; padding: 0.1rem 0.35rem; font-size: 0.73rem;
    font-family: var(--font-mono); border-radius: 0.3rem;
  }
  .status-btn {
    min-height: 1.65rem; padding: 0.1rem 0.45rem; font-size: 0.72rem; border-radius: 0.3rem;
  }
</style>
