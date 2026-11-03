"use client";

import { useRef, useState, type ReactNode } from "react";
import { Bot, Layers, Sparkles, SlidersHorizontal, Settings2, Download } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/features/image-editor/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TopBar } from "./top-bar";
import { ToolRail } from "./tool-rail";
import { ToolOptionsBar } from "./tool-options-bar";
import { LayersPanel } from "./panels/layers-panel";
import { LayerStylesPanel } from "./panels/layer-styles-panel";
import { AdjustPanel } from "./panels/adjust-panel";
import { PropertiesPanel } from "./panels/properties-panel";
import { ExportPanel } from "./panels/export-panel";
import { AiPanel } from "./panels/ai-panel";

// A labeled bottom-sheet tab (icon + short text) — discoverable on touch.
function Tab({ value, icon: Icon, label }: { value: string; icon: typeof Bot; label: string }) {
  return (
    <TabsTrigger value={value} className="flex flex-col items-center gap-0.5 rounded-none border-b-2 border-transparent py-1.5 text-[11px] text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-accent data-[state=active]:text-foreground">
      <Icon className="size-4" />
      {label}
    </TabsTrigger>
  );
}

// Compact layout (phone OR a narrow pane/window): the canvas stays LIVE in the
// top half while edits happen in a bottom sheet (~half height, drag the grip to
// resize 25–80% of the PANE — container-relative, not viewport) — so every
// slider tweak previews instantly above. Tools are a horizontal rail above the
// sheet. The sheet opens to LAYERS (familiar), not the AI assistant (last tab).
export function MobileShell({ stage, onSave, onSaveAs }: { stage: ReactNode; onSave?: (d: string) => void; onSaveAs?: (d: string) => void }) {
  const [sheetPct, setSheetPct] = useState(48);
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);

  const onGripDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: sheetPct };
  };
  const onGripMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const paneH = rootRef.current?.clientHeight || 1;
    const dPct = ((drag.current.y - e.clientY) / paneH) * 100;
    setSheetPct(Math.min(80, Math.max(25, drag.current.h + dPct)));
  };
  const onGripUp = () => (drag.current = null);

  return (
    <div ref={rootRef} className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <TopBar onSave={onSave} onSaveAs={onSaveAs} />
      <ToolOptionsBar />
      <div className="relative min-h-0 flex-1">{stage}</div>
      <ToolRail orientation="horizontal" />
      <div className="flex shrink-0 flex-col border-t border-border bg-card" style={{ height: `${sheetPct}%` }}>
        <div
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          onLostPointerCapture={onGripUp}
          role="separator" tabIndex={0} aria-orientation="horizontal"
          aria-valuemin={25} aria-valuemax={80} aria-valuenow={Math.round(sheetPct)}
          onKeyDown={(e) => { const delta = e.key === "ArrowUp" ? 2 : e.key === "ArrowDown" ? -2 : e.key === "PageUp" ? 10 : e.key === "PageDown" ? -10 : 0; if (delta || e.key === "Home" || e.key === "End") { e.preventDefault(); setSheetPct((v) => e.key === "Home" ? 25 : e.key === "End" ? 80 : Math.min(80, Math.max(25, v + delta))); } }}
          className="flex h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary shrink-0 cursor-row-resize touch-none items-center justify-center"
          aria-label="Resize panel"
        >
          <div className="h-1 w-10 rounded-full bg-muted-foreground/40" />
        </div>
        <Tabs defaultValue="layers" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="grid w-full shrink-0 grid-cols-6 rounded-none border-b border-border bg-transparent p-0">
            <Tab value="layers" icon={Layers} label="Layers" />
            <Tab value="props" icon={Settings2} label="Props" />
            <Tab value="adjust" icon={SlidersHorizontal} label="Adjust" />
            <Tab value="style" icon={Sparkles} label="Effects" />
            <Tab value="export" icon={Download} label="Export" />
            <Tab value="ai" icon={Bot} label="AI" />
          </TabsList>
          {/* AI + Layers manage their own scroll; the others share a ScrollArea. */}
          <TabsContent value="layers" className="m-0 min-h-0 flex-1 overflow-hidden"><LayersPanel /></TabsContent>
          <TabsContent value="props" className="m-0 min-h-0 flex-1 overflow-hidden"><ScrollArea className="h-full [padding-bottom:var(--sai-bottom,0px)]"><PropertiesPanel /></ScrollArea></TabsContent>
          <TabsContent value="adjust" className="m-0 min-h-0 flex-1 overflow-hidden"><ScrollArea className="h-full [padding-bottom:var(--sai-bottom,0px)]"><AdjustPanel /></ScrollArea></TabsContent>
          <TabsContent value="style" className="m-0 min-h-0 flex-1 overflow-hidden"><ScrollArea className="h-full [padding-bottom:var(--sai-bottom,0px)]"><LayerStylesPanel /></ScrollArea></TabsContent>
          <TabsContent value="export" className="m-0 min-h-0 flex-1 overflow-hidden"><ScrollArea className="h-full [padding-bottom:var(--sai-bottom,0px)]"><ExportPanel /></ScrollArea></TabsContent>
          <TabsContent value="ai" className="m-0 min-h-0 flex-1 overflow-hidden"><AiPanel /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
