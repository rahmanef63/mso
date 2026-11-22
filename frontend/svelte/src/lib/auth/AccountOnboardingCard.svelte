<script lang="ts">
  import { onMount } from "svelte";
  import { createAccountController, MAX_ACCOUNT_NAME_LENGTH, normalizeAccountName, validateNewPassword, type AccountState } from "./account-api.ts";

  let { role = null, deviceLabel = null }: { role?: "viewer" | "operator" | "owner" | null; deviceLabel?: string | null } = $props();

  let view = $state<AccountState>({ kind: "loading" });
  let displayName = $state("");
  let nameDirty = $state(false);
  let profileError = $state<string | null>(null);
  let currentPassword = $state("");
  let newPassword = $state("");
  let confirmPassword = $state("");
  let passwordError = $state<string | null>(null);
  let controller: ReturnType<typeof createAccountController> | undefined;

  let isOwner = $derived(role === "owner");
  let deviceText = $derived(deviceLabel?.trim() || "Current browser");
  let roleLabel = $derived(role ?? "signed-out");
  let profileRenamed = $derived(view.kind === "ready" && view.profile.name !== "Owner");
  let passwordDone = $derived(view.kind === "ready" && view.passwordRotated);

  export function refresh() {
    profileError = null;
    passwordError = null;
    nameDirty = false;
    void controller?.refresh();
  }

  async function handleSaveName(event: SubmitEvent) {
    event.preventDefault();
    profileError = null;
    const clean = normalizeAccountName(displayName);
    if (!clean) { profileError = `Enter a display name between 1 and ${MAX_ACCOUNT_NAME_LENGTH} characters.`; return; }
    if (await controller?.saveDisplayName(clean)) { displayName = clean; nameDirty = false; }
  }

  async function handleRotatePassword(event: SubmitEvent) {
    event.preventDefault();
    passwordError = null;
    const current = currentPassword, next = newPassword, confirm = confirmPassword;
    currentPassword = ""; newPassword = ""; confirmPassword = "";
    if (!current) { passwordError = "Enter your current cockpit password."; return; }
    const policyError = validateNewPassword(next);
    if (policyError) { passwordError = policyError; return; }
    if (next !== confirm) { passwordError = "New password and confirmation do not match."; return; }
    if (current === next) { passwordError = "Choose a new password different from the current one."; return; }
    await controller?.rotatePassword({ currentPassword: current, newPassword: next, confirmPassword: confirm });
  }

  onMount(() => {
    controller = createAccountController((next) => {
      if (next.kind === "ready" && !nameDirty) displayName = next.profile.name;
      view = next;
    });
    void controller.refresh();
    return () => controller?.dispose();
  });
</script>

<section aria-labelledby="account-onboarding-title" aria-busy={view.kind === "loading"} data-onboarding-state={view.kind}>
  <header class="feature-header">
    <div class="title-group">
      <h2 id="account-onboarding-title">Account &amp; Security</h2>
      <span class="role-badge" data-role={roleLabel}>{roleLabel}</span>
    </div>
    <button type="button" disabled={view.kind === "loading"} onclick={refresh}>
      {view.kind === "loading" ? "Loading..." : "Refresh"}
    </button>
  </header>

  <ul class="checklist" aria-label="First-login onboarding checklist">
    <li class="check-row" data-step="device" data-done="true">
      <span class="check-pill done">Verified</span>
      <div><strong>Device approved</strong><span>{deviceText}</span></div>
    </li>
    <li class="check-row" data-step="role" data-done={role ? "true" : "false"}>
      <span class="check-pill {role ? 'done' : 'pending'}">{role ? "Assigned" : "Pending"}</span>
      <div><strong>Session role</strong><span>Signed in with <span class="role-badge">{roleLabel}</span> access.</span></div>
    </li>
    <li class="check-row" data-step="profile" data-done={profileRenamed ? "true" : "false"}>
      <span class="check-pill {profileRenamed ? 'done' : 'pending'}">{profileRenamed ? "Done" : "Optional"}</span>
      <div><strong>Account display name</strong><span>{view.kind === "ready" ? view.profile.name : "Loading profile..."}</span></div>
    </li>
    {#if isOwner}
      <li class="check-row" data-step="password" data-done={passwordDone ? "true" : "false"}>
        <span class="check-pill {passwordDone ? 'done' : 'pending'}">{passwordDone ? "Rotated" : "Recommended"}</span>
        <div>
          <strong>Cockpit password rotation</strong>
          <span>{passwordDone ? "Password updated in this session." : "Rotate the shared login password after first sign-in."}</span>
        </div>
      </li>
    {/if}
  </ul>

  <div role="status" aria-live="polite">
    {#if view.kind === "loading"}
      <p>Loading account profile...</p>
    {:else if view.kind === "error"}
      <p class="feedback error" role="alert">{view.message}</p>
    {:else}
      {#if view.notice}<p class="feedback ok">{view.notice}</p>{/if}
      {#if view.actionError}<p class="feedback error" role="alert">{view.actionError}</p>{/if}

      <div class="account-block">
        <h3>Account Display Name</h3>
        {#if isOwner}
          <form class="account-form" onsubmit={(e) => void handleSaveName(e)} novalidate>
            <div class="field">
              <label for="account-display-name">Display name</label>
              <input
                id="account-display-name" name="displayName" type="text" maxlength={MAX_ACCOUNT_NAME_LENGTH}
                autocomplete="nickname" value={displayName} disabled={view.savingProfile} required
                oninput={(e) => { displayName = (e.currentTarget as HTMLInputElement).value; nameDirty = true; }}
              />
            </div>
            {#if profileError}<p class="feedback error" role="alert">{profileError}</p>{/if}
            <div class="actions">
              <button type="submit" class="primary" disabled={view.savingProfile || displayName.trim() === view.profile.name}>
                {view.savingProfile ? "Saving..." : "Update display name"}
              </button>
            </div>
          </form>
        {:else}
          <p class="feedback pending">Read-only view. Owner role is required to update the account name or rotate the cockpit password.</p>
        {/if}
      </div>

      {#if isOwner}
        <div class="account-block">
          <h3>Rotate Cockpit Password</h3>
          <p class="hint">Use 6 to 128 letters, numbers, or basic symbols (!@%^*_+-=.,:?~). Spaces, quotes, and $ are not allowed.</p>
          <form class="account-form" onsubmit={(e) => void handleRotatePassword(e)} novalidate>
            <div class="field">
              <label for="account-current-password">Current password</label>
              <input id="account-current-password" name="currentPassword" type="password" autocomplete="current-password" bind:value={currentPassword} disabled={view.rotatingPassword} required />
            </div>
            <div class="field">
              <label for="account-new-password">New password</label>
              <input id="account-new-password" name="newPassword" type="password" autocomplete="new-password" bind:value={newPassword} disabled={view.rotatingPassword} required />
            </div>
            <div class="field">
              <label for="account-confirm-password">Confirm new password</label>
              <input id="account-confirm-password" name="confirmPassword" type="password" autocomplete="new-password" bind:value={confirmPassword} disabled={view.rotatingPassword} required />
            </div>
            {#if passwordError}<p class="feedback error" role="alert">{passwordError}</p>{/if}
            <div class="actions">
              <button type="submit" class="primary" disabled={view.rotatingPassword}>
                {view.rotatingPassword ? "Updating password..." : "Rotate password"}
              </button>
            </div>
          </form>
        </div>
      {/if}
    {/if}
  </div>
</section>

<style>
  .title-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .checklist { list-style: none; padding: 0; margin: 1rem 0 0; display: grid; gap: 0.5rem; }
  .check-row { display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.625rem 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--surface); }
  .check-row div { display: grid; gap: 0.125rem; min-width: 0; }
  .check-row span { font-size: 0.875rem; color: var(--muted); }
  .check-pill { flex-shrink: 0; padding: 0.125rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; border: 1px solid var(--border); }
  .check-pill.done { color: var(--ok); background: var(--ok-bg); border-color: var(--ok); }
  .check-pill.pending { color: var(--warn); background: var(--warn-bg); border-color: var(--warn); }
  .account-block { margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid var(--border); display: grid; gap: 0.75rem; }
  .account-form { display: grid; gap: 0.75rem; }
  .hint { margin: 0; font-size: 0.875rem; color: var(--muted); }
</style>
