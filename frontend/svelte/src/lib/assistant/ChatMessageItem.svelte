<script lang="ts">
  import { formatRelativeTime } from "./assistant-presets";
  import type { AssistantMessage } from "./assistant-types";
  import MessageContent from "./MessageContent.svelte";

  let {
    msg,
    streaming,
    isLastAssistant,
    onRetry,
  }: {
    msg: AssistantMessage;
    streaming: boolean;
    isLastAssistant: boolean;
    onRetry: () => void;
  } = $props();

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  let senderLabel = $derived(
    msg.role === "user" ? "You" : msg.profileName ? `Alfa (${msg.profileName})` : "Alfa",
  );
  let timeLabel = $derived(formatRelativeTime(msg.createdAt));
  let activitySummary = $derived.by(() => {
    if (msg.role !== "assistant") return null;
    const calls = msg.toolCalls ?? [];
    if (calls.length > 0) {
      const last = calls[calls.length - 1];
      const failed = calls.some((c) => c.status === "error");
      return {
        tone: failed ? "error" : streaming && isLastAssistant ? "running" : "done",
        text: calls.length === 1 ? `Tool: ${last.name}` : `${calls.length} tools (latest: ${last.name})`,
      };
    }
    if (streaming && isLastAssistant && !msg.error) {
      return { tone: "running", text: msg.text ? "Streaming response..." : "Working on response..." };
    }
    return null;
  });

  async function copyMessage() {
    if (!msg.text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(msg.text);
        copied = true;
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(() => { copied = false; }, 1600);
      }
    } catch {
      copied = false;
    }
  }
</script>

<article class={`chat-msg chat-${msg.role}`} data-role={msg.role}>
  <header class="msg-head">
    <div class="msg-ident">
      <span class="msg-sender">{senderLabel}</span>
      {#if timeLabel}
        <span class="msg-time">{timeLabel}</span>
      {/if}
    </div>
    {#if msg.text}
      <button type="button" class="msg-copy-btn" onclick={() => void copyMessage()}>
        {copied ? "Copied" : "Copy"}
      </button>
    {/if}
  </header>

  {#if activitySummary}
    <div class={`activity-row tone-${activitySummary.tone}`} role="status">
      <span class="activity-dot" aria-hidden="true"></span>
      <span class="activity-label">{activitySummary.text}</span>
    </div>
  {/if}

  {#if msg.reasoning}
    <details class="reasoning-box">
      <summary>Reasoning ({msg.reasoning.length} chars)</summary>
      <pre class="reasoning-text">{msg.reasoning}</pre>
    </details>
  {/if}

  {#if msg.text}
    {#if msg.role === "assistant"}
      <MessageContent text={msg.text} />
    {:else}
      <p class="msg-user-text">{msg.text}</p>
    {/if}
  {:else if msg.role === "assistant" && streaming && !msg.error}
    <p class="msg-pending">Thinking...</p>
  {/if}

  {#if msg.error}
    <div class="msg-error" role="alert">
      <span>{msg.error}</span>
      <button type="button" disabled={streaming} onclick={onRetry}>Retry</button>
    </div>
  {/if}
</article>

<style>
  .chat-msg {
    display: grid;
    gap: 0.45rem;
    padding: 0.75rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: 0.625rem;
    background: var(--panel-solid);
    color: var(--text);
    min-width: 0;
    max-width: 100%;
  }
  .chat-user {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--panel-solid));
  }
  .msg-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .msg-ident {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }
  .msg-sender {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text);
  }
  .msg-time {
    font-size: 0.72rem;
    color: var(--muted);
  }
  .msg-copy-btn {
    min-height: 1.75rem;
    padding: 0.15rem 0.55rem;
    font-size: 0.75rem;
  }
  .activity-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.3rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--surface);
    font-size: 0.78rem;
    color: var(--muted);
    min-width: 0;
  }
  .activity-row.tone-running { border-color: var(--warn); background: var(--warn-bg); color: var(--warn); }
  .activity-row.tone-done { border-color: var(--ok); background: var(--ok-bg); color: var(--ok); }
  .activity-row.tone-error { border-color: var(--danger); background: var(--danger-bg); color: var(--danger); }
  .activity-dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    background: currentColor;
    flex-shrink: 0;
  }
  .activity-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .reasoning-box {
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    padding: 0.35rem 0.6rem;
    background: var(--surface);
    min-width: 0;
  }
  .reasoning-box summary {
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--muted);
  }
  .reasoning-text {
    margin: 0.45rem 0 0;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--muted);
  }
  .msg-user-text {
    margin: 0;
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .msg-pending {
    margin: 0;
    color: var(--muted);
    font-style: italic;
    font-size: 0.875rem;
  }
  .msg-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.625rem;
    border-radius: 0.4rem;
    border: 1px solid var(--danger);
    background: var(--danger-bg);
    color: var(--danger);
    font-size: 0.85rem;
  }
</style>
