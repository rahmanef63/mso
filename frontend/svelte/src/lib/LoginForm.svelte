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
  let now = $state(new Date());
  let activeAbort: AbortController | undefined;

  let lockTime = $derived(now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
  let lockDate = $derived(now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }));

  onMount(() => {
    deviceId = getOrCreateDeviceId();
    label = detectDeviceLabel();
    const timer = setInterval(() => { now = new Date(); }, 30_000);
    return () => {
      clearInterval(timer);
      activeAbort?.abort();
    };
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

<div class="lock-stage" data-auth-state={pendingInfo ? "pending" : "signed-out"}>
  <div class="lock-clock" aria-hidden="true">
    <div class="lock-date">{lockDate}</div>
    <div class="lock-time">{lockTime}</div>
  </div>

  <div class="auth-card">
    <div class="auth-brand">
      <img src="/icon.svg" alt="" class="auth-emblem" width="44" height="44" />
      <div>
        <h2>Sign in to the existing cockpit</h2>
        <p class="auth-sub">Use your MSO cockpit password on this hostname. New browsers require approval from an existing owner device or the host CLI.</p>
      </div>
    </div>

    <form class="auth-form" onsubmit={submit} novalidate>
      <div class="field">
        <label for="mso-login-password">Cockpit password</label>
        <input
          id="mso-login-password"
          name="password"
          type="password"
          autocomplete="current-password"
          placeholder="Enter password"
          bind:value={password}
          disabled={submitting}
          required
        />
      </div>

      {#if deviceId}
        <p class="device-meta">Device ID: <code>{deviceId.slice(0, 12)}</code> ({label})</p>
      {/if}

      <div class="actions">
        <button type="submit" class="primary auth-submit" disabled={submitting}>
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
          Approve it from an existing Owner session or on the host with <code>mso device approve {pendingInfo.deviceId}</code>, then sign in again.
        </p>
      </div>
    {/if}
  </div>
</div>

<style>
  .lock-stage {
    width: 100%;
    max-width: 26rem;
    margin: 0 auto;
    display: grid;
    gap: 1.5rem;
    padding: 0.5rem 0;
  }

  .lock-clock {
    text-align: center;
    color: #ffffff;
    text-shadow: 0 4px 20px rgba(0, 0, 0, 0.45);
    user-select: none;
  }

  .lock-date {
    font-size: 0.9375rem;
    font-weight: 500;
    opacity: 0.92;
  }

  .lock-time {
    font-size: clamp(2.5rem, 8vw, 3.75rem);
    font-weight: 600;
    line-height: 1.05;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }

  .auth-card {
    background: var(--glass-card);
    border: 1px solid var(--glass-border);
    border-radius: 1.25rem;
    padding: 1.5rem;
    box-shadow: var(--shadow-win);
    backdrop-filter: blur(28px) saturate(180%);
    -webkit-backdrop-filter: blur(28px) saturate(180%);
    min-width: 0;
  }

  .auth-brand {
    display: flex;
    align-items: flex-start;
    gap: 0.875rem;
    margin-bottom: 1.125rem;
  }

  .auth-emblem {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 22%;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.24);
    flex-shrink: 0;
  }

  .auth-brand h2 {
    margin: 0;
    font-size: 1.0625rem;
    font-weight: 600;
    color: var(--text);
  }

  .auth-sub {
    margin: 0.25rem 0 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--muted);
  }

  .auth-form {
    display: grid;
    gap: 0.875rem;
  }

  .auth-submit {
    width: 100%;
    border-radius: 0.625rem;
    min-height: 2.65rem;
  }

  .device-meta {
    margin: 0;
    font-size: 0.78rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  .device-meta code {
    font-family: var(--font-mono);
    padding: 0.1rem 0.35rem;
    border-radius: 0.25rem;
    background: color-mix(in srgb, var(--panel-solid) 75%, transparent);
    border: 1px solid var(--border);
  }
</style>
