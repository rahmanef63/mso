"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/features/image-editor/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ADJ_DEFAULT } from "../../lib/model";
import { useEditor } from "../../lib/store";
import type { Adjustments } from "../../lib/types";

type SliderRowProps = {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
};

function SliderRow({ label, value, display, min, max, step, onChange }: SliderRowProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <span className="text-xs text-muted-foreground tabular-nums">{display}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}

type ToggleRowProps = {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
};

function ToggleRow({ label, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function AdjustPanel() {
  const { selected, patchAdj } = useEditor();

  if (!selected) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Select a layer</p>
      </div>
    );
  }

  const id = selected.id;
  const adj = selected.adj;
  const patch = (p: Partial<Adjustments>) => patchAdj(id, p);

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Adjustments
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => patch(ADJ_DEFAULT)}
            className={cn("gap-1.5")}
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        </div>

        {selected.kind === "adjustment" && (
          <p className="rounded-md bg-accent/50 px-2 py-1 text-[11px] text-muted-foreground">
            Adjustment layer: affects every layer below it.
          </p>
        )}

        <Separator />

        <div className="space-y-4">
          <SliderRow
            label="Brightness"
            value={adj.brightness}
            display={adj.brightness.toFixed(2)}
            min={-1}
            max={1}
            step={0.01}
            onChange={(brightness) => patch({ brightness })}
          />
          <SliderRow
            label="Contrast"
            value={adj.contrast}
            display={`${Math.round(adj.contrast)}`}
            min={-100}
            max={100}
            step={1}
            onChange={(contrast) => patch({ contrast })}
          />
          <SliderRow
            label="Saturation"
            value={adj.saturation}
            display={adj.saturation.toFixed(1)}
            min={-2}
            max={10}
            step={0.1}
            onChange={(saturation) => patch({ saturation })}
          />
          <SliderRow
            label="Hue"
            value={adj.hue}
            display={`${Math.round(adj.hue)}°`}
            min={0}
            max={360}
            step={1}
            onChange={(hue) => patch({ hue })}
          />
          <SliderRow
            label="Blur"
            value={adj.blur}
            display={`${Math.round(adj.blur)}`}
            min={0}
            max={40}
            step={1}
            onChange={(blur) => patch({ blur })}
          />
        </div>

        <Separator />

        <div className="space-y-3">
          <ToggleRow
            label="Grayscale"
            checked={adj.grayscale}
            onChange={(grayscale) => patch({ grayscale })}
          />
          <ToggleRow
            label="Invert"
            checked={adj.invert}
            onChange={(invert) => patch({ invert })}
          />
          <ToggleRow
            label="Sepia"
            checked={adj.sepia}
            onChange={(sepia) => patch({ sepia })}
          />
        </div>
      </div>
    </ScrollArea>
  );
}
