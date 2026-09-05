"use client";

import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { RATIOS, FRAME_RATES } from "../lib/composition";
import { type Composition } from "../lib/mock-timeline";
import { Field } from "./clip-ui";

const clampDim = (n: number) => Math.max(16, Math.min(4096, Math.round(n)));

// Right panel when no clip is selected: composition format, frame rate, duration.
export function CompProps({
  comp,
  onRatio,
  onFps,
  onDuration,
}: {
  comp: Composition;
  onRatio: (w: number, h: number) => void;
  onFps: (fps: number) => void;
  onDuration: (frames: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Composition</h2>

      <Field label="Format">
        <div className="flex flex-col gap-1.5">
          {RATIOS.map((r) => {
            const on = comp.w === r.w && comp.h === r.h;
            return (
              <Button
                key={r.label}
                type="button"
                variant="ghost"
                onClick={() => onRatio(r.w, r.h)}
                className={cn(
                  "flex h-auto items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-xs font-normal",
                  on ? "bg-primary text-primary-foreground hover:bg-primary" : "bg-secondary text-foreground hover:bg-secondary",
                )}
              >
                <span className="font-semibold">{r.dims}</span>
                <span className="opacity-70">{r.label}</span>
              </Button>
            );
          })}
        </div>
      </Field>

      <Field label="Custom size">
        <div className="flex items-center gap-1.5">
          <NumBox value={comp.w} onCommit={(w) => onRatio(clampDim(w), comp.h)} />
          <span className="text-xs text-muted-foreground">×</span>
          <NumBox value={comp.h} onCommit={(h) => onRatio(comp.w, clampDim(h))} />
          <Button
            type="button"
            variant="ghost"
            title="Swap width / height"
            onClick={() => onRatio(comp.h, comp.w)}
            className="ml-auto flex size-7 items-center justify-center rounded-md border border-border bg-secondary p-0 text-foreground hover:bg-secondary/70"
          >
            <ArrowLeftRight className="size-3.5" />
          </Button>
        </div>
      </Field>

      <Field label={`Duration — ${(comp.duration / comp.fps).toFixed(1)}s`}>
        <Slider min={60} max={900} step={30} value={comp.duration} onChange={(e) => onDuration(Number(e.target.value))} />
      </Field>

      <Field label="Frame rate">
        <div className="flex gap-1">
          {FRAME_RATES.map((f) => (
            <Button
              key={f}
              type="button"
              variant="ghost"
              onClick={() => onFps(f)}
              className={cn(
                "h-6 flex-1 rounded-md px-0 text-xs font-semibold",
                comp.fps === f ? "bg-primary text-primary-foreground hover:bg-primary" : "bg-secondary text-foreground hover:bg-secondary",
              )}
            >
              {f}
            </Button>
          ))}
        </div>
      </Field>

      <p className="rounded-lg bg-secondary p-2.5 text-[11px] leading-relaxed text-muted-foreground">
        Select a clip to keyframe it, press <b>S</b> to split at the playhead, or switch to <b>AI</b> for one-line edits.
      </p>
    </div>
  );
}

// Numeric box that commits on blur/Enter (local draft so typing isn't fought
// by the controlled comp value), feeding arbitrary dimensions back to onRatio.
function NumBox({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  // Local draft keyed to the comp value it edits: a new value (external change)
  // derives back to the mirror — no effect-driven reset (set-state-in-effect).
  const [edit, setEdit] = useState<{ key: number; value: string } | null>(null);
  const draft = edit?.key === value ? edit.value : String(value);
  const setDraft = (v: string) => setEdit({ key: value, value: v });
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n > 0) onCommit(n);
    else setDraft(String(value));
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="h-7 w-16 rounded-md border border-border bg-secondary px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
    />
  );
}
