"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { type Clip, type Composition } from "../lib/mock-timeline";
import { Field, Header } from "./clip-ui";

// Audio tab: level, per-clip mute, fades, and auto-duck under other audio.
export function ClipTabAudio({
  clip,
  comp,
  onChange,
}: {
  clip: Clip;
  comp: Composition;
  onChange: (patch: Partial<Clip>) => void;
}) {
  return (
    <>
      <Header
        right={
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange({ mute: !clip.mute })}
            className={cn(
              "h-5 rounded px-2 text-[10px] font-bold uppercase",
              clip.mute ? "bg-destructive/15 text-destructive hover:bg-destructive/15 hover:text-destructive" : "bg-secondary text-muted-foreground hover:bg-secondary hover:text-muted-foreground",
            )}
          >
            {clip.mute ? "Muted" : "Mute"}
          </Button>
        }
      >
        Audio
      </Header>
      <Field label={`Volume: ${Math.round((clip.mute ? 0 : clip.vol ?? 1) * 100)}%`}>
        <Slider
          min={0}
          max={100}
          disabled={clip.mute}
          value={Math.round((clip.vol ?? 1) * 100)}
          onChange={(e) => onChange({ vol: Number(e.target.value) / 100 })}
        />
      </Field>
      <Field label={`Fade in: ${((clip.fadeIn ?? 0) / comp.fps).toFixed(2)}s`}>
        <Slider min={0} max={clip.len} value={clip.fadeIn ?? 0} onChange={(e) => onChange({ fadeIn: Number(e.target.value) })} />
      </Field>
      <Field label={`Fade out: ${((clip.fadeOut ?? 0) / comp.fps).toFixed(2)}s`}>
        <Slider min={0} max={clip.len} value={clip.fadeOut ?? 0} onChange={(e) => onChange({ fadeOut: Number(e.target.value) })} />
      </Field>
      <Button
        type="button"
        variant="ghost"
        onClick={() => onChange({ duck: !clip.duck })}
        className={cn(
          "h-6 rounded-md px-0 text-xs font-medium",
          clip.duck ? "bg-primary text-primary-foreground hover:bg-primary" : "bg-secondary text-foreground hover:bg-secondary",
        )}
      >
        {clip.duck ? "Auto-duck: on" : "Auto-duck under other audio"}
      </Button>
      {clip.duck && (
        <Field label={`Duck to ${Math.round((clip.duckAmount ?? 0.28) * 100)}%`}>
          <Slider
            min={0}
            max={100}
            value={Math.round((clip.duckAmount ?? 0.28) * 100)}
            onChange={(e) => onChange({ duckAmount: Number(e.target.value) / 100 })}
          />
        </Field>
      )}
    </>
  );
}
