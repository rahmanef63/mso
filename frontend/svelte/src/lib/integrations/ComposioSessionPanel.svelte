<script lang="ts">
  import type { IntegrationConnectionSummary } from "./integrations-api.ts";
  import { ApiError } from "./integrations-api.ts";
  import {
    createComposioSession, readComposioKeyKind,
    type ComposioKeyKind, type ComposioSession,
  } from "./integrations-setup-api.ts";

  let { connections }: { connections: IntegrationConnectionSummary[] } = $props();

  let selected = $state("");
  let kind = $state<ComposioKeyKind>(null);
  let probe = $state<"idle" | "loading" | "ready" | "error">("idle");
  let probeError = $state("");
  let session = $state<ComposioSession | null>(null);
  let busy = $state(false);
  let message = $state("");

  let options = $derived(connections.filter((row) => row.source === "direct"));
  let active = $derived(options.find((row) => row.id === selected) ?? null);

  $effect(() => {
    if (!selected && options.length > 0) selected = options[0]!.id;
  });

  $effect(() => {
    // Reset the panel when the selected connection changes: a stale session is never shown.
    const row = active;
    session = null;
    message = "";
    kind = null;
    probeError = "";
    if (!row) { probe = "idle"; return; }
    probe = "loading";
    const controller = new AbortController();
    void readComposioKeyKind(row.user, row.id, controller.signal)
      .then((next) => { if (!controller.signal.aborted) { kind = next; probe = "ready"; } })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        probe = "error";
        probeError = error instanceof ApiError ? error.message : "Could not read the Composio key kind.";
      });
    return () => controller.abort();
  });

  async function startSession(refresh: boolean) {
    const row = active;
    if (!row || busy) return;
    busy = true;
    message = "";
    try {
      session = await createComposioSession(row.user, row.id, refresh, new AbortController().signal);
      message = refresh ? "New session created." : "Session ready.";
    } catch (cause) {
      message = cause instanceof ApiError ? cause.message : "Could not create a Composio session.";
      session = null;
    } finally {
      busy = false;
    }
  }

  const KIND_LABEL: Record<Exclude<ComposioKeyKind, null>, string> = {
    connect: "Connect API key (ck_)",
    organization: "Organization key",
    user: "User key (uak_)",
    project: "Project key (ak_)",
  };
</script>

<section class="composio" aria-labelledby="composio-title">
  <header class="feature-header">
    <h3 id="composio-title">Composio session</h3>
    {#if probe === "ready" && kind}<span class="pill" data-tone={kind === "connect" ? "warn" : "ok"}>{KIND_LABEL[kind]}</span>{/if}
  </header>

  {#if options.length === 0}
    <p class="composio-note">
      No direct Composio connection exists yet. Create one in the Composio provider card first.
    </p>
  {:else}
    <div class="field">
      <label for="composio-connection">Composio connection</label>
      <select id="composio-connection" bind:value={selected}>
        {#each options as row (row.id)}
          <option value={row.id}>{row.user} / {row.label}</option>
        {/each}
      </select>
    </div>

    {#if probe === "loading"}
      <p role="status">Reading the stored key kind...</p>
    {:else if probe === "error"}
      <p class="feedback error" role="alert">{probeError}</p>
    {:else if kind === "connect"}
      <p class="composio-note">
        Connect keys (ck_) validate at the Connect MCP endpoint and authenticate MCP sessions only. They cannot
        authorize Platform connected accounts, so no Platform actions run from this connection.
      </p>
      <div class="actions">
        <button type="button" class="primary" disabled={busy} onclick={() => void startSession(false)}>
          {busy ? "Opening..." : "Create Connect session"}
        </button>
        <button type="button" disabled={busy} onclick={() => void startSession(true)}>Start a new session</button>
      </div>
    {:else if kind}
      <p class="composio-note">
        A session MCP URL reaches your Composio toolkits through MSO. The authorization header stays server-side;
        only the URL is shown here.
      </p>
      <div class="actions">
        <button type="button" class="primary" disabled={busy} onclick={() => void startSession(false)}>
          {busy ? "Opening..." : session ? "Reopen session" : "Create session"}
        </button>
        <button type="button" disabled={busy} onclick={() => void startSession(true)}>Refresh session</button>
      </div>
    {:else}
      <p class="composio-note">This connection has no Composio key stored yet. Finish its setup, then reopen this panel.</p>
    {/if}

    {#if message}<p class="feedback" role="status">{message}</p>{/if}

    {#if session}
      <div class="composio-session">
        <p class="composio-label">Session MCP endpoint</p>
        <code class="composio-url">{session.mcpUrl}</code>
        {#if session.expiresAt}
          <p class="composio-note">Expires {new Date(session.expiresAt).toLocaleString()}</p>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  .composio { border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.875rem; background: var(--panel); display: grid; gap: 0.5rem; }
  .composio-note { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .composio-session { display: grid; gap: 0.25rem; padding: 0.5rem; border: 1px solid var(--border); border-radius: 0.375rem; background: var(--surface); min-width: 0; }
  .composio-label { margin: 0; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .composio-url { font-size: 0.75rem; overflow-wrap: anywhere; color: var(--text); }
  .field select { width: 100%; min-width: 0; min-height: var(--ui-control-height); }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.7rem; color: var(--muted); }
  .pill[data-tone="ok"] { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  @media (max-width: 420px) { .actions button { flex: 1 1 100%; } }
</style>
