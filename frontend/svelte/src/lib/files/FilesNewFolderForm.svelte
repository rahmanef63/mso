<script lang="ts">
  let {
    uid,
    busy,
    name = $bindable(""),
    inputEl = $bindable(undefined),
    onSubmit,
    onCancel,
    onEscape,
  }: {
    uid: string;
    busy: boolean;
    name: string;
    inputEl: HTMLInputElement | undefined;
    onSubmit: (event: SubmitEvent) => void;
    onCancel: () => void;
    onEscape: () => void;
  } = $props();
</script>

<form class="inline-form" onsubmit={onSubmit}>
  <label for={`${uid}-new-folder`}>New folder name</label>
  <div class="inline-form-row">
    <input
      id={`${uid}-new-folder`}
      type="text"
      bind:value={name}
      bind:this={inputEl}
      disabled={busy}
      placeholder="folder-name"
      autocomplete="off"
      onkeydown={(e) => { if (e.key === "Escape") onEscape(); }}
    />
    <button type="submit" class="primary" disabled={busy}>{busy ? "Creating..." : "Create"}</button>
    <button type="button" disabled={busy} onclick={onCancel}>Cancel</button>
  </div>
</form>
