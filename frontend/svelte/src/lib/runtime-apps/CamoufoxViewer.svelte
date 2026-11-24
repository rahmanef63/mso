<script lang="ts">
  import type { CamoufoxSession, CamoufoxStatus } from "./runtime-apps-api.ts";

  let {
    status, session, sessionNote, viewerHref, embedSrc, canControl,
    showPassword, frameTick, frameError,
    onRevealPassword, onReload, onFrameError,
  }: {
    status: CamoufoxStatus;
    session: CamoufoxSession | null;
    sessionNote: string | null;
    viewerHref: string | null;
    embedSrc: string | null;
    canControl: boolean;
    showPassword: boolean;
    frameTick: number;
    frameError: string | null;
    onRevealPassword: () => void;
    onReload: () => void;
    onFrameError: (message: string) => void;
  } = $props();

  let frameReady = $derived(status.running && Boolean(embedSrc));
</script>

<div class="cf-cockpit">
  <div class="cf-rowline">
    <span class="cf-label">Service</span>
    <code>{status.unit ?? "camoufox-vnc"}</code>
    {#if status.activeState}<span class="pill">{status.activeState}</span>{/if}
  </div>

  {#if !canControl}
    <p class="cf-note" role="status">Owner or Operator role is required to open the split-origin viewer.</p>
  {:else if sessionNote}
    <p class="cf-note">{sessionNote}</p>
  {:else if session}
    <div class="cf-rowline">
      <span class="cf-label">VNC password</span>
      {#if session.hasPassword}
        <code class="cf-secret">{showPassword ? "stored-on-host" : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}</code>
        <button type="button" aria-pressed={showPassword} onclick={onRevealPassword}>
          {showPassword ? "Hide" : "Reveal"}
        </button>
        {#if showPassword}<span class="cf-note cf-inline">The credential stays on the host. MSO never sends it to this page.</span>{/if}
      {:else}
        <span class="pill" data-tone="warn">not configured</span>
      {/if}
    </div>
    {#if viewerHref}
      <div class="cf-rowline">
        <span class="cf-label">Viewer</span>
        <code>{viewerHref}</code>
        <button type="button" disabled={!frameReady} onclick={onReload}>Reload viewer</button>
        <a class="cf-link" href={viewerHref} target="_blank" rel="noopener noreferrer">Open in new tab</a>
      </div>
    {:else}
      <p class="cf-note">The split-origin viewer origin is not configured on this host.</p>
    {/if}
  {:else}
    <p class="cf-note">Viewer session configuration was not returned by the host.</p>
  {/if}
</div>

{#if !canControl}
  <div class="cf-placeholder">Viewer embed is hidden for this role.</div>
{:else if !status.running}
  <div class="cf-placeholder">
    <strong>The browser session is off.</strong>
    <p>Start it to stream a real Firefox from the host. Logins and open tabs persist on the host disk between sessions.</p>
  </div>
{:else if !embedSrc}
  <div class="cf-placeholder">
    <strong>Secure embedding is unavailable.</strong>
    <p>The split-origin noVNC host template is not configured here. Use the viewer link above instead.</p>
  </div>
{:else}
  {#if frameError}<p class="feedback error" role="alert">{frameError}</p>{/if}
  <div class="cf-embed">
    {#key frameTick}
      <iframe
        src={embedSrc}
        title="Camoufox remote browser"
        allow="clipboard-read; clipboard-write; fullscreen"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        onload={() => onFrameError("")}
        onerror={() => onFrameError("The viewer frame could not be loaded. Reload it or open the viewer in a new tab.")}
      ></iframe>
    {/key}
  </div>
{/if}

<style>
  .cf-cockpit {
    display: grid; gap: 0.5rem; margin-top: 1rem; padding: 0.75rem;
    border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel);
  }
  .cf-rowline { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .cf-label { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); min-width: 4.5rem; }
  .cf-rowline code { font-size: 0.75rem; overflow-wrap: anywhere; }
  .cf-secret { letter-spacing: 0.15em; }
  .cf-inline { flex: 1 1 100%; }
  .cf-note { margin: 0; font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .cf-link {
    display: inline-flex; align-items: center; min-height: 2rem; padding: 0.25rem 0.625rem;
    border: 1px solid var(--accent); border-radius: 0.375rem; background: var(--accent);
    color: var(--accent-text); font-size: 0.75rem; font-weight: 600; text-decoration: none; white-space: nowrap;
  }
  .cf-embed { margin-top: 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; overflow: hidden; background: #0c0d10; }
  .cf-embed iframe { display: block; width: 100%; height: clamp(18rem, 60vh, 46rem); border: 0; }
  .cf-placeholder {
    display: grid; gap: 0.375rem; justify-items: center; text-align: center; margin-top: 0.75rem;
    padding: 2rem 1rem; border: 1px dashed var(--border); border-radius: 0.5rem; background: var(--surface);
  }
  .cf-placeholder p { margin: 0; font-size: 0.8125rem; color: var(--muted); max-width: 30rem; }
  .pill { display: inline-block; padding: 0.125rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; color: var(--muted); }
  .pill[data-tone="warn"] { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  @media (max-width: 400px) {
    .cf-label { min-width: 100%; }
  }
</style>
