<script lang="ts">
  import type { UploadProgressState } from "./files-extended-api.ts";
  import type { UploadItem } from "./files-meta.ts";

  let {
    uid,
    currentPath,
    dragActive,
    uploading,
    uploadCount,
    progress,
    onPickFiles,
  }: {
    uid: string;
    currentPath: string;
    dragActive: boolean;
    uploading: boolean;
    uploadCount: number;
    progress: UploadProgressState | null;
    onPickFiles: (items: UploadItem[]) => void;
  } = $props();

  let inputEl = $state<HTMLInputElement | undefined>(undefined);

  export function openPicker() {
    inputEl?.click();
  }

  function handleInputChange(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const files = Array.from(target.files ?? []);
    if (files.length > 0) {
      const items: UploadItem[] = files.map((file) => {
        const withRel = file as File & { webkitRelativePath?: string };
        return { relPath: withRel.webkitRelativePath || file.name, file };
      });
      onPickFiles(items);
    }
    target.value = "";
  }
</script>

<input
  id={`${uid}-upload-input`}
  class="sr-only"
  type="file"
  multiple
  aria-label="Choose files to upload"
  bind:this={inputEl}
  onchange={handleInputChange}
/>

{#if dragActive}
  <div class="drop-banner" role="status" aria-live="polite">
    <strong>Drop files or folders to upload</strong>
    <code>{currentPath}</code>
  </div>
{/if}

{#if uploading}
  <div class="upload-progress-bar" role="status" aria-live="polite" data-upload-progress>
    <div class="upload-meta">
      <span>Uploading {uploadCount} {uploadCount === 1 ? "file" : "files"}...</span>
      <span>{progress ? `${progress.pct}%` : "Starting..."}</span>
    </div>
    <div class="usage-track">
      <div class="usage-fill" style={`width: ${progress ? progress.pct : 8}%`}></div>
    </div>
  </div>
{/if}
