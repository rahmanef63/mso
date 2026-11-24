<script lang="ts">
  import { onMount, tick } from "svelte";

  let {
    locked,
    deviceLabel,
    role,
    onUnlock,
    onSignOut,
  }: {
    locked: boolean;
    deviceLabel: string | null;
    role: string | null;
    onUnlock: () => void;
    onSignOut: () => void;
  } = $props();

  let overlayEl = $state<HTMLDivElement | null>(null);
  let unlockBtn = $state<HTMLButtonElement | null>(null);

  function getFocusable(): HTMLElement[] {
    if (!overlayEl) return [];
    return Array.from(
      overlayEl.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  function focusUnlock() {
    void tick().then(() => {
      unlockBtn?.focus();
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!locked) return;
    if (event.key === "Tab") {
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (!active || active === first || !overlayEl?.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (!active || active === last || !overlayEl?.contains(active)) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      const active = document.activeElement as HTMLElement | null;
      if (active && overlayEl?.contains(active) && active.tagName === "BUTTON") {
        return;
      }
      event.preventDefault();
      onUnlock();
    }
  }

  onMount(() => {
    if (locked) focusUnlock();
  });

  $effect(() => {
    if (!locked) return;
    focusUnlock();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if locked}
  <div
    class="lock-overlay"
    bind:this={overlayEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby="lock-screen-title"
    aria-describedby="lock-screen-note"
    tabindex="-1"
  >
    <div class="lock-card">
      <div class="lock-badges">
        <span class="role-badge">{role ?? "Session active"}</span>
        <span class="lock-device">{deviceLabel ?? "Current device"}</span>
      </div>

      <h2 id="lock-screen-title">Workspace locked</h2>

      <p id="lock-screen-note" class="lock-note">
        This is a local screen privacy lock that hides workspace visuals on this display.
        Your server session remains active until you sign out.
      </p>

      <div class="lock-actions">
        <button
          type="button"
          bind:this={unlockBtn}
          class="primary"
          onclick={onUnlock}
        >
          Unlock workspace
        </button>
        <button type="button" class="danger" onclick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .lock-overlay {
    position: fixed; inset: 0; z-index: 9500;
    display: grid; place-items: center; padding: 1.5rem;
    background: var(--surface); color: var(--text);
  }
  .lock-card {
    width: min(26rem, 100%); display: grid; gap: 0.875rem;
    padding: 1.5rem; background: var(--panel-solid);
    border: 1px solid var(--border); border-radius: 0.75rem;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.24);
  }
  .lock-badges { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .lock-device { font-size: 0.8125rem; color: var(--muted); overflow-wrap: anywhere; }
  .lock-card h2 { margin: 0; font-size: 1.25rem; }
  .lock-note { margin: 0; font-size: 0.9375rem; color: var(--muted); }
  .lock-actions { display: flex; flex-wrap: wrap; gap: 0.625rem; margin-top: 0.25rem; }
</style>
