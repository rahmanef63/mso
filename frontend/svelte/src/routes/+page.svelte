<script lang="ts">
  import Monitor from "../lib/Monitor.svelte";
  import DevicesPanel from "../lib/DevicesPanel.svelte";
  import { logoutSession, type Session } from "../lib/host-api";
  import "../styles.css";

  let activeSession = $state<Session | null>(null);
  let signingOut = $state(false);
  let signOutError = $state<string | null>(null);
  let monitorRef: { refresh: () => void } | undefined;

  async function handleSignOut() {
    if (signingOut) return;
    signingOut = true;
    signOutError = null;
    try {
      await logoutSession(new AbortController().signal);
      activeSession = null;
      monitorRef?.refresh();
    } catch {
      signOutError = "Could not complete sign-out. Check connection and retry.";
    } finally {
      signingOut = false;
    }
  }
</script>

<svelte:head><title>MSO | Svelte migration preview</title></svelte:head>
<a class="skip-link" href="#main-content">Skip to content</a>
<div class="workspace">
  <header class="workspace-header">
    <div class="brand">
      <h1>MSO</h1>
      <span>Svelte + Rust preview</span>
    </div>
    <div class="session-actions">
      {#if activeSession?.authenticated}
        <span class="role-badge">{activeSession.role}</span>
        <button disabled={signingOut} onclick={() => void handleSignOut()}>
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      {/if}
    </div>
  </header>
  {#if signOutError}
    <p class="feedback error" role="alert">{signOutError}</p>
  {/if}
  <main id="main-content" tabindex="-1" class="workspace-stack">
    <Monitor bind:this={monitorRef} onSessionChange={(next) => { activeSession = next; }} />
    {#if activeSession?.authenticated && activeSession.role === "owner"}
      <DevicesPanel currentDeviceId={activeSession.deviceId} />
    {/if}
  </main>
  <footer>Existing host API, CSRF depth-2, and device permissions. Production cockpit unchanged.</footer>
</div>
