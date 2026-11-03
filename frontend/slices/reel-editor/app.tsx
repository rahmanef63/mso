"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useHistory } from "./lib/history";
import { useClipDrag } from "./lib/use-clip-drag";
import { useShortcuts } from "./lib/use-shortcuts";
import { moveTrack } from "./lib/composition";
import { useDraftAutosave } from "./lib/use-draft-autosave";
import { useReelActions } from "./lib/use-reel-actions";
import { getFrame, setFrame, subscribeFrame } from "./lib/frame-store";
import { SettingsDialog } from "./components/settings-dialog";
import { MediaCache } from "./lib/media-cache";
import { type PanelMode } from "./components/toolbar";
import { ReelChrome } from "./components/reel-chrome";
import { ReelPanes } from "./components/reel-panes";
import { useLayout } from "./lib/use-layout";
import { type AiMessage } from "./components/ai-panel";
import { RenderOverlay } from "./components/render-overlay";
import { useExport } from "./lib/use-export";
import { useReelInspector } from "./lib/use-reel-inspector";
import { useContainer, useIsMobile } from "./lib/host";
import type { AppProps } from "@/features/appshell";
const HELLO: AiMessage = {
  role: "ai",
  text: "Tell me what to change. Try “make it vertical”, “fade in”, “split here”, “punch in”, or “add title Sale”.",
};
// Reel editor orchestrator: holds playhead/selection/render state, wires the
// history, drag, keyboard, and AI subsystems to the panels.
export default function ReelEditor({ winId }: AppProps) {
  const { comp, apply, undo, redo, canUndo, canRedo } = useHistory();
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<string | null>("c-intro");
  const [zoom, setZoom] = useState(3.2);
  const [mode, setMode] = useState<PanelMode>("editor");
  const [showPanel, setShowPanel] = useState(true);
  const [panelSheet, setPanelSheet] = useState(false);
  // Container-first: compact when the PANE is narrow (mobile shell OR a narrow
  // desktop window), measured off the app root — not the viewport.
  const isMobile = useIsMobile();
  const [paneRef, pane] = useContainer<HTMLDivElement>();
  const compact = isMobile || pane === "xs" || pane === "sm";
  const [aiLog, setAiLog] = useState<AiMessage[]>([HELLO]);
  const [cache] = useState(() => new MediaCache());
  const [monitor, setMonitor] = useState(true);
  const [layout, setLayout] = useLayout();
  const { savedAt, draftError, sessionMedia } = useDraftAutosave(comp, winId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Latest-ref mirror of the external frame-store for drag handlers (read
  // without subscribing → no re-render on tick).
  const frameRef = useRef(getFrame());
  useEffect(() => subscribeFrame(() => { frameRef.current = getFrame(); }), []);
  const selected = useMemo(() => comp.clips.find((c) => c.id === sel) ?? null, [comp.clips, sel]);
  const { dropTrack, begin } = useClipDrag(comp, apply, zoom, frameRef);
  const stopPlay = useCallback(() => setPlaying(false), []);
  const { render, startRender, closeRender } = useExport(comp, cache, stopPlay);
  // Free the cached media elements (and the hidden video host) on close.
  useEffect(() => () => cache.dispose(), [cache]);
  // Drive the monitor (speaker) tap of the shared audio graph.
  useEffect(() => cache.setMonitor(monitor), [cache, monitor]);
  // Playback loop: writes go to the EXTERNAL frame-store, so only the leaf
  // subscribers (preview/transport/timeline-playhead/clip-props) re-render
  // per tick — NOT this whole orchestrator.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const nf = getFrame() + dt * comp.fps;
      setFrame(nf >= comp.duration ? 0 : nf);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, comp.fps, comp.duration]);
  const { ratio, split, del, dup, addMedia, patchSel, patchTrack, newProject, addTrack, select, runAi } =
    useReelActions({ apply, sel, setSel, frameRef, mode, selected, setShowPanel, setAiLog });
  const onKey = useShortcuts({
    hasSel: !!sel,
    onUndo: undo,
    onRedo: redo,
    onSplit: split,
    onDelete: del,
    onTogglePlay: () => setPlaying((p) => !p),
  });
  useReelInspector(comp, selected, startRender);
  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={(el) => {
          rootRef.current = el;
          paneRef.current = el;
        }}
        tabIndex={0}
        onKeyDown={onKey}
        onMouseDown={() => rootRef.current?.focus({ preventScroll: true })}
        className="@container relative flex h-full flex-col bg-background text-foreground outline-none"
      >
        {(draftError || sessionMedia) && (
          <div role="status" className="shrink-0 bg-warning/15 px-3 py-2 text-sm text-foreground">
            {draftError ?? "Uploaded media is available only in this session. Keep the original files to restore the project."}
          </div>
        )}
        <ReelChrome
          comp={comp}
          mode={mode}
          zoom={zoom}
          hasSel={!!sel}
          canUndo={canUndo}
          canRedo={canRedo}
          layout={layout}
          savedAt={savedAt}
          compact={compact}
          addMedia={addMedia}
          ratio={ratio}
          undo={undo}
          redo={redo}
          split={split}
          dup={dup}
          del={del}
          setZoom={setZoom}
          togglePanel={() => (compact ? setPanelSheet(true) : setShowPanel((s) => !s))}
          setMode={setMode}
          setPanelSheet={setPanelSheet}
          setShowPanel={setShowPanel}
          addTrack={addTrack}
          startRender={startRender}
          setLayout={setLayout}
          newProject={newProject}
          openSettings={() => setSettingsOpen(true)}
        />
        <ReelPanes
          comp={comp}
          playing={playing}
          monitor={monitor}
          cache={cache}
          zoom={zoom}
          sel={sel}
          selected={selected}
          mode={mode}
          aiLog={aiLog}
          apply={apply}
          dropTrack={dropTrack}
          layout={layout}
          showPanel={showPanel}
          compact={compact}
          panelSheet={panelSheet}
          setPlaying={setPlaying}
          setMonitor={setMonitor}
          setZoom={setZoom}
          setShowPanel={setShowPanel}
          setPanelSheet={setPanelSheet}
          split={split}
          dup={dup}
          del={del}
          patchSel={patchSel}
          ratio={ratio}
          runAi={runAi}
          select={select}
          begin={begin}
          addTrack={addTrack}
          patchTrack={patchTrack}
          moveTrack={(id, dir) => apply((c) => moveTrack(c, id, dir), true)}
          addMedia={addMedia}
        />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        {render && (
          <RenderOverlay
            pct={render.pct}
            done={render.done}
            duration={comp.duration}
            downloadUrl={render.url}
            onClose={closeRender}
          />
        )}
      </div>
    </TooltipProvider>
  );
}