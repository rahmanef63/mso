"use client";

import { AlignCenter, FlipHorizontal, FlipVertical, RotateCcw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/features/image-editor/ui/slider";
import { useEditor } from "../../lib/store";
import type { Layer } from "../../lib/types";
import { TextProps } from "./text-props";
import { ShapeProps } from "./shape-props";
import { CanvasSection } from "./canvas-section";

const num = (v: string) => Number(v) || 0;
const KIND: Record<Layer["kind"], string> = { image: "Image", text: "Text", shape: "Shape", paint: "Pixel", adjustment: "Adjustment" };

// Photoshop-style DYNAMIC Properties: document props when nothing is selected,
// else the SELECTED layer's TYPE-SPECIFIC controls (text → font/size/fill, shape
// → fill + stroke, pixel → brush, …) plus the common transform block. The side
// panel wraps this in its own ScrollArea, so this is a plain column.
export function PropertiesPanel() {
  const { selected, update } = useEditor();
  if (!selected) {
    return (
      <div className="flex flex-col gap-4 p-3 text-sm">
        <CanvasSection />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 p-3 text-sm">
      <div className="flex items-center gap-2">
        <Settings2 className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{selected.name}</span>
        <span className="ml-auto shrink-0 rounded bg-muted px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {KIND[selected.kind]}
        </span>
      </div>

      {selected.kind === "text" && <TextProps selected={selected} update={update} />}
      {selected.kind === "shape" && (
        <>
          <ShapeProps selected={selected} update={update} />
          <StrokeBlock selected={selected} />
        </>
      )}
      {selected.kind === "paint" && <BrushBlock />}
      {selected.kind === "adjustment" && (
        <Note>Adjustment layer: tune its sliders in the <b>Adjust</b> tab; it filters every layer below it.</Note>
      )}
      {selected.kind === "image" && (
        <Note>Image layer: colour in the <b>Adjust</b> tab, effects in <b>Style</b>. Geometry below.</Note>
      )}

      <Separator />
      <TransformBlock selected={selected} update={update} />
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-accent/50 px-2 py-1.5 text-[11px] text-muted-foreground">{children}</p>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function TransformBlock({ selected, update }: { selected: Layer; update: (id: string, p: Partial<Layer>) => void }) {
  const { doc } = useEditor();
  const t = selected.t;
  const set = (p: Partial<Layer["t"]>) => update(selected.id, { t: { ...t, ...p } });
  // Best-effort layer extent for centering (paint = full canvas; others = their box).
  const lw = selected.kind === "paint" ? doc.width : t.width || 0;
  const lh = selected.kind === "paint" ? doc.height : t.height || 0;
  const center = () => set({ x: Math.round((doc.width - lw) / 2), y: Math.round((doc.height - lh) / 2) });
  const reset = () => set({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  return (
    <section className="flex flex-col gap-3">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transform</Label>
      <div className="grid grid-cols-2 gap-2">
        <Field label="X"><Input type="number" value={Math.round(t.x)} onChange={(e) => set({ x: num(e.target.value) })} /></Field>
        <Field label="Y"><Input type="number" value={Math.round(t.y)} onChange={(e) => set({ y: num(e.target.value) })} /></Field>
      </div>
      <Field label={`Rotation ${Math.round(t.rotation)}°`}><Slider min={0} max={360} value={[t.rotation]} onValueChange={([v]) => set({ rotation: v })} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Scale X %"><Input type="number" value={Math.round(t.scaleX * 100)} onChange={(e) => set({ scaleX: num(e.target.value) / 100 })} /></Field>
        <Field label="Scale Y %"><Input type="number" value={Math.round(t.scaleY * 100)} onChange={(e) => set({ scaleY: num(e.target.value) / 100 })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" onClick={() => set({ scaleX: -t.scaleX })}><FlipHorizontal className="size-4" /> Flip H</Button>
        <Button variant="outline" size="sm" onClick={() => set({ scaleY: -t.scaleY })}><FlipVertical className="size-4" /> Flip V</Button>
        <Button variant="outline" size="sm" onClick={center}><AlignCenter className="size-4" /> Center</Button>
        <Button variant="outline" size="sm" onClick={reset}><RotateCcw className="size-4" /> Reset</Button>
      </div>
    </section>
  );
}

function StrokeBlock({ selected }: { selected: Layer }) {
  const { patchStroke } = useEditor();
  const s = selected.style.stroke;
  return (
    <>
      <Separator />
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Stroke</Label>
        <Switch checked={s.enabled} onCheckedChange={(enabled) => patchStroke(selected.id, { enabled })} />
      </div>
      {s.enabled && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Color"><Input type="color" value={s.color} onChange={(e) => patchStroke(selected.id, { color: e.target.value })} /></Field>
          <Field label={`Width ${s.width}`}><Slider min={0} max={40} value={[s.width]} onValueChange={([v]) => patchStroke(selected.id, { width: v })} /></Field>
        </div>
      )}
    </>
  );
}

function BrushBlock() {
  const { brush, setBrush, fg, setFg } = useEditor();
  return (
    <section className="flex flex-col gap-3">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Brush</Label>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Color"><Input type="color" value={fg} onChange={(e) => setFg(e.target.value)} /></Field>
        <Field label={`Size ${brush.size}`}><Slider min={1} max={200} value={[brush.size]} onValueChange={([v]) => setBrush({ size: v })} /></Field>
      </div>
      <Field label={`Opacity ${Math.round(brush.opacity * 100)}%`}><Slider min={5} max={100} value={[Math.round(brush.opacity * 100)]} onValueChange={([v]) => setBrush({ opacity: v / 100 })} /></Field>
      <Field label={`Hardness ${Math.round(brush.hardness * 100)}%`}><Slider min={0} max={100} value={[Math.round(brush.hardness * 100)]} onValueChange={([v]) => setBrush({ hardness: v / 100 })} /></Field>
      <p className="text-[11px] text-muted-foreground">Pick the Brush tool, then paint on this layer.</p>
    </section>
  );
}
