<script lang="ts">
  // Bottom drawer that reuses the terminal slice's PTY pane. The pane owns its
  // controller, so closing the drawer tears the shell down with it.
  import { baseName } from "./editor-api.ts";
  import TerminalPane from "../terminal/TerminalPane.svelte";
  import type { TabStatus } from "../terminal/term-tabs.ts";

  let {
    cwd,
    onClose,
  }: {
    cwd: string;
    onClose: () => void;
  } = $props();

  let status = $state<TabStatus>("disconnected");
</script>

<section class="editor-terminal" aria-label="Integrated terminal" data-terminal-state={status}>
  <header class="term-head">
    <span class="term-title">Terminal</span>
    <code class="term-cwd" title={cwd}>{baseName(cwd) || cwd}</code>
    <span class="term-status" role="status" aria-live="polite">{status}</span>
    <button type="button" class="term-close" onclick={onClose}>Close terminal</button>
  </header>
  <div class="term-body">
    <TerminalPane tabId={1} initialCwd={cwd} active={true} onstatus={(_id, next) => (status = next)} />
  </div>
</section>

<style>
  /* The height budget is the window body, not the viewport. A hard min-height here is what
     pushed a short window past its own frame (1280x620: drawer bottom 610 vs body 485).
     The floor is the space the pane really needs once its redundant bands are gone,
     clamped so it can never exceed the body it lives in. */
  .editor-terminal {
    display: flex; flex-direction: column; min-width: 0;
    flex: 0 1 auto; height: min(22rem, 55%); min-height: min(12.5rem, 100%); max-height: 60%;
    overflow: hidden; border-top: 1px solid var(--border); background: var(--panel-solid);
  }
  .term-head {
    display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
    padding: 0.3rem 0.55rem; border-bottom: 1px solid var(--border); font-size: 0.76rem;
  }
  .term-title { font-weight: 600; }
  .term-cwd {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 14rem;
    color: var(--muted); font-size: 0.72rem;
  }
  .term-status { color: var(--muted); }
  .term-close { margin-left: auto; min-height: 1.75rem; padding: 0.15rem 0.5rem; font-size: 0.74rem; }
  /* Scroll as the last resort: a short window must never push the prompt or the
     Close button outside the drawer, and the pane must never be silently cropped. */
  .term-body { flex: 1 1 auto; min-height: 0; min-width: 0; padding: 0.4rem 0.55rem; overflow: auto; }
  /* The pane is built for a full window and repeats chrome the drawer already has:
     its own status pill + Disconnect sit in the drawer head, and the on-screen keybar
     is a full-window affordance. Dropping both leaves the search toolbar, the output
     stage and the prompt inside the drawer's real height budget. */
  .term-body :global(.pane-head) { display: none; }
  .term-body :global(.keybar) { display: none; }
  .term-body :global(.pane) { gap: 0.3rem; height: 100%; }
  .term-body :global(.toolbar) { flex-wrap: nowrap; }
  .term-body :global(.search) { flex: 1 1 4rem; }
  .term-body :global(.stage) { min-height: 2.5rem; }
  .term-body :global(.term-output) { min-height: 2.25rem; }
  @media (max-width: 40rem) {
    .editor-terminal { height: min(16rem, 55%); }
    .term-cwd { max-width: 8rem; }
  }
</style>
