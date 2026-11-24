<script lang="ts">
  import type { EditorLayer } from "./image-editor-state.ts";

  let {
    layers,
    selectedLayerId,
    onSelect,
    onAddDrawingLayer,
    onToggleVisibility,
    onOpacityChange,
    onOpacityCommit,
    onMoveUp,
    onMoveDown,
    onDuplicate,
    onDelete,
  }: {
    layers: readonly EditorLayer[];
    selectedLayerId: string | null;
    onSelect: (id: string) => void;
    onAddDrawingLayer: () => void;
    onToggleVisibility: (id: string) => void;
    onOpacityChange: (id: string, opacity: number) => void;
    onOpacityCommit: () => void;
    onMoveUp: (id: string) => void;
    onMoveDown: (id: string) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
  } = $props();

  const KIND_TAG: Record<EditorLayer["kind"], string> = {
    image: "IMG",
    drawing: "DRAW",
    text: "TEXT",
    shape: "SHP",
  };

  let displayLayers = $derived([...layers].reverse());
  let selectedLayer = $derived(layers.find((l) => l.id === selectedLayerId) ?? null);
</script>

<div class="layers-panel">
  <div class="panel-head">
    <h3>Layers ({layers.length})</h3>
    <button type="button" class="mini-btn" onclick={onAddDrawingLayer}>+ Draw Layer</button>
  </div>

  {#if selectedLayer}
    <div class="opacity-bar">
      <div class="opacity-meta">
        <label for="layer-opacity-slider">Opacity ({selectedLayer.name})</label>
        <span>{Math.round(selectedLayer.opacity * 100)}%</span>
      </div>
      <input
        id="layer-opacity-slider"
        type="range"
        min="0"
        max="100"
        value={Math.round(selectedLayer.opacity * 100)}
        oninput={(e) => onOpacityChange(selectedLayer.id, Number(e.currentTarget.value) / 100)}
        onchange={onOpacityCommit}
      />
    </div>
  {/if}

  <ul class="layer-list" aria-label="Layer stack">
    {#each displayLayers as layer, di (layer.id)}
      {@const isSelected = layer.id === selectedLayerId}
      <li class="layer-item" class:selected={isSelected}>
        <div class="layer-top">
          <button
            type="button"
            class="vis-btn"
            aria-pressed={layer.visible}
            aria-label="{layer.visible ? 'Hide' : 'Show'} {layer.name}"
            onclick={() => onToggleVisibility(layer.id)}
          >
            {layer.visible ? "On" : "Off"}
          </button>
          <button
            type="button"
            class="name-btn"
            onclick={() => onSelect(layer.id)}
          >
            <span class="kind-pill">{KIND_TAG[layer.kind]}</span>
            <span class="layer-name">{layer.name}</span>
          </button>
        </div>

        <div class="layer-actions">
          <button
            type="button"
            class="act-btn"
            disabled={di === 0}
            aria-label="Move {layer.name} up"
            onclick={() => onMoveUp(layer.id)}
          >
            Up
          </button>
          <button
            type="button"
            class="act-btn"
            disabled={di === displayLayers.length - 1}
            aria-label="Move {layer.name} down"
            onclick={() => onMoveDown(layer.id)}
          >
            Down
          </button>
          <button
            type="button"
            class="act-btn"
            aria-label="Duplicate {layer.name}"
            onclick={() => onDuplicate(layer.id)}
          >
            Dup
          </button>
          <button
            type="button"
            class="act-btn danger"
            disabled={layers.length <= 1}
            aria-label="Delete {layer.name}"
            onclick={() => onDelete(layer.id)}
          >
            Del
          </button>
        </div>
      </li>
    {/each}
  </ul>
</div>

<style>
  .layers-panel { display: grid; gap: 0.625rem; }
  .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
  .mini-btn { min-height: 1.8rem; padding: 0.2rem 0.5rem; font-size: 0.75rem; }
  .opacity-bar { display: grid; gap: 0.25rem; padding: 0.5rem; border: 1px solid var(--border); border-radius: 0.45rem; background: var(--panel-solid); }
  .opacity-meta { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--muted); }
  .opacity-meta label { color: var(--text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .opacity-bar input[type="range"] { width: 100%; min-height: 1.4rem; padding: 0; border: 0; background: transparent; accent-color: var(--accent); }
  .layer-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
  .layer-item {
    display: grid; gap: 0.35rem; padding: 0.45rem; border: 1px solid var(--border);
    border-radius: 0.45rem; background: var(--panel-solid);
  }
  .layer-item.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .layer-top { display: flex; align-items: center; gap: 0.35rem; min-width: 0; }
  .vis-btn { min-height: 1.7rem; padding: 0.1rem 0.4rem; font-size: 0.72rem; flex-shrink: 0; }
  .name-btn {
    flex: 1 1 auto; min-width: 0; min-height: 1.7rem; padding: 0.1rem 0.35rem;
    display: flex; align-items: center; gap: 0.35rem; border: 0; background: transparent; text-align: left;
  }
  .kind-pill {
    font-family: var(--font-mono); font-size: 0.65rem; font-weight: 700;
    padding: 0.08rem 0.3rem; border-radius: 0.25rem; background: var(--surface);
    border: 1px solid var(--border); color: var(--muted); flex-shrink: 0;
  }
  .layer-name { font-size: 0.8125rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .layer-actions { display: flex; gap: 0.25rem; flex-wrap: wrap; }
  .act-btn { min-height: 1.65rem; padding: 0.1rem 0.45rem; font-size: 0.72rem; border-radius: 0.32rem; }
</style>
