<script lang="ts">
  import ImageEditorAdjustments from "./ImageEditorAdjustments.svelte";
  import ImageEditorLayers from "./ImageEditorLayers.svelte";
  import type {
    EditorLayer,
    InspectorTab,
    StudioAdjustments,
  } from "./image-editor-state.ts";

  let {
    activeTab = $bindable<InspectorTab>("adjustments"),
    adjustments,
    activeFilter,
    layers,
    selectedLayerId,
    onPatchAdjustment,
    onCommitAdjustment,
    onResetAdjustments,
    onApplyPreset,
    onSelectLayer,
    onAddDrawingLayer,
    onToggleVisibility,
    onOpacityChange,
    onOpacityCommit,
    onMoveUp,
    onMoveDown,
    onDuplicate,
    onDelete,
  }: {
    activeTab: InspectorTab;
    adjustments: StudioAdjustments;
    activeFilter: string;
    layers: readonly EditorLayer[];
    selectedLayerId: string | null;
    onPatchAdjustment: (key: keyof StudioAdjustments, value: number) => void;
    onCommitAdjustment: () => void;
    onResetAdjustments: () => void;
    onApplyPreset: (presetId: string) => void;
    onSelectLayer: (id: string) => void;
    onAddDrawingLayer: () => void;
    onToggleVisibility: (id: string) => void;
    onOpacityChange: (id: string, opacity: number) => void;
    onOpacityCommit: () => void;
    onMoveUp: (id: string) => void;
    onMoveDown: (id: string) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
  } = $props();

  const TABS: readonly { id: InspectorTab; label: string }[] = [
    { id: "adjustments", label: "Adjust" },
    { id: "filters", label: "Filters" },
    { id: "layers", label: "Layers" },
  ];
</script>

<aside class="inspector" aria-label="Image inspector">
  <div class="tab-bar" role="tablist" aria-label="Inspector tabs">
    {#each TABS as tab (tab.id)}
      <button
        type="button"
        role="tab"
        class="tab-btn"
        class:primary={activeTab === tab.id}
        aria-selected={activeTab === tab.id}
        onclick={() => { activeTab = tab.id; }}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <div class="tab-body">
    {#if activeTab === "adjustments" || activeTab === "filters"}
      <ImageEditorAdjustments
        mode={activeTab}
        {adjustments}
        {activeFilter}
        {onPatchAdjustment}
        {onCommitAdjustment}
        {onResetAdjustments}
        {onApplyPreset}
      />
    {:else}
      <ImageEditorLayers
        {layers}
        {selectedLayerId}
        onSelect={onSelectLayer}
        {onAddDrawingLayer}
        {onToggleVisibility}
        {onOpacityChange}
        {onOpacityCommit}
        {onMoveUp}
        {onMoveDown}
        {onDuplicate}
        {onDelete}
      />
    {/if}
  </div>
</aside>

<style>
  .inspector {
    grid-area: inspector; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 0.625rem;
    padding: 0.625rem; border: 1px solid var(--border); border-radius: 0.5rem;
    background: var(--surface); align-self: start; min-width: 0;
  }
  .tab-bar { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.25rem; }
  .tab-btn { min-height: 2rem; padding: 0.25rem 0.4rem; font-size: 0.78rem; }
  .tab-body { overflow-y: auto; max-height: 34rem; padding-right: 0.15rem; }
  @media (max-width: 960px) {
    .tab-body { max-height: none; }
  }
</style>
