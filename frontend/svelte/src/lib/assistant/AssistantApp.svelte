<script lang="ts">
  import { onMount } from "svelte";
  import {
    createAssistantController,
    initialAssistantState,
    type AssistantState,
  } from "./assistant-controller";
  import { DEFAULT_STARTERS, findPlaybook } from "./assistant-presets";
  import AssistantEmptyState from "./AssistantEmptyState.svelte";
  import ChatComposer from "./ChatComposer.svelte";
  import ChatMessageItem from "./ChatMessageItem.svelte";
  import InspectorDrawer from "./InspectorDrawer.svelte";
  import ThreadsSidebar from "./ThreadsSidebar.svelte";

  let { autoLoadModels = true }: { autoLoadModels?: boolean } = $props();

  let view = $state<AssistantState>(initialAssistantState());
  let draft = $state("");
  let showThreads = $state(false);
  let showInspector = $state(false);
  let logEl = $state<HTMLDivElement | undefined>(undefined);
  let controller: ReturnType<typeof createAssistantController> | undefined;

  let hasUserMessages = $derived(view.messages.some((m) => m.role === "user"));
  let activeProfile = $derived(view.profiles.find((p) => p.id === view.activeProfileId) ?? null);
  let activePlaybook = $derived(findPlaybook(view.activePlaybookId));
  let activeModeLabel = $derived(
    activeProfile ? `Profile: ${activeProfile.name}` : activePlaybook ? `Playbook: ${activePlaybook.name}` : null,
  );
  let promptStarters = $derived(
    [...new Set([...(activePlaybook?.starters ?? []), ...DEFAULT_STARTERS])].slice(0, 6),
  );
  let lastAssistantIdx = $derived.by(() => {
    for (let i = view.messages.length - 1; i >= 0; i--) {
      if (view.messages[i].role === "assistant") return i;
    }
    return -1;
  });

  $effect(() => {
    void view.messages;
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  });

  onMount(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 900) showThreads = true;
    controller = createAssistantController((next) => { view = next; });
    if (autoLoadModels) {
      void controller.loadModels();
      void controller.loadWorkspace();
    }
    return () => controller?.dispose();
  });

  function submitDraft() {
    const text = draft.trim();
    if (!text || view.streaming) return;
    draft = "";
    void controller?.sendMessage(text);
  }

  function pickStarter(prompt: string) {
    if (view.streaming) return;
    draft = "";
    void controller?.sendMessage(prompt);
  }

  function handleSelectThread(id: string) {
    void controller?.selectThread(id);
    if (typeof window !== "undefined" && window.innerWidth < 760) showThreads = false;
  }
</script>

<section
  class="assistant-shell"
  aria-labelledby="assistant-title"
  aria-busy={view.streaming || view.modelsLoading}
  data-assistant-streaming={view.streaming ? "true" : "false"}
>
  <header class="feature-header assistant-header">
    <div class="title-group">
      <h2 id="assistant-title">Alfa Assistant</h2>
      {#if view.activeThreadTitle}
        <span class="active-thread-label">{view.activeThreadTitle}</span>
      {/if}
    </div>
    <div class="assistant-controls">
      <button type="button" class="toolbar-btn" aria-pressed={showThreads} onclick={() => { showThreads = !showThreads; }}>
        Threads ({view.threads.length})
      </button>
      <button type="button" class="toolbar-btn" aria-pressed={showInspector} onclick={() => { showInspector = !showInspector; }}>
        Profiles & Tools
      </button>
      <button type="button" class="toolbar-btn" onclick={() => controller?.newChat()}>New chat</button>
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

  <div class="cockpit-grid" class:has-threads={showThreads} class:has-inspector={showInspector}>
    {#if showThreads}
      <ThreadsSidebar
        threads={view.threads}
        activeThreadId={view.activeThreadId}
        status={view.threadsStatus}
        note={view.threadsNote}
        onSelect={handleSelectThread}
        onNew={() => controller?.newChat()}
        onRename={(id, title) => void controller?.renameThread(id, title)}
        onDelete={(id) => void controller?.deleteThread(id)}
        onClose={() => { showThreads = false; }}
      />
    {/if}

    <div class="chat-pane">
      <div bind:this={logEl} class="chat-log" role="log" aria-live="polite" aria-label="Alfa Assistant conversation">
        {#if view.messages.length === 0}
          <AssistantEmptyState prompts={promptStarters} disabled={view.streaming} onPick={pickStarter} />
        {:else}
          {#each view.messages as msg, idx (msg.id)}
            <ChatMessageItem
              {msg}
              streaming={view.streaming}
              isLastAssistant={idx === lastAssistantIdx}
              onRetry={() => void controller?.retryLast()}
            />
          {/each}
        {/if}
      </div>

      <ChatComposer
        bind:draft
        models={view.models}
        modelsLoading={view.modelsLoading}
        selectedModel={view.selectedModel}
        streaming={view.streaming}
        {activeModeLabel}
        onSelectModel={(model) => controller?.selectModel(model)}
        onClearMode={() => { controller?.selectProfile(null); controller?.selectPlaybook(null); }}
        onSubmit={submitDraft}
        onStop={() => controller?.stopStreaming()}
      />
    </div>

    {#if showInspector}
      <InspectorDrawer
        profiles={view.profiles}
        profilesStatus={view.profilesStatus}
        profilesNote={view.profilesNote}
        activeProfileId={view.activeProfileId}
        activePlaybookId={view.activePlaybookId}
        tools={view.tools}
        toolsScope={view.toolsScope}
        toolsStatus={view.toolsStatus}
        toolsNote={view.toolsNote}
        sessions={view.sessions}
        sessionsStatus={view.sessionsStatus}
        sessionsNote={view.sessionsNote}
        cockpit={view.cockpit}
        onSelectProfile={(id) => controller?.selectProfile(id)}
        onSelectPlaybook={(id) => controller?.selectPlaybook(id)}
        onPickStarter={pickStarter}
        onRefresh={() => void controller?.refreshInspector()}
        onClose={() => { showInspector = false; }}
      />
    {/if}
  </div>
</section>

<style>
  .assistant-shell { display: grid; gap: 0.75rem; min-width: 0; max-width: 100%; }
  .assistant-header { align-items: center; }
  .title-group { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; min-width: 0; }
  .active-thread-label {
    font-size: 0.8rem;
    color: var(--muted);
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .assistant-controls { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; min-width: 0; max-width: 100%; }
  .toolbar-btn { min-height: 2.25rem; padding: 0.3rem 0.65rem; font-size: 0.82rem; }
  .toolbar-btn[aria-pressed="true"] {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, var(--panel-solid));
  }
  .assistant-banner { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; margin: 0; }
  .assistant-banner p { margin: 0; color: inherit; min-width: 0; flex: 1 1 12rem; }
  .cockpit-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.75rem;
    align-items: start;
    min-width: 0;
    max-width: 100%;
  }
  @media (min-width: 760px) {
    .cockpit-grid.has-threads { grid-template-columns: minmax(12.5rem, 15.5rem) minmax(0, 1fr); }
    .cockpit-grid.has-inspector { grid-template-columns: minmax(0, 1fr) minmax(14rem, 18rem); }
    .cockpit-grid.has-threads.has-inspector {
      grid-template-columns: minmax(12rem, 14.5rem) minmax(0, 1fr) minmax(14rem, 17rem);
    }
  }
  .chat-pane { display: grid; gap: 0.65rem; min-width: 0; max-width: 100%; }
  .chat-log {
    display: grid;
    align-content: start;
    gap: 0.65rem;
    min-height: 16rem;
    max-height: 28rem;
    padding: 0.75rem;
    overflow-y: auto;
    overflow-x: hidden;
    border: 1px solid var(--border);
    border-radius: 0.625rem;
    background: var(--surface);
    min-width: 0;
    max-width: 100%;
  }
</style>
