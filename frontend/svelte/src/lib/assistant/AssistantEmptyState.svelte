<script lang="ts">
  let {
    prompts,
    disabled,
    onPick,
  }: {
    prompts: string[];
    disabled: boolean;
    onPick: (prompt: string) => void;
  } = $props();
</script>

<div class="empty-hero">
  <h3>Ask Alfa</h3>
  <p class="empty-hint">
    Ask about this host, inspect logs or services, pick a playbook, or switch to a saved agent profile.
  </p>
  <div class="starter-grid">
    {#each prompts as prompt (prompt)}
      <button type="button" class="starter-card" {disabled} onclick={() => onPick(prompt)}>
        {prompt}
      </button>
    {/each}
  </div>
</div>

<style>
  .empty-hero {
    display: grid;
    gap: 0.75rem;
    padding: 0.75rem 0.25rem;
    min-width: 0;
  }
  .empty-hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.875rem;
  }
  .starter-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(12.5rem, 100%), 1fr));
    gap: 0.5rem;
    min-width: 0;
  }
  .starter-card {
    text-align: left;
    font-size: 0.82rem;
    line-height: 1.35;
    padding: 0.6rem 0.75rem;
    background: var(--panel-solid);
    white-space: normal;
    overflow-wrap: anywhere;
  }
</style>
