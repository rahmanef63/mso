<script lang="ts">
  import "./CodeEditorApp.css";
  import { onMount } from "svelte";
  import { getWinState, setWinState } from "../shell/window-feature-state.ts";
  import { countStats, isMarkdownFile, parentDir } from "./editor-api.ts";
  import { findMatches, replaceAllMatches, replaceMatchAt } from "./editor-highlight.ts";
  import { createMultiTabEditor, type EditorWorkspaceSnapshot, type MultiTabState } from "./editor-tabs.ts";
  import EditorSurface from "./EditorSurface.svelte";
  import EditorTerminalDrawer from "./EditorTerminalDrawer.svelte";
  import EditorToolbar from "./EditorToolbar.svelte";
  import FileExplorerSidebar from "./FileExplorerSidebar.svelte";
  import FindReplaceBar from "./FindReplaceBar.svelte";
  import MarkdownPreview from "./MarkdownPreview.svelte";
  import StatusBar from "./StatusBar.svelte";
  import TabBar from "./TabBar.svelte";

  type LegacyDraft = { path: string; content: string; dirty: boolean };
  type StoredDraft = EditorWorkspaceSnapshot | LegacyDraft;

  let { winId, initialPath = "", onDirtyChange }: {
    winId?: string; initialPath?: string; onDirtyChange?: (dirty: boolean) => void;
  } = $props();

  let ws = $state<MultiTabState>({ tabs: [], activePath: null, anyDirty: false, globalError: null });
  let pathInput = $state("");
  let explorerOpen = $state(true);
  let wordWrap = $state(false);
  let fontSize = $state(13);
  let showPreview = $state(false);
  let terminalOpen = $state(false);
  let barMode = $state<"find" | "goto" | null>(null);
  let findQuery = $state("");
  let replaceText = $state("");
  let caseSensitive = $state(false);
  let matchIndex = $state(0);
  let pendingClosePath = $state<string | null>(null);
  let surfaceRef = $state<{ focusSelection: (s: number, e: number) => void; jumpToLine: (ln: number) => void } | undefined>(undefined);
  let editor: ReturnType<typeof createMultiTabEditor> | undefined;

  let activeTab = $derived(ws.activePath ? ws.tabs.find((t) => t.path === ws.activePath) ?? null : null);
  let editorStateKind = $derived(
    !activeTab ? (ws.globalError ? "error" : "idle") : activeTab.loading ? "loading" : activeTab.error ? "error" : "ready",
  );
  let stats = $derived(activeTab && !activeTab.loading && !activeTab.error ? countStats(activeTab.content) : { lines: 0, chars: 0, bytes: 0 });
  let isMarkdown = $derived(activeTab ? isMarkdownFile(activeTab.path, activeTab.language) : false);
  let terminalCwd = $derived(parentDir(activeTab?.path ?? pathInput.trim()) || "~");
  let matches = $derived(activeTab && findQuery ? findMatches(activeTab.content, findQuery, caseSensitive) : []);
  let clampedMatchIndex = $derived(matches.length > 0 ? ((matchIndex % matches.length) + matches.length) % matches.length : 0);

  $effect(() => {
    if (activeTab) pathInput = activeTab.path;
  });

  export function open(path: string) {
    pathInput = path;
    return editor?.openTab(path);
  }

  function handleCreateTab(path?: string): void {
    if (path) { editor?.createTab(path); return; }
    let idx = 1;
    let candidate = `~/untitled-${idx}.txt`;
    while (ws.tabs.some((t) => t.path === candidate)) { idx++; candidate = `~/untitled-${idx}.txt`; }
    editor?.createTab(candidate);
  }

  function handleRequestClose(path: string): void {
    const res = editor?.closeTab(path, false);
    if (res === "needs-confirm") pendingClosePath = path;
    else if (pendingClosePath === path) pendingClosePath = null;
  }

  async function handleSaveAndClose(path: string): Promise<void> {
    if (await editor?.saveTab(path)) { editor?.closeTab(path, true); pendingClosePath = null; }
  }

  function focusMatch(index: number): void {
    if (matches.length === 0) return;
    const safe = ((index % matches.length) + matches.length) % matches.length;
    matchIndex = safe;
    surfaceRef?.focusSelection(matches[safe].start, matches[safe].end);
  }

  function handleReplaceCurrent(): void {
    if (!activeTab || matches.length === 0) return;
    editor?.updateContent(replaceMatchAt(activeTab.content, matches[clampedMatchIndex], replaceText));
  }

  function handleReplaceAll(): void {
    if (!activeTab || !findQuery) return;
    const res = replaceAllMatches(activeTab.content, findQuery, replaceText, caseSensitive);
    if (res.count > 0) editor?.updateContent(res.next);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      if (activeTab?.dirty && !activeTab.saving) void editor?.saveTab();
    } else if (key === "f") { event.preventDefault(); barMode = "find"; }
    else if (key === "g") { event.preventDefault(); barMode = "goto"; }
  }

  onMount(() => {
    editor = createMultiTabEditor(
      (next) => { ws = next; if (editor) setWinState<EditorWorkspaceSnapshot>(winId, "editor.draft", editor.snapshot()); },
      { onDirtyChange: (dirty) => onDirtyChange?.(dirty) },
    );
    const saved = getWinState<StoredDraft | null>(winId, "editor.draft", null);
    if (saved && "tabs" in saved && Array.isArray(saved.tabs) && saved.tabs.length > 0) {
      editor.restoreSnapshot(saved);
    } else if (saved && "path" in saved && saved.path) {
      pathInput = saved.path;
      void editor.openTab(saved.path).then(() => { if (saved.dirty) editor?.updateContent(saved.content, saved.path); });
    } else if (initialPath.trim()) {
      pathInput = initialPath.trim();
      void editor.openTab(initialPath.trim());
    }
    return () => { editor?.dispose(); };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="ide-root" aria-labelledby="editor-title" aria-busy={editorStateKind === "loading" || Boolean(activeTab?.saving)} data-editor-state={editorStateKind} data-editor-dirty={String(ws.anyDirty)} onkeydown={handleKeydown}
>
  <EditorToolbar
    {pathInput} loading={editorStateKind === "loading"}
    {explorerOpen}
    {wordWrap}
    {barMode}
    {isMarkdown}
    {showPreview}
    {terminalOpen}
    onPathInput={(v) => { pathInput = v; }} onOpenSubmit={() => void editor?.openTab(pathInput)} onToggleExplorer={() => { explorerOpen = !explorerOpen; }} onToggleWrap={() => { wordWrap = !wordWrap; }} onDecreaseFont={() => { fontSize = Math.max(11, fontSize - 1); }} onIncreaseFont={() => { fontSize = Math.min(20, fontSize + 1); }}
    onToggleFind={() => { barMode = barMode === "find" ? null : "find"; }} onToggleGoto={() => { barMode = barMode === "goto" ? null : "goto"; }} onTogglePreview={() => { showPreview = !showPreview; }}
    onToggleTerminal={() => { terminalOpen = !terminalOpen; }}
  />

  <div class="ide-body" class:with-sidebar={explorerOpen}>
    {#if explorerOpen}
      <FileExplorerSidebar activePath={ws.activePath} onOpenFile={(p) => void editor?.openTab(p)} onCreateFile={(p) => handleCreateTab(p)} onClose={() => { explorerOpen = false; }}
      />
    {/if}

    <div class="ide-main">
      <TabBar tabs={ws.tabs} activePath={ws.activePath}
        {pendingClosePath} onSelect={(p) => { editor?.selectTab(p); pendingClosePath = null; }} onRequestClose={handleRequestClose} onSaveAndClose={(p) => void handleSaveAndClose(p)} onDiscardClose={(p) => { editor?.closeTab(p, true); pendingClosePath = null; }} onCancelClose={() => { pendingClosePath = null; }} onNewFile={() => handleCreateTab()}
      />

      {#if barMode && activeTab && editorStateKind === "ready"}
        <FindReplaceBar mode={barMode} query={findQuery} replacement={replaceText} {caseSensitive} matchCount={matches.length} activeIndex={clampedMatchIndex} lineCount={stats.lines} onQueryChange={(q) => { findQuery = q; matchIndex = 0; }} onReplacementChange={(r) => { replaceText = r; }} onToggleCase={() => { caseSensitive = !caseSensitive; matchIndex = 0; }}
          onPrev={() => focusMatch(clampedMatchIndex - 1)} onNext={() => focusMatch(clampedMatchIndex + 1)} onReplace={handleReplaceCurrent} onReplaceAll={handleReplaceAll} onJumpToLine={(ln) => surfaceRef?.jumpToLine(ln)} onClose={() => { barMode = null; }}
        />
      {/if}

      {#if ws.globalError}<p class="inline-feedback error" role="alert">{ws.globalError}</p>{/if}
      {#if activeTab?.notice}<p class="inline-feedback ok" role="status">{activeTab.notice}</p>{/if}
      {#if activeTab?.actionError}<p class="inline-feedback error" role="alert">{activeTab.actionError}</p>{/if}

      <div class="workspace-split" class:split-active={showPreview && isMarkdown && editorStateKind === "ready"}>
        {#if !activeTab}
          <div class="empty-state">
            <p>Select a file from the Explorer, open a path above, or create a new buffer.</p>
            <button type="button" class="primary empty-btn" onclick={() => handleCreateTab()}>New file</button>
          </div>
        {:else if activeTab.loading}
          <div class="empty-state" role="status"><p>Opening <code>{activeTab.path}</code>...</p></div>
        {:else if activeTab.error}
          <div class="empty-state">
            <p class="error-text" role="alert">{activeTab.error}</p>
            <button type="button" class="empty-btn" onclick={() => void editor?.openTab(activeTab.path)}>Retry</button>
          </div>
        {:else}
          <EditorSurface bind:this={surfaceRef} path={activeTab.path} content={activeTab.content} language={activeTab.language} disabled={activeTab.saving} {wordWrap} {fontSize} activeLine={activeTab.cursor.ln} onChange={(next) => editor?.updateContent(next)} onCursorChange={(pos) => editor?.setCursor(pos)}
          />
          {#if showPreview && isMarkdown}
            <div class="preview-slot"><MarkdownPreview path={activeTab.path} content={activeTab.content} /></div>
          {/if}
        {/if}
      </div>

      {#if terminalOpen}
        <EditorTerminalDrawer cwd={terminalCwd} onClose={() => { terminalOpen = false; }} />
      {/if}

      <StatusBar path={activeTab?.path ?? null} language={activeTab?.language ?? "Plain Text"} cursor={activeTab?.cursor ?? { ln: 1, col: 1 }} {stats} dirty={Boolean(activeTab?.dirty)} saving={Boolean(activeTab?.saving)} onLanguageChange={(lang) => editor?.setLanguage(lang)} onOpenGoto={() => { barMode = "goto"; }} onSave={() => void editor?.saveTab()} onRevert={() => editor?.revertTab()}
      />
    </div>
  </div>
</section>
