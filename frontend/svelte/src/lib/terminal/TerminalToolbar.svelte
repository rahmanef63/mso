<script lang="ts">
  // Toolbar: scrollback search with match count, clear, copy, font size and the
  // quick snippet menu. Snippets only fill the input; nothing runs automatically.
  import { matchLabel } from "./term-search";
  import { SNIPPETS } from "./term-snippets";

  let {
    matchCount = 0,
    activeMatch = -1,
    canClear = false,
    canCopy = false,
    canType = false,
    fontSize = 13,
    onsearch,
    onstep,
    onclear,
    oncopy,
    onfontstep,
    onsnippet,
  }: {
    matchCount?: number;
    activeMatch?: number;
    canClear?: boolean;
    canCopy?: boolean;
    canType?: boolean;
    fontSize?: number;
    onsearch: (query: string) => void;
    onstep: (delta: -1 | 1) => void;
    onclear: () => void;
    oncopy: () => void;
    onfontstep: (delta: -1 | 1) => void;
    onsnippet: (command: string) => void;
  } = $props();

  let query = $state("");
  let menuOpen = $state(false);
  let menuWrap = $state<HTMLDivElement | undefined>(undefined);
  let triggerEl = $state<HTMLButtonElement | undefined>(undefined);

  function updateQuery(next: string) {
    query = next;
    onsearch(next);
  }

  function closeMenu(refocus: boolean) {
    menuOpen = false;
    if (refocus) triggerEl?.focus();
  }

  function pick(id: string) {
    const snippet = SNIPPETS.find((item) => item.id === id);
    closeMenu(true);
    if (snippet) onsnippet(snippet.command);
  }

  function onMenuKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeMenu(true);
  }

  // Outside click closes the menu without stealing focus back from the target.
  function onDocPointer(event: PointerEvent) {
    if (!menuOpen || !menuWrap) return;
    if (!menuWrap.contains(event.target as Node)) closeMenu(false);
  }

  $effect(() => {
    if (!menuOpen) return;
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
  });
</script>

<div class="toolbar" role="toolbar" aria-label="Terminal controls">
  <div class="search">
    <label class="sr-only" for="term-search">Search scrollback</label>
    <input
      id="term-search"
      type="search"
      placeholder="Search output"
      bind:value={query}
      oninput={(event) => updateQuery(event.currentTarget.value)}
      onkeydown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        onstep(event.shiftKey ? -1 : 1);
      }}
      autocomplete="off"
      spellcheck={false}
    />
    {#if query.trim()}
      <span class="count" role="status" aria-live="polite">{matchLabel(activeMatch, matchCount)}</span>
      <button type="button" class="icon" aria-label="Previous match" title="Previous match (Shift+Enter)"
        onclick={() => onstep(-1)}>Prev</button>
      <button type="button" class="icon" aria-label="Next match" title="Next match (Enter)"
        onclick={() => onstep(1)}>Next</button>
    {/if}
  </div>
  <div class="group">
    <button type="button" disabled={!canType} onclick={onclear}>Clear</button>
    <button type="button" disabled={!canCopy} onclick={oncopy}>Copy</button>
  </div>
  <div class="group" role="group" aria-label="Font size">
    <button type="button" aria-label="Decrease font size" title="Decrease font size"
      onclick={() => onfontstep(-1)}>A-</button>
    <span class="size" aria-live="polite">{fontSize}px</span>
    <button type="button" aria-label="Increase font size" title="Increase font size"
      onclick={() => onfontstep(1)}>A+</button>
  </div>
  <div class="snippets" bind:this={menuWrap}>
    <button
      type="button"
      bind:this={triggerEl}
      aria-expanded={menuOpen}
      aria-haspopup="true"
      onclick={() => (menuOpen = !menuOpen)}
      onkeydown={(event) => { if (event.key === "Escape" && menuOpen) closeMenu(true); }}
    >
      Snippets
    </button>
    {#if menuOpen}
      <ul class="menu" role="menu" aria-label="Quick snippets" onkeydown={onMenuKeydown}>
        {#each SNIPPETS as snippet (snippet.id)}
          <li role="none">
            <button type="button" role="menuitem" class="menu-item" onclick={() => pick(snippet.id)}>
              <span class="menu-label">{snippet.label}</span>
              <span class="menu-hint">{snippet.hint}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .toolbar {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
    min-width: 0; position: relative;
  }
  .search { display: flex; align-items: center; gap: 0.375rem; flex: 1 1 12rem; min-width: 0; }
  .search input { flex: 1 1 8rem; min-width: 0; }
  .count { font-size: 0.75rem; color: var(--muted); white-space: nowrap; }
  .group { display: flex; align-items: center; gap: 0.25rem; }
  .size { font-size: 0.75rem; color: var(--muted); min-width: 2.5rem; text-align: center; }
  .snippets { position: relative; }
  .menu {
    position: absolute; right: 0; top: calc(100% + 0.25rem); z-index: 20;
    min-width: 14rem; max-width: min(20rem, 90vw); margin: 0; padding: 0.25rem;
    list-style: none; background: var(--panel-solid); border: 1px solid var(--border);
    border-radius: 0.5rem; box-shadow: var(--shadow-pop);
  }
  .menu-item {
    display: grid; gap: 0.125rem; width: 100%; padding: 0.375rem 0.5rem; text-align: left;
    border: 0; border-radius: 0.375rem; background: transparent; color: var(--text); cursor: pointer;
  }
  .menu-item:hover, .menu-item:focus-visible { background: var(--surface); }
  .menu-label { font-size: 0.8125rem; font-weight: 600; }
  .menu-hint { font-size: 0.6875rem; color: var(--muted); }
  @media (max-width: 420px) {
    .search { flex: 1 1 100%; }
    .menu { left: 0; right: auto; }
  }
</style>
