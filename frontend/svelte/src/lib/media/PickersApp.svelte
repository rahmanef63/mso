<script lang="ts">
  import IconPickerPanel from "./IconPickerPanel.svelte";
  import ImagePickerPanel from "./ImagePickerPanel.svelte";

  type PickerTab = "icons" | "images";

  let activeTab = $state<PickerTab>("icons");
  let statusNotice = $state<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  function announce(message: string) {
    statusNotice = message;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { statusNotice = null; }, 4000);
  }
</script>

<section aria-labelledby="pickers-title" data-picker-tab={activeTab}>
  <header class="feature-header">
    <h2 id="pickers-title">Pickers</h2>
    <div class="picker-tabs" role="tablist" aria-label="Picker categories">
      <button type="button" role="tab" aria-selected={activeTab === "icons"} aria-controls="panel-icons"
        class:primary={activeTab === "icons"} onclick={() => { activeTab = "icons"; }}>
        Icon Picker
      </button>
      <button type="button" role="tab" aria-selected={activeTab === "images"} aria-controls="panel-images"
        class:primary={activeTab === "images"} onclick={() => { activeTab = "images"; }}>
        Image Picker
      </button>
    </div>
  </header>

  <div class="notice-slot" role="status" aria-live="polite">
    {#if statusNotice}<p class="feedback ok">{statusNotice}</p>{/if}
  </div>

  {#if activeTab === "icons"}
    <div id="panel-icons" role="tabpanel" aria-labelledby="pickers-title">
      <IconPickerPanel onNotice={announce} />
    </div>
  {:else}
    <div id="panel-images" role="tabpanel" aria-labelledby="pickers-title">
      <ImagePickerPanel onNotice={announce} />
    </div>
  {/if}
</section>

<style>
  .picker-tabs { display: inline-flex; gap: 0.375rem; flex-wrap: wrap; }
  .notice-slot { min-height: 0; }
  .notice-slot p { margin: 0.75rem 0 0; }
</style>
