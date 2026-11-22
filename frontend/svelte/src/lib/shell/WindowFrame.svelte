<script lang="ts">
  import type { Snippet } from "svelte";
  import type { WindowState } from "./window-store";

  let {
    win, focused, onFocus, onMinimize, onMaximize, onClose, children,
  }: {
    win: WindowState;
    focused: boolean;
    onFocus: (id: string) => void;
    onMinimize: (id: string) => void;
    onMaximize: (id: string) => void;
    onClose: (id: string) => void;
    children: Snippet;
  } = $props();

  function stopFocus(event: PointerEvent) {
    event.stopPropagation();
  }
</script>

<article
  class="win-frame"
  class:focused
  class:maximized={win.maximized}
  hidden={win.minimized}
  data-win-id={win.id}
  data-win-app={win.app}
  data-focused={focused}
  data-maximized={win.maximized}
  aria-label={win.title}
  onpointerdown={() => onFocus(win.id)}
>
  <header class="win-bar">
    <h2 class="win-title">{win.title}</h2>
    <div class="win-controls">
      <button type="button" class="win-btn" aria-label={`Minimize ${win.title}`} onpointerdown={stopFocus} onclick={() => onMinimize(win.id)}>
        _
      </button>
      <button
        type="button"
        class="win-btn"
        aria-label={win.maximized ? `Restore ${win.title}` : `Maximize ${win.title}`}
        aria-pressed={win.maximized}
        onpointerdown={stopFocus}
        onclick={() => onMaximize(win.id)}
      >
        {win.maximized ? "[]" : "+"}
      </button>
      <button type="button" class="win-btn win-close" aria-label={`Close ${win.title}`} onpointerdown={stopFocus} onclick={() => onClose(win.id)}>
        x
      </button>
    </div>
  </header>

  <div class="win-body">
    <svelte:boundary>
      {@render children()}
      {#snippet failed(_error, reset)}
        <div class="win-crash" role="alert">
          <p><strong>{win.title} stopped unexpectedly.</strong></p>
          <p>Other open windows remain available. Retry this window or close it.</p>
          <div class="actions">
            <button type="button" class="primary" onclick={reset}>Retry</button>
            <button type="button" onclick={() => onClose(win.id)}>Close window</button>
          </div>
        </div>
      {/snippet}
    </svelte:boundary>
  </div>
</article>

<style>
  .win-frame {
    display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0;
    background: var(--panel); border: 1px solid var(--border); border-radius: .625rem; overflow: hidden;
  }
  .win-frame.focused { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .win-frame.maximized { width: 100%; min-height: 60vh; }
  .win-bar {
    display: flex; align-items: center; justify-content: space-between; gap: .5rem;
    padding: .5rem .75rem; background: var(--surface); border-bottom: 1px solid var(--border); min-width: 0;
  }
  .win-frame.focused .win-bar { border-bottom-color: var(--accent); }
  .win-title { margin: 0; font-size: 1rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .win-controls { display: flex; align-items: center; gap: .375rem; flex-shrink: 0; }
  .win-btn { min-width: 2.25rem; min-height: 2.25rem; padding: .25rem .5rem; font-size: .875rem; line-height: 1; }
  .win-close:hover { border-color: var(--danger); color: var(--danger); }
  .win-body { padding: var(--feature-padding, 1rem); min-width: 0; overflow: auto; }
  .win-crash {
    display: grid; gap: .75rem; padding: 1rem; border: 1px solid var(--danger);
    border-radius: .5rem; background: var(--danger-bg); color: var(--danger);
  }
  .win-crash p { margin: 0; color: inherit; }
</style>
