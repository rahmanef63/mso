<script lang="ts">
  import { onMount } from "svelte";
  import { createAssistantController, initialAssistantState, type AssistantState } from "./assistant-controller";

  let { autoLoadModels = true }: { autoLoadModels?: boolean } = $props();

  let view = $state<AssistantState>(initialAssistantState());
  let draft = $state("");
  let logEl = $state<HTMLDivElement | undefined>(undefined);
  let controller: ReturnType<typeof createAssistantController> | undefined;

  let hasUserMessages = $derived(view.messages.some((m) => m.role === "user"));
  let canSend = $derived(draft.trim().length > 0 && !view.streaming);

  $effect(() => {
    void view.messages;
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  });

  onMount(() => {
    controller = createAssistantController((next) => { view = next; });
    if (autoLoadModels) void controller.loadModels();
    return () => controller?.dispose();
  });

  function submitDraft() {
    if (!canSend) return;
    const text = draft.trim();
    draft = "";
    void controller?.sendMessage(text);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitDraft();
    }
  }
</script>

<section
  class="assistant-shell"
  aria-labelledby="assistant-title"
  aria-busy={view.streaming || view.modelsLoading}
  data-assistant-streaming={view.streaming ? "true" : "false"}
>
  <header class="feature-header assistant-header">
    <h2 id="assistant-title">Alfa Assistant</h2>
    <div class="assistant-controls">
      <label class="model-picker" for="assistant-model">
        <span class="sr-only">Model</span>
        <select
          id="assistant-model"
          value={view.selectedModel}
          disabled={view.modelsLoading || view.streaming || view.models.length === 0}
          onchange={(event) => controller?.selectModel(event.currentTarget.value)}
        >
          {#if view.modelsLoading}
            <option value="">Loading models...</option>
          {:else if view.models.length === 0}
            <option value="">Default host model</option>
          {:else}
            {#each view.models as model (model.ref)}
              <option value={model.ref}>{model.name}</option>
            {/each}
          {/if}
        </select>
      </label>
      <button type="button" onclick={() => controller?.newChat()}>New chat</button>
    </div>
  </header>

  {#if view.error}
    <div class="feedback error assistant-banner" role="alert">
      <p>{view.error}</p>
      <button
        type="button"
        disabled={view.streaming || view.modelsLoading}
        onclick={() => void (hasUserMessages ? controller?.retryLast() : controller?.loadModels())}
      >
        Retry
      </button>
    </div>
  {/if}

  <div bind:this={logEl} class="chat-log" role="log" aria-live="polite" aria-label="Alfa Assistant conversation">
    {#if view.messages.length === 0}
      <p class="empty-hint">Ask Alfa about this host, logs, services, or files.</p>
    {:else}
      {#each view.messages as msg (msg.id)}
        <article class={`chat-msg chat-${msg.role}`} data-role={msg.role}>
          <header class="msg-meta">{msg.role === "user" ? "You" : "Alfa"}</header>
          {#if msg.reasoning}
            <details class="reasoning-box">
              <summary>Reasoning</summary>
              <pre class="reasoning-text">{msg.reasoning}</pre>
            </details>
          {/if}
          {#if msg.text}
            <p class="msg-text">{msg.text}</p>
          {:else if msg.role === "assistant" && view.streaming && !msg.error}
            <p class="msg-pending">Thinking...</p>
          {/if}
          {#if msg.error}
            <div class="msg-error" role="alert">
              <span>{msg.error}</span>
              <button type="button" disabled={view.streaming} onclick={() => void controller?.retryLast()}>Retry</button>
            </div>
          {/if}
        </article>
      {/each}
    {/if}
  </div>

  <form class="composer" onsubmit={(event) => { event.preventDefault(); submitDraft(); }}>
    <label for="assistant-prompt" class="sr-only">Message Alfa Assistant</label>
    <textarea
      id="assistant-prompt"
      class="composer-input"
      rows="2"
      bind:value={draft}
      onkeydown={handleKeydown}
      placeholder="Ask Alfa anything (Enter to send, Shift+Enter for newline)"
      disabled={view.streaming}
    ></textarea>
    <div class="composer-actions">
      {#if view.streaming}
        <button type="button" class="danger" onclick={() => controller?.stopStreaming()}>Stop</button>
      {:else}
        <button type="submit" class="primary" disabled={!canSend}>Send</button>
      {/if}
    </div>
  </form>
</section>

<style>
  .assistant-shell { display: grid; gap: 0.875rem; min-width: 0; max-width: 100%; }
  .assistant-header { align-items: center; }
  .assistant-controls { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; min-width: 0; max-width: 100%; }
  .model-picker { display: inline-flex; min-width: 0; max-width: 100%; flex: 1 1 11rem; }
  .model-picker select { width: 100%; max-width: 100%; min-width: 0; text-overflow: ellipsis; }
  .assistant-banner { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; margin: 0; }
  .assistant-banner p { margin: 0; color: inherit; min-width: 0; flex: 1 1 12rem; }
  .chat-log {
    display: grid; align-content: start; gap: 0.75rem; min-height: 14rem; max-height: 28rem; padding: 0.875rem;
    overflow-y: auto; overflow-x: hidden; border: 1px solid var(--border); border-radius: 0.5rem;
    background: var(--surface); min-width: 0; max-width: 100%;
  }
  .empty-hint { margin: 0; color: var(--muted); }
  .chat-msg {
    display: grid; gap: 0.375rem; padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem;
    background: var(--panel); color: var(--text); min-width: 0; max-width: 100%;
  }
  .chat-user { border-color: var(--accent); }
  .msg-meta { font-size: 0.75rem; font-weight: 600; color: var(--muted); }
  .msg-text { margin: 0; color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
  .msg-pending { margin: 0; color: var(--muted); font-style: italic; }
  .reasoning-box { border: 1px solid var(--border); border-radius: 0.375rem; padding: 0.375rem 0.625rem; background: var(--surface); }
  .reasoning-box summary { cursor: pointer; font-size: 0.8125rem; font-weight: 600; color: var(--muted); }
  .reasoning-text { margin: 0.5rem 0 0; font-size: 0.8125rem; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); }
  .msg-error {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; padding: 0.5rem 0.625rem;
    border-radius: 0.375rem; border: 1px solid var(--danger); background: var(--danger-bg); color: var(--danger); font-size: 0.875rem;
  }
  .composer { display: flex; align-items: flex-end; gap: 0.5rem; flex-wrap: wrap; width: 100%; max-width: 100%; }
  .composer-input {
    flex: 1 1 13rem; min-width: 0; max-width: 100%; min-height: var(--ui-control-height); padding: 0.5rem 0.75rem;
    resize: vertical; background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 0.375rem; font: inherit;
  }
  .composer-actions { display: flex; gap: 0.5rem; flex: 0 0 auto; }
</style>
