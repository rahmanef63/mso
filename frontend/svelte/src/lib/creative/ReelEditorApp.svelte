<script lang="ts">
  import "./ReelEditorApp.css";
  import { moveItem } from "./creative-state.ts";
  import {
    createCaption,
    createTimelineClip,
    defaultReelProject,
    totalTimelineDuration,
    type AspectRatioId,
    type ClipTransition,
    type HistoryStack,
    type ReelAudioTrack,
    type ReelCaption,
    type ReelFps,
    type ReelProjectState,
    type ReelTimelineClip,
  } from "./reel-model.ts";
  import {
    buildStoryboardExport,
    clipStartTime,
    createHistory,
    duplicateClip,
    patchClipTrim,
    pushHistory,
    redoHistory,
    resolveActiveCaptions,
    resolveTimelineClipAtTime,
    splitClipAtTime,
    undoHistory,
  } from "./reel-ops.ts";
  import { captureStageSnapshot, downloadJsonFile, slugifyFilename } from "./reel-snapshot.ts";
  import ReelInspectorBin from "./ReelInspectorBin.svelte";
  import ReelProjectBar from "./ReelProjectBar.svelte";
  import ReelStagePreview from "./ReelStagePreview.svelte";
  import ReelTimeline from "./ReelTimeline.svelte";

  const initialProject = defaultReelProject();
  let history = $state<HistoryStack<ReelProjectState>>(createHistory(initialProject));
  let project = $derived(history.present);
  let canUndo = $derived(history.past.length > 0);
  let canRedo = $derived(history.future.length > 0);

  let playheadSec = $state(0);
  let playing = $state(false);
  let looping = $state(true);
  let showSafeZone = $state(false);
  let selectedClipId = $state<string | null>(initialProject.clips[0]?.id ?? null);
  let selectedCaptionId = $state<string | null>(initialProject.captions[0]?.id ?? null);
  let notice = $state<{ tone: "ok" | "error"; text: string } | null>(null);
  let stageMediaEl = $state<HTMLImageElement | HTMLVideoElement | null>(null);

  let totalSec = $derived(totalTimelineDuration(project.clips));
  let safePlayhead = $derived(totalSec > 0 ? Math.min(totalSec, Math.max(0, playheadSec)) : 0);
  let active = $derived(resolveTimelineClipAtTime(project.clips, safePlayhead));
  let activeCaption = $derived(resolveActiveCaptions(project.captions, safePlayhead)[0] ?? null);
  let selectedClip = $derived(
    project.clips.find((c) => c.id === selectedClipId) ?? active?.clip ?? project.clips[0] ?? null,
  );
  let selectedCaption = $derived(
    project.captions.find((c) => c.id === selectedCaptionId) ?? activeCaption ?? project.captions[0] ?? null,
  );

  function commit(updater: (curr: ReelProjectState) => ReelProjectState) {
    history = pushHistory(history, updater(project));
  }

  $effect(() => {
    if (!playing || totalSec <= 0) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const next = playheadSec + dt;
      if (next >= totalSec) {
        if (looping) playheadSec = 0;
        else { playheadSec = totalSec; playing = false; }
      } else {
        playheadSec = Math.round(next * 10) / 10;
      }
    }, 100);
    return () => clearInterval(id);
  });

  function handleUndo() {
    if (!canUndo) return;
    playing = false;
    history = undoHistory(history);
    notice = { tone: "ok", text: "Undid last edit." };
  }

  function handleRedo() {
    if (!canRedo) return;
    playing = false;
    history = redoHistory(history);
    notice = { tone: "ok", text: "Redid edit." };
  }

  function jumpClipDelta(delta: number) {
    if (project.clips.length === 0) return;
    const nextIdx = Math.min(project.clips.length - 1, Math.max(0, (active?.index ?? 0) + delta));
    playheadSec = clipStartTime(project.clips, nextIdx);
    selectedClipId = project.clips[nextIdx]?.id ?? null;
  }

  function selectClip(id: string) {
    selectedClipId = id;
    const idx = project.clips.findIndex((c) => c.id === id);
    if (idx >= 0) playheadSec = clipStartTime(project.clips, idx);
  }

  function handleAddClip(input: Parameters<typeof createTimelineClip>[0]) {
    const created = createTimelineClip(input);
    const startOfNew = totalSec;
    commit((curr) => ({ ...curr, clips: [...curr.clips, created] }));
    selectedClipId = created.id;
    playheadSec = startOfNew;
    notice = { tone: "ok", text: `Added "${created.title}" to timeline.` };
  }

  function handleSplit(id: string) {
    const res = splitClipAtTime(project.clips, id, safePlayhead);
    if (!res.createdId) {
      notice = { tone: "error", text: "Clip must be at least 1s long to split." };
      return;
    }
    commit((curr) => ({ ...curr, clips: res.clips }));
    selectedClipId = res.createdId;
    notice = { tone: "ok", text: "Split clip into two segments." };
  }

  function handleDuplicate(id: string) {
    const res = duplicateClip(project.clips, id);
    if (!res.createdId) return;
    commit((curr) => ({ ...curr, clips: res.clips }));
    selectedClipId = res.createdId;
    notice = { tone: "ok", text: "Duplicated clip." };
  }

  function handleDeleteClip(id: string) {
    commit((curr) => ({ ...curr, clips: curr.clips.filter((c) => c.id !== id) }));
    if (selectedClipId === id) selectedClipId = project.clips[0]?.id ?? null;
  }

  function handlePatchClip(id: string, patch: Partial<ReelTimelineClip>) {
    commit((curr) => ({ ...curr, clips: curr.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  }

  function handlePatchTrim(id: string, trimIn: number, trimOut: number) {
    commit((curr) => ({ ...curr, clips: curr.clips.map((c) => (c.id === id ? patchClipTrim(c, trimIn, trimOut) : c)) }));
  }

  function handleAddCaption(text = "New caption") {
    const created = createCaption({ text, startSec: safePlayhead, endSec: Math.max(totalSec, safePlayhead + 3) });
    commit((curr) => ({ ...curr, captions: [...curr.captions, created] }));
    selectedCaptionId = created.id;
  }

  function handlePatchCaption(id: string, patch: Partial<ReelCaption>) {
    commit((curr) => ({ ...curr, captions: curr.captions.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  }

  function handleDeleteCaption(id: string) {
    commit((curr) => ({ ...curr, captions: curr.captions.filter((c) => c.id !== id) }));
    if (selectedCaptionId === id) selectedCaptionId = project.captions[0]?.id ?? null;
  }

  function exportJson() {
    const filename = `${slugifyFilename(project.title, "reel")}-storyboard.json`;
    const ok = downloadJsonFile(filename, buildStoryboardExport(project));
    notice = ok
      ? { tone: "ok", text: `Exported ${filename}.` }
      : { tone: "error", text: "JSON export is unavailable in this environment." };
  }

  function exportSnapshot() {
    const res = captureStageSnapshot({
      title: project.title,
      aspect: project.aspect,
      activeClip: active?.clip ?? null,
      caption: activeCaption,
      timeLabel: `${safePlayhead.toFixed(1)}s`,
      mediaEl: stageMediaEl,
    });
    notice = { tone: res.ok ? "ok" : "error", text: res.message };
  }
</script>

<section class="reel-root" aria-labelledby="reel-editor-title">
  <ReelProjectBar title={project.title} aspect={project.aspect} fps={project.fps}
    {canUndo}
    {canRedo} onTitleChange={(title) => commit((curr) => ({ ...curr, title }))} onAspectChange={(aspect: AspectRatioId) => commit((curr) => ({ ...curr, aspect }))} onFpsChange={(fps: ReelFps) => commit((curr) => ({ ...curr, fps }))} onUndo={handleUndo} onRedo={handleRedo} onExportSnapshot={exportSnapshot} onExportJson={exportJson}
  />

  {#if notice}
    <p class="feedback {notice.tone}" role="status">{notice.text}</p>
  {/if}

  <div class="workspace-grid">
    <ReelStagePreview aspect={project.aspect}
      {active} clipCount={project.clips.length}
      {activeCaption} playheadSec={safePlayhead}
      {totalSec}
      {playing}
      {looping}
      {showSafeZone} onTogglePlay={() => { playing = !playing; }} onPrevClip={() => jumpClipDelta(-1)} onNextClip={() => jumpClipDelta(1)} onToggleLoop={() => { looping = !looping; }} onToggleSafeZone={() => { showSafeZone = !showSafeZone; }} onMediaRef={(el) => { stageMediaEl = el; }}
    />
    <ReelInspectorBin
      {selectedClip}
      {selectedCaption} onPatchClip={handlePatchClip} onPatchTrim={handlePatchTrim} onPatchCaption={handlePatchCaption} onAddClip={handleAddClip} onAddCaption={handleAddCaption}
    />
  </div>

  <ReelTimeline clips={project.clips} captions={project.captions} audio={project.audio}
    {playing}
    {totalSec} playheadSec={safePlayhead} selectedClipId={selectedClip?.id ?? null} selectedCaptionId={selectedCaption?.id ?? null} onSeek={(sec) => { playing = false; playheadSec = sec; }} onSelectClip={selectClip} onSelectCaption={(id) => { selectedCaptionId = id; }} onSplitClip={handleSplit} onDuplicateClip={handleDuplicate}
    onReorderClip={(idx, delta) => commit((curr) => ({ ...curr, clips: moveItem(curr.clips, idx, delta) }))} onDeleteClip={handleDeleteClip} onTransitionChange={(id, transition: ClipTransition) => handlePatchClip(id, { transition })} onAddCaptionAtPlayhead={() => handleAddCaption("New caption")} onDeleteCaption={handleDeleteCaption}
    onAudioPatch={(patch: Partial<ReelAudioTrack>) => commit((curr) => ({ ...curr, audio: { ...curr.audio, ...patch } }))}
  />
</section>
