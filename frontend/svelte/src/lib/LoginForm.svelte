<script lang="ts">
  import { onMount } from "svelte";
  import { detectDeviceLabel, getOrCreateDeviceId } from "./device";
  import { loginWithPassword } from "./host-api";

  let { onSignedIn }: { onSignedIn: () => void } = $props();

  let password = $state("");
  let deviceId = $state("");
  let label = $state("");
  let submitting = $state(false);
  let errorMessage = $state<string | null>(null);
  let pendingInfo = $state<{ deviceId: string; label: string } | null>(null);
  let activeAbort: AbortController | undefined;

  onMount(() => {
    deviceId = getOrCreateDeviceId();
    label = detectDeviceLabel();
    return () => activeAbort?.abort();
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting) return;
    if (!password) {
      errorMessage = "Enter the cockpit password to continue.";
      return;
    }
    submitting = true;
    errorMessage = null;
    pendingInfo = null;
    activeAbort?.abort();
    const controller = activeAbort = new AbortController();
    const provided = password;
    password = "";
    try {
      const result = await loginWithPassword(
        { password: provided, deviceId: deviceId || getOrCreateDeviceId(), deviceLabel: label || detectDeviceLabel() },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (result.kind === "ok") {
        onSignedIn();
      } else if (result.kind === "pending") {
        pendingInfo = { deviceId: result.deviceId, label: result.label };
      } else if (result.kind === "bad-password") {
        errorMessage = "Incorrect password. Check your credentials and try again.";
      } else if (result.kind === "rate-limited") {
        errorMessage = "Too many sign-in attempts. Wait a minute before retrying.";
      } else if (result.kind === "demo-disabled") {
        errorMessage = "Password sign-in is disabled in demo mode.";
      } else {
        errorMessage = result.message;
      }
    } catch {
      if (!controller.signal.aborted) {
        errorMessage = "Could not reach the MSO auth API. Check the backend and retry.";
      }
    } finally {
      submitting = false;
    }
  }
</script>

<div class="auth-panel" data-auth-state={pendingInfo ? "pending" : "signed-out"}>
  <h3>Sign in to the existing cockpit</h3>
  <p>Use your MSO cockpit password on this hostname. New browsers require approval from an existing owner device or the host CLI.</p>

  <form class="auth-form" onsubmit={submit} novalidate>
    <div class="field">
      <label for="mso-login-password">Cockpit password</label>
      <input
        id="mso-login-password"
        name="password"
        type="password"
        autocomplete="current-password"
        bind:value={password}
        disabled={submitting}
        required
      />
    </div>
    {#if deviceId}
      <p class="device-meta">Device ID: <code>{deviceId.slice(0, 12)}</code> ({label})</p>
    {/if}
    <div class="actions">
      <button type="submit" class="primary" disabled={submitting}>
        {submitting ? "Signing in..." : "Sign in"}
      </button>
    </div>
  </form>

  {#if errorMessage}
    <p class="feedback error" role="alert">{errorMessage}</p>
  {/if}

  {#if pendingInfo}
    <div class="feedback pending" role="status">
      <strong>Device approval required</strong>
      <p>
        This browser (<code>{pendingInfo.deviceId.slice(0, 12)}</code>, {pendingInfo.label}) is now pending approval.
        Approve it from an owner session or run <code>mso device approve {pendingInfo.deviceId}</code> on the host, then sign in again.
      </p>
    </div>
  {/if}
</div>
