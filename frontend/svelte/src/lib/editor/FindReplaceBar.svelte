<script lang="ts">
  let {
    mode,
    query,
    replacement,
    caseSensitive,
    matchCount,
    activeIndex,
    lineCount,
    onQueryChange,
    onReplacementChange,
    onToggleCase,
    onPrev,
    onNext,
    onReplace,
    onReplaceAll,
    onJumpToLine,
    onClose,
  }: {
    mode: "find" | "goto";
    query: string;
    replacement: string;
    caseSensitive: boolean;
    matchCount: number;
    activeIndex: number;
    lineCount: number;
    onQueryChange: (next: string) => void;
    onReplacementChange: (next: string) => void;
    onToggleCase: () => void;
    onPrev: () => void;
    onNext: () => void;
    onReplace: () => void;
    onReplaceAll: () => void;
    onJumpToLine: (line: number) => void;
    onClose: () => void;
  } = $props();

  let gotoInput = $state("1");

  function handleGotoSubmit(event: SubmitEvent): void {
    event.preventDefault();
    const parsed = Number.parseInt(gotoInput, 10);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(1, Math.min(parsed, Math.max(1, lineCount)));
    onJumpToLine(clamped);
    onClose();
  }

  function handleBarKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="find-bar" role="region" aria-label={mode === "find" ? "Find and replace" : "Go to line"} onkeydown={handleBarKeydown}>
  {#if mode === "find"}
    <div class="find-row">
      <label class="sr-only" for="editor-find-input">Find text</label>
      <input
        id="editor-find-input"
        type="text"
        value={query}
        placeholder="Find..."
        autocomplete="off"
        spellcheck={false}
        oninput={(e) => onQueryChange((e.currentTarget as HTMLInputElement).value)}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrev(); else onNext();
          }
        }}
      />
      <button
        type="button"
        class="tool-btn"
        class:active={caseSensitive}
        aria-pressed={caseSensitive}
        title="Match case"
        onclick={onToggleCase}
      >Aa</button>
      <span class="match-count" role="status" aria-live="polite">
        {#if !query}0 matches{:else if matchCount === 0}No matches{:else}{activeIndex + 1} of {matchCount}{/if}
      </span>
      <button type="button" class="tool-btn" disabled={matchCount === 0} onclick={onPrev} title="Previous match">Prev</button>
      <button type="button" class="tool-btn" disabled={matchCount === 0} onclick={onNext} title="Next match">Next</button>
      <button type="button" class="tool-btn close-btn" onclick={onClose} aria-label="Close find bar">x</button>
    </div>
    <div class="find-row">
      <label class="sr-only" for="editor-replace-input">Replace with</label>
      <input
        id="editor-replace-input"
        type="text"
        value={replacement}
        placeholder="Replace with..."
        autocomplete="off"
        spellcheck={false}
        oninput={(e) => onReplacementChange((e.currentTarget as HTMLInputElement).value)}
        onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); onReplace(); } }}
      />
      <button type="button" class="tool-btn" disabled={matchCount === 0} onclick={onReplace}>Replace</button>
      <button type="button" class="tool-btn" disabled={matchCount === 0} onclick={onReplaceAll}>Replace All</button>
    </div>
  {:else}
    <form class="find-row" onsubmit={handleGotoSubmit}>
      <label class="goto-label" for="editor-goto-input">Go to line (1-{Math.max(1, lineCount)})</label>
      <input
        id="editor-goto-input"
        type="number"
        min="1"
        max={Math.max(1, lineCount)}
        bind:value={gotoInput}
        class="goto-input"
      />
      <button type="submit" class="primary tool-btn">Jump</button>
      <button type="button" class="tool-btn close-btn" onclick={onClose} aria-label="Close go to line">x</button>
    </form>
  {/if}
</div>

<style>
  .find-bar {
    display: flex; flex-direction: column; gap: 0.35rem;
    padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  .find-row { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
  .find-row input {
    flex: 1 1 9rem; min-width: 0; min-height: 1.9rem; padding: 0.2rem 0.45rem;
    font-size: 0.8rem; font-family: var(--font-mono);
  }
  .goto-label { font-size: 0.8rem; color: var(--muted); }
  .goto-input { flex: 0 1 6rem !important; }
  .tool-btn {
    min-height: 1.9rem; padding: 0.2rem 0.5rem; font-size: 0.76rem; border-radius: 0.375rem;
  }
  .tool-btn.active {
    background: var(--accent); color: var(--accent-text); border-color: var(--accent);
  }
  .match-count { font-size: 0.75rem; color: var(--muted); font-variant-numeric: tabular-nums; padding-inline: 0.2rem; }
  .close-btn { margin-left: auto; font-family: var(--font-mono); }
</style>
