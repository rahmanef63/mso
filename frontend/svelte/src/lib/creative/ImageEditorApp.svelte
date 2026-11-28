<script lang="ts">
  import "./ImageEditorApp.css";
  import ImageEditorExportModal from "./ImageEditorExportModal.svelte";
  import ImageEditorInspector from "./ImageEditorInspector.svelte";
  import ImageEditorStage from "./ImageEditorStage.svelte";
  import ImageEditorToolbar from "./ImageEditorToolbar.svelte";
  import ImageEditorTopBar from "./ImageEditorTopBar.svelte";
  import { createImageEditorActions } from "./image-editor-controller.svelte.ts";
  import { ImageEditorSession } from "./image-editor-session.svelte.ts";

  let { initialPath = "" }: { initialPath?: string } = $props();
  const s = new ImageEditorSession();
  const ed = createImageEditorActions(s);

  let lastInitial = "";
  $effect(() => {
    const next = initialPath.trim();
    if (next && next !== lastInitial) {
      lastInitial = next;
      void ed.openPath(next);
    }
  });

  $effect(() => {
    const onKey = (event: KeyboardEvent) => ed.handleKey(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
</script>

<section class="image-editor-root" aria-labelledby="image-editor-title" data-image-loaded={s.hasImage ? "true" : "false"}>
  <div class="top-slot">
    <ImageEditorTopBar
      bind:pathInput={s.pathInput}
      docWidth={s.doc.width}
      docHeight={s.doc.height}
      rotateDeg={s.doc.transform.rotateDeg}
      canUndo={s.canUndo}
      canRedo={s.canRedo}
      zoomMode={s.zoomMode}
      inspectorOpen={s.inspectorOpen}
      onLoadPath={(path) => void ed.openPath(path)}
      onNewBlank={(w, h) => ed.newBlank(w, h)}
      onUndo={() => ed.undo()}
      onRedo={() => ed.redo()}
      onZoomChange={(mode) => s.setZoom(mode)}
      onOpenExport={() => s.openExport()}
      onToggleInspector={() => s.toggleInspector()}
    />
  </div>

  {#if s.notice}
    <p class="feedback {s.notice.tone}" role={s.notice.tone === "error" ? "alert" : "status"}>{s.notice.text}</p>
  {/if}

  <div class="rail-slot">
    <ImageEditorToolbar
      activeTool={s.activeTool}
      flipH={s.doc.transform.flipH}
      flipV={s.doc.transform.flipV}
      cropAspect={s.cropAspect}
      bind:toolOptions={s.toolOptions}
      onSelectTool={(tool) => ed.selectTool(tool)}
      onRotate={() => ed.rotateRight()}
      onFlipH={() => ed.flipH()}
      onFlipV={() => ed.flipV()}
      onCropAspectChange={(aspect) => ed.changeCropAspect(aspect)}
      onApplyCrop={() => ed.applyCrop()}
      onCancelCrop={() => ed.cancelCrop()}
      onAddText={() => ed.placeTextCenter()}
    />
  </div>

  <div class="stage-slot">
    <ImageEditorStage
      doc={s.doc}
      imageMap={s.imageMap}
      activeTool={s.activeTool}
      selectedLayerId={s.selectedLayerId}
      zoomMode={s.zoomMode}
      bind:cropRect={s.cropRect}
      cropAspect={s.cropAspect}
      toolOptions={s.toolOptions}
      onSelectLayer={(id) => s.selectLayer(id)}
      onCommitStroke={(stroke) => ed.commitStroke(stroke)}
      onMoveLayer={(id, dx, dy) => ed.moveLayer(id, dx, dy)}
      onBeginMove={(id) => ed.beginMove(id)}
      onCommitMove={(moved) => ed.commitMove(moved)}
      onCommitShape={(shape) => ed.commitShape(shape)}
      onPlaceTextAt={(pt) => ed.placeTextAt(pt)}
      onApplyCrop={() => ed.applyCrop()}
      onCancelCrop={() => ed.cancelCrop()}
    />
  </div>

  {#if s.inspectorOpen}
    <div class="inspector-slot">
      <ImageEditorInspector
        bind:activeTab={s.inspectorTab}
        adjustments={s.doc.adjustments}
        activeFilter={s.doc.activeFilter}
        layers={s.doc.layers}
        selectedLayerId={s.selectedLayerId}
        onPatchAdjustment={(key, value) => ed.patchAdj(key, value)}
        onCommitAdjustment={() => ed.commitAdj()}
        onResetAdjustments={() => ed.resetAdjustments()}
        onApplyPreset={(id) => ed.applyPreset(id)}
        onSelectLayer={(id) => s.selectLayer(id)}
        onAddDrawingLayer={() => ed.addLayer()}
        onToggleVisibility={(id) => ed.toggleVisibility(id)}
        onOpacityChange={(id, opacity) => ed.changeOpacity(id, opacity)}
        onOpacityCommit={() => ed.commitAdj()}
        onMoveUp={(id) => ed.moveUp(id)}
        onMoveDown={(id) => ed.moveDown(id)}
        onDuplicate={(id) => ed.duplicate(id)}
        onDelete={(id) => ed.deleteLayer(id)}
      />
    </div>
  {/if}

  <ImageEditorExportModal
    open={s.exportOpen}
    outputWidth={s.doc.width}
    outputHeight={s.doc.height}
    defaultVpsPath=""
    savingVps={s.savingVps}
    onClose={() => s.closeExport()}
    onDownload={(format, quality) => ed.downloadExport(format, quality)}
    onSaveToVps={(path, format, quality) => void ed.saveVps(path, format, quality)}
  />
</section>
