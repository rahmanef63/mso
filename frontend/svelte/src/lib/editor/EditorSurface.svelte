<script lang="ts">
  import { tick } from "svelte";
  import { lineColFromOffset, offsetForLine, type CursorPos } from "./editor-api.ts";
  import { tokenizeLines } from "./editor-highlight.ts";

  let {
    path,
    content,
    language,
    disabled = false,
    wordWrap = false,
    fontSize = 13,
    activeLine = 1,
    onChange,
    onCursorChange,
  }: {
    path: string;
    content: string;
    language: string;
    disabled?: boolean;
    wordWrap?: boolean;
    fontSize?: number;
    activeLine?: number;
    onChange: (next: string) => void;
    onCursorChange: (pos: CursorPos) => void;
  } = $props();

  let textareaEl = $state<HTMLTextAreaElement | undefined>(undefined);
  let gutterEl = $state<HTMLDivElement | undefined>(undefined);
  let preEl = $state<HTMLPreElement | undefined>(undefined);

  let tokenized = $derived(tokenizeLines(content, language));
  let lineCount = $derived(Math.max(1, tokenized.length));
  let useOverlay = $derived(!wordWrap && content.length <= 120_000);

  export function focusSelection(start: number, end: number): void {
    if (!textareaEl) return;
    textareaEl.focus();
    textareaEl.setSelectionRange(start, end);
    const pos = lineColFromOffset(content, start);
    onCursorChange(pos);
    const lineHeightPx = fontSize * 1.5;
    const targetTop = Math.max(0, (pos.ln - 4) * lineHeightPx);
    textareaEl.scrollTop = targetTop;
    syncScrollFromEl(textareaEl);
  }

  export function jumpToLine(line: number): void {
    const offset = offsetForLine(content, line);
    focusSelection(offset, offset);
  }

  function syncScrollFromEl(el: HTMLTextAreaElement): void {
    if (gutterEl) gutterEl.scrollTop = el.scrollTop;
    if (preEl) {
      preEl.scrollTop = el.scrollTop;
      preEl.scrollLeft = el.scrollLeft;
    }
  }

  function handleScroll(event: Event): void {
    syncScrollFromEl(event.currentTarget as HTMLTextAreaElement);
  }

  function reportCursor(el: HTMLTextAreaElement): void {
    onCursorChange(lineColFromOffset(el.value, el.selectionStart));
  }

  function handleInput(event: Event): void {
    const el = event.currentTarget as HTMLTextAreaElement;
    onChange(el.value);
    reportCursor(el);
  }

  async function handleKeydown(event: KeyboardEvent): Promise<void> {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const el = event.currentTarget as HTMLTextAreaElement;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (event.shiftKey) {
      const lineStart = content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const prefix = content.slice(lineStart, lineStart + 2);
      const remove = prefix === "  " ? 2 : prefix.startsWith(" ") || prefix.startsWith("\t") ? 1 : 0;
      if (remove === 0) return;
      const next = content.slice(0, lineStart) + content.slice(lineStart + remove);
      onChange(next);
      await tick();
      const nextStart = Math.max(lineStart, start - remove);
      const nextEnd = Math.max(lineStart, end - remove);
      el.setSelectionRange(nextStart, nextEnd);
      reportCursor(el);
      return;
    }
    const next = content.slice(0, start) + "  " + content.slice(end);
    onChange(next);
    await tick();
    el.setSelectionRange(start + 2, start + 2);
    reportCursor(el);
  }
</script>

<div class="surface-shell" style={`--ed-fs: ${fontSize}px`}>
  <div class="gutter" aria-hidden="true" bind:this={gutterEl}>
    {#each Array.from({ length: lineCount }, (_, i) => i + 1) as num (num)}
      <div class="gutter-num" class:is-active={num === activeLine}>{num}</div>
    {/each}
  </div>

  <div class="code-stage">
    {#if useOverlay}
      <pre class="highlight-layer" aria-hidden="true" bind:this={preEl}>{#each tokenized as lineTokens, idx (idx)}<span
            class="hl-line"
            class:is-active={idx + 1 === activeLine}
          >{#each lineTokens as tok, tIdx (tIdx)}<span class={`tok-${tok.kind}`}>{tok.text}</span>{/each}{"\n"}</span>{/each}</pre>
    {/if}

    <label class="sr-only" for="editor-textarea">Editor contents for {path}</label>
    <textarea
      id="editor-textarea"
      bind:this={textareaEl}
      class="code-input"
      class:overlay-mode={useOverlay}
      class:wrap-mode={wordWrap}
      value={content}
      {disabled}
      wrap={wordWrap ? "soft" : "off"}
      spellcheck={false}
      aria-label={`Code buffer for ${path}`}
      oninput={handleInput}
      onscroll={handleScroll}
      onclick={(e) => reportCursor(e.currentTarget as HTMLTextAreaElement)}
      onkeyup={(e) => reportCursor(e.currentTarget as HTMLTextAreaElement)}
      onselect={(e) => reportCursor(e.currentTarget as HTMLTextAreaElement)}
      onkeydown={handleKeydown}
    ></textarea>
  </div>
</div>

<style>
  .surface-shell {
    --tok-kw: #1d4ed8;
    --tok-str: #b45309;
    --tok-num: #0f766e;
    --tok-cmt: #52525b;
    --tok-fn: #6d28d9;
    --tok-tag: #0369a1;
    --tok-heading: #1d4ed8;
    display: grid; grid-template-columns: auto minmax(0, 1fr);
    flex: 1 1 auto; min-height: 16rem; min-width: 0;
    background: var(--panel-solid); overflow: hidden;
  }
  :global(:root[data-theme="dark"]) .surface-shell {
    --tok-kw: #60a5fa;
    --tok-str: #fbbf24;
    --tok-num: #5eead4;
    --tok-cmt: #9ca3af;
    --tok-fn: #c4b5fd;
    --tok-tag: #38bdf8;
    --tok-heading: #93c5fd;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .surface-shell {
      --tok-kw: #60a5fa;
      --tok-str: #fbbf24;
      --tok-num: #5eead4;
      --tok-cmt: #9ca3af;
      --tok-fn: #c4b5fd;
      --tok-tag: #38bdf8;
      --tok-heading: #93c5fd;
    }
  }
  .gutter {
    min-width: 3rem; padding: 0.65rem 0; background: var(--panel);
    border-right: 1px solid var(--border); overflow: hidden; user-select: none;
    font-family: var(--font-mono); font-size: var(--ed-fs, 13px); line-height: 1.5;
  }
  .gutter-num {
    padding: 0 0.55rem; text-align: right; color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .gutter-num.is-active {
    color: var(--text); font-weight: 700;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .code-stage { position: relative; min-width: 0; min-height: 0; overflow: hidden; }
  .highlight-layer, .code-input {
    margin: 0; padding: 0.65rem 0.75rem;
    font-family: var(--font-mono); font-size: var(--ed-fs, 13px); line-height: 1.5;
    tab-size: 2; letter-spacing: 0; border: 0;
  }
  .highlight-layer {
    position: absolute; inset: 0; overflow: hidden; pointer-events: none;
    white-space: pre; color: var(--text);
  }
  .hl-line { display: block; min-height: 1.5em; }
  .hl-line.is-active { background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .tok-kw { color: var(--tok-kw); font-weight: 600; }
  .tok-str { color: var(--tok-str); }
  .tok-num { color: var(--tok-num); }
  .tok-cmt { color: var(--tok-cmt); font-style: italic; }
  .tok-fn { color: var(--tok-fn); }
  .tok-tag { color: var(--tok-tag); }
  .tok-heading { color: var(--tok-heading); font-weight: 700; }
  .code-input {
    position: relative; width: 100%; height: 100%; min-height: 16rem; resize: none;
    background: transparent; color: var(--text); white-space: pre; overflow: auto;
    caret-color: var(--text);
  }
  .code-input.overlay-mode { color: transparent; }
  .code-input.overlay-mode::selection {
    background: color-mix(in srgb, var(--accent) 32%, transparent);
    color: transparent;
  }
  .code-input.wrap-mode { white-space: pre-wrap; overflow-wrap: anywhere; }
  .code-input:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
