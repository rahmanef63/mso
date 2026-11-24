<script lang="ts">
  import {
    CAPTION_STYLES,
    FILTER_PRESETS,
    TRANSITION_OPTIONS,
    type CaptionPosition,
    type CaptionStylePreset,
    type ClipFilterPreset,
    type ClipFitMode,
    type ClipTransition,
    type ReelCaption,
    type ReelTimelineClip,
  } from "./reel-model.ts";
  import ReelAssetBinTab from "./ReelAssetBinTab.svelte";

  type TabId = "inspector" | "captions" | "assets";

  type Props = {
    selectedClip: ReelTimelineClip | null;
    selectedCaption: ReelCaption | null;
    onPatchClip: (id: string, patch: Partial<ReelTimelineClip>) => void;
    onPatchTrim: (id: string, trimIn: number, trimOut: number) => void;
    onPatchCaption: (id: string, patch: Partial<ReelCaption>) => void;
    onAddClip: (input: {
      title: string;
      path?: string;
      durationSec: number;
      caption?: string;
      filter?: ClipFilterPreset;
      transition?: ClipTransition;
      externalUrl?: string;
      backdropColor?: string;
    }) => void;
    onAddCaption: (text: string) => void;
  };

  let {
    selectedClip,
    selectedCaption,
    onPatchClip,
    onPatchTrim,
    onPatchCaption,
    onAddClip,
    onAddCaption,
  }: Props = $props();

  let tab = $state<TabId>("inspector");
  let newTimedCaption = $state("");

  function submitTimedCaption(event: SubmitEvent) {
    event.preventDefault();
    if (!newTimedCaption.trim()) return;
    onAddCaption(newTimedCaption.trim());
    newTimedCaption = "";
  }
</script>

<aside class="inspector-panel" aria-label="Clip inspector and asset bin">
  <div class="tab-bar" role="tablist" aria-label="Inspector sections">
    <button type="button" role="tab" aria-selected={tab === "inspector"} class:active={tab === "inspector"} onclick={() => { tab = "inspector"; }}>Inspector</button>
    <button type="button" role="tab" aria-selected={tab === "captions"} class:active={tab === "captions"} onclick={() => { tab = "captions"; }}>Captions</button>
    <button type="button" role="tab" aria-selected={tab === "assets"} class:active={tab === "assets"} onclick={() => { tab = "assets"; }}>Asset Bin</button>
  </div>

  {#if tab === "inspector"}
    {#if selectedClip}
      <div class="panel-body">
        <div class="field">
          <label for="insp-title">Clip title</label>
          <input id="insp-title" type="text" value={selectedClip.title} oninput={(e) => onPatchClip(selectedClip.id, { title: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label for="insp-path">Host media path</label>
          <input id="insp-path" type="text" value={selectedClip.path} placeholder="/path/to/clip.mp4" oninput={(e) => onPatchClip(selectedClip.id, { path: e.currentTarget.value })} />
        </div>
        <div class="grid-3">
          <div class="field">
            <label for="insp-dur">Duration (s)</label>
            <input id="insp-dur" type="number" min="1" max="60" value={selectedClip.durationSec} oninput={(e) => onPatchClip(selectedClip.id, { durationSec: Math.min(60, Math.max(1, Number(e.currentTarget.value) || 1)) })} />
          </div>
          <div class="field">
            <label for="insp-in">Trim in (s)</label>
            <input id="insp-in" type="number" min="0" step="0.5" value={selectedClip.trimInSec} oninput={(e) => onPatchTrim(selectedClip.id, Number(e.currentTarget.value) || 0, selectedClip.trimOutSec)} />
          </div>
          <div class="field">
            <label for="insp-out">Trim out (s)</label>
            <input id="insp-out" type="number" min="0" step="0.5" value={selectedClip.trimOutSec} oninput={(e) => onPatchTrim(selectedClip.id, selectedClip.trimInSec, Number(e.currentTarget.value) || 0)} />
          </div>
        </div>
        <div class="grid-3">
          <div class="field">
            <label for="insp-fit">Fit mode</label>
            <select id="insp-fit" value={selectedClip.fit} onchange={(e) => onPatchClip(selectedClip.id, { fit: e.currentTarget.value as ClipFitMode })}>
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
            </select>
          </div>
          <div class="field">
            <label for="insp-filter">Filter preset</label>
            <select id="insp-filter" value={selectedClip.filter} onchange={(e) => onPatchClip(selectedClip.id, { filter: e.currentTarget.value as ClipFilterPreset })}>
              {#each FILTER_PRESETS as preset (preset.id)}
                <option value={preset.id}>{preset.label}</option>
              {/each}
            </select>
          </div>
          <div class="field">
            <label for="insp-trans">Transition</label>
            <select id="insp-trans" value={selectedClip.transition} onchange={(e) => onPatchClip(selectedClip.id, { transition: e.currentTarget.value as ClipTransition })}>
              {#each TRANSITION_OPTIONS as opt (opt.id)}
                <option value={opt.id}>{opt.label}</option>
              {/each}
            </select>
          </div>
        </div>
        <div class="field">
          <label for="insp-cap">Clip fallback caption</label>
          <input id="insp-cap" type="text" value={selectedClip.caption} oninput={(e) => onPatchClip(selectedClip.id, { caption: e.currentTarget.value })} />
        </div>
      </div>
    {:else}
      <p class="empty-msg">Select a clip on the timeline to edit its properties.</p>
    {/if}
  {:else if tab === "captions"}
    <div class="panel-body">
      <form class="inline-form" onsubmit={submitTimedCaption}>
        <input type="text" bind:value={newTimedCaption} placeholder="Add caption at playhead" aria-label="New timed caption text" />
        <button type="submit" class="primary">Add</button>
      </form>
      {#if selectedCaption}
        <div class="field">
          <label for="cap-text">Selected caption text</label>
          <input id="cap-text" type="text" value={selectedCaption.text} oninput={(e) => onPatchCaption(selectedCaption.id, { text: e.currentTarget.value })} />
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="cap-start">Start (s)</label>
            <input id="cap-start" type="number" min="0" step="0.2" value={selectedCaption.startSec} oninput={(e) => onPatchCaption(selectedCaption.id, { startSec: Math.max(0, Number(e.currentTarget.value) || 0) })} />
          </div>
          <div class="field">
            <label for="cap-end">End (s)</label>
            <input id="cap-end" type="number" min="0.5" step="0.2" value={selectedCaption.endSec} oninput={(e) => onPatchCaption(selectedCaption.id, { endSec: Math.max(selectedCaption.startSec + 0.5, Number(e.currentTarget.value) || 0.5) })} />
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="cap-pos">Position</label>
            <select id="cap-pos" value={selectedCaption.position} onchange={(e) => onPatchCaption(selectedCaption.id, { position: e.currentTarget.value as CaptionPosition })}>
              <option value="top">Top</option>
              <option value="center">Center</option>
              <option value="bottom">Bottom</option>
            </select>
          </div>
          <div class="field">
            <label for="cap-style">Style preset</label>
            <select id="cap-style" value={selectedCaption.style} onchange={(e) => onPatchCaption(selectedCaption.id, { style: e.currentTarget.value as CaptionStylePreset })}>
              {#each CAPTION_STYLES as st (st.id)}
                <option value={st.id}>{st.label}</option>
              {/each}
            </select>
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="cap-size">Font size ({selectedCaption.fontSizePx}px)</label>
            <input id="cap-size" type="range" min="12" max="32" value={selectedCaption.fontSizePx} oninput={(e) => onPatchCaption(selectedCaption.id, { fontSizePx: Number(e.currentTarget.value) })} />
          </div>
          <div class="field">
            <label for="cap-pill">Background pill</label>
            <button id="cap-pill" type="button" class:active={selectedCaption.bgPill} onclick={() => onPatchCaption(selectedCaption.id, { bgPill: !selectedCaption.bgPill })}>
              {selectedCaption.bgPill ? "Pill On" : "Pill Off"}
            </button>
          </div>
        </div>
      {:else}
        <p class="empty-msg">Select a timed caption on the Caption track to style it.</p>
      {/if}
    </div>
  {:else}
    <ReelAssetBinTab {onAddClip} />
  {/if}
</aside>

<style>
  .inspector-panel { display: grid; gap: 0.75rem; align-content: start; padding: 0.75rem; border: 1px solid var(--border); border-radius: 0.625rem; background: var(--surface); min-width: 0; }
  .tab-bar { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.35rem; }
  .tab-bar button.active, button.active { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 600; }
  .panel-body { display: grid; gap: 0.6rem; min-width: 0; }
  .grid-2 { display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr)); }
  .grid-3 { display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fit, minmax(5.75rem, 1fr)); }
  .inline-form { display: flex; gap: 0.4rem; }
  .inline-form input { flex: 1 1 auto; min-width: 0; }
  .empty-msg { margin: 0; font-size: 0.85rem; color: var(--muted); }
</style>
