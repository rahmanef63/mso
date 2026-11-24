<script lang="ts">
  import { buildZipDownloadUrl } from "./files-extended-api.ts";
  import { HEAVY_ZIP_EXCLUDES } from "./files-meta.ts";

  let {
    uid,
    basePath,
    names,
    onClose,
  }: {
    uid: string;
    basePath: string;
    names: readonly string[];
    onClose: () => void;
  } = $props();

  let defaultArchiveName = $derived(
    names.length === 1 ? `${names[0]}.zip` : "archive.zip",
  );
  let archiveName = $state("");
  let excluded = $state<Set<string>>(new Set(HEAVY_ZIP_EXCLUDES));

  $effect(() => {
    archiveName = defaultArchiveName;
  });

  function toggleExclude(folder: string) {
    const next = new Set(excluded);
    if (next.has(folder)) next.delete(folder);
    else next.add(folder);
    excluded = next;
  }

  let zipHref = $derived.by(() => {
    try {
      return buildZipDownloadUrl(basePath, names, {
        name: archiveName || defaultArchiveName,
        exclude: [...excluded],
      });
    } catch {
      return "";
    }
  });
</script>

<div class="zip-panel" role="region" aria-label="Download Zip Archive" data-zip-panel>
  <div class="zip-head">
    <strong>Download as Zip ({names.length} {names.length === 1 ? "item" : "items"})</strong>
    <button type="button" onclick={onClose}>Close</button>
  </div>
  <div class="zip-row">
    <label for={`${uid}-zip-name`}>Archive name</label>
    <input
      id={`${uid}-zip-name`}
      type="text"
      bind:value={archiveName}
      placeholder={defaultArchiveName}
      autocomplete="off"
    />
  </div>
  <fieldset class="zip-excludes">
    <legend>Skip heavy directories</legend>
    <div class="zip-checks">
      {#each HEAVY_ZIP_EXCLUDES as dirName (dirName)}
        <label class="zip-check">
          <input
            type="checkbox"
            checked={excluded.has(dirName)}
            onchange={() => toggleExclude(dirName)}
          />
          <code>{dirName}</code>
        </label>
      {/each}
    </div>
  </fieldset>
  <div class="actions">
    {#if zipHref}
      <a class="zip-download-link" href={zipHref} download={archiveName || defaultArchiveName} onclick={onClose}>
        Download archive
      </a>
    {/if}
    <button type="button" onclick={onClose}>Cancel</button>
  </div>
</div>
