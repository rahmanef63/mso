<script lang="ts">
  import { mediaKindFor } from "./files-meta.ts";
  import type { FilePreviewState } from "./files-controller.ts";
  import FilesQuickLook from "./FilesQuickLook.svelte";

  let {
    uid,
    preview,
    busy,
    editing,
    editPath,
    draft = $bindable(""),
    editorEl = $bindable(undefined),
    onCopyPath,
    onClose,
    onStartEdit,
    onSaveEdit,
    onCancelEdit,
  }: {
    uid: string;
    preview: Exclude<FilePreviewState, { kind: "idle" }>;
    busy: boolean;
    editing: boolean;
    editPath: string | null;
    draft: string;
    editorEl: HTMLTextAreaElement | undefined;
    onCopyPath: (path: string) => void;
    onClose: () => void;
    onStartEdit: (path: string, content: string) => void;
    onSaveEdit: (path: string) => void;
    onCancelEdit: () => void;
  } = $props();

  let canEdit = $derived(
    preview.kind === "ready" && ["text", "code", "markdown"].includes(preview.mediaKind ?? mediaKindFor(preview.name)),
  );
</script>

<FilesQuickLook {uid} {preview} {busy} {editing} {editPath} bind:draft bind:editorEl {onCopyPath} onClose={onClose}>
  {#snippet headerActions()}
    {#if canEdit && preview.kind === "ready" && !(editing && editPath === preview.path)}
      <button type="button" class="compact-btn" disabled={busy} onclick={() => onStartEdit(preview.path, preview.content)}>Edit</button>
    {/if}
  {/snippet}
  {#snippet editorFooter()}
    {#if preview.kind === "ready"}
      <div class="editor-actions">
        <button type="button" class="primary" disabled={busy} onclick={() => onSaveEdit(preview.path)}>{busy ? "Saving..." : "Save"}</button>
        <button type="button" disabled={busy} onclick={onCancelEdit}>Cancel</button>
        {#if draft !== preview.content}<span class="dirty-notice">Unsaved changes</span>{/if}
      </div>
    {/if}
  {/snippet}
</FilesQuickLook>
