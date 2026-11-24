<script lang="ts">
  import type { AssistantModel } from "./assistant-api";

  let {
    draft = $bindable(""),
    models,
    modelsLoading,
    selectedModel,
    streaming,
    activeModeLabel,
    onSelectModel,
    onClearMode,
    onSubmit,
    onStop,
  }: {
    draft: string;
    models: AssistantModel[];
    modelsLoading: boolean;
    selectedModel: string;
    streaming: boolean;
    activeModeLabel: string | null;
    onSelectModel: (model: string) => void;
    onClearMode: () => void;
    onSubmit: () => void;
    onStop: () => void;
  } = $props();

  let textareaEl = $state<HTMLTextAreaElement | undefined>(undefined);
  let canSend = $derived(draft.trim().length > 0 && !streaming);

  $effect(() => {
    void draft;
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    const nextHeight = Math.min(180, Math.max(44, textareaEl.scrollHeight));
    textareaEl.style.height = `${nextHeight}px`;
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSubmit();
    }
  }
</script>

<form class="composer-shell" onsubmit={(event) => { event.preventDefault(); if (canSend) onSubmit(); }}>
  <div class="composer-bar">
    <label class="model-picker" for="assistant-model">
      <span class="sr-only">Model</span>
      <select
        id="assistant-model"
        value={selectedModel}
        disabled={modelsLoading || streaming || models.length === 0}
        onchange={(event) => onSelectModel(event.currentTarget.value)}
      >
        {#if modelsLoading}
          <option value="">Loading models...</option>
        {:else if models.length === 0}
          <option value="">Default host model</option>
        {:else}
          {#each models as model (model.ref)}
            <option value={model.ref}>{model.name}</option>
          {/each}
        {/if}
      </select>
    </label>

    {#if activeModeLabel}
      <div class="mode-pill">
        <span>{activeModeLabel}</span>
        <button type="button" class="mode-clear" onclick={onClearMode} aria-label="Clear active mode">x</button>
      </div>
    {/if}
  </div>

  <div class="composer-row">
    <label for="assistant-prompt" class="sr-only">Message Alfa Assistant</label>
    <textarea
      bind:this={textareaEl}
      id="assistant-prompt"
      class="composer-input"
      rows="1"
      bind:value={draft}
      onkeydown={handleKeydown}
      placeholder="Ask Alfa anything (Enter to send, Shift+Enter for newline)"
      disabled={streaming}
    ></textarea>
    <div class="composer-actions">
      {#if streaming}
        <button type="button" class="danger" onclick={onStop}>Stop</button>
      {:else}
        <button type="submit" class="primary" disabled={!canSend}>Send</button>
      {/if}
    </div>
  </div>
</form>

<style>
  .composer-shell {
    display: grid;
    gap: 0.45rem;
    padding: 0.55rem;
    border: 1px solid var(--border);
    border-radius: 0.625rem;
    background: var(--surface);
    min-width: 0;
    max-width: 100%;
  }
  .composer-bar {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    min-width: 0;
  }
  .model-picker {
    display: inline-flex;
    min-width: 0;
    max-width: 100%;
    flex: 1 1 11rem;
  }
  .model-picker select {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    min-height: 2.1rem;
    font-size: 0.82rem;
    text-overflow: ellipsis;
  }
  .mode-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.18rem 0.5rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 12%, var(--panel-solid));
    color: var(--text);
    font-size: 0.75rem;
    font-weight: 600;
    max-width: 100%;
  }
  .mode-clear {
    min-height: 1.4rem;
    padding: 0 0.35rem;
    font-size: 0.72rem;
    border-radius: 999px;
  }
  .composer-row {
    display: flex;
    align-items: flex-end;
    gap: 0.45rem;
    flex-wrap: wrap;
    min-width: 0;
    width: 100%;
  }
  .composer-input {
    flex: 1 1 12rem;
    min-width: 0;
    max-width: 100%;
    min-height: var(--ui-control-height);
    max-height: 11.25rem;
    padding: 0.5rem 0.7rem;
    resize: none;
    overflow-y: auto;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    font: inherit;
    line-height: 1.45;
  }
  .composer-actions {
    display: flex;
    gap: 0.4rem;
    flex: 0 0 auto;
  }
</style>
