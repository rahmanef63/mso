"use client";

import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Clip, type Composition, type XfadeDir, fmtFrame } from "../lib/mock-timeline";
import { clampTrim } from "../lib/composition";
import { BtnRow, Field, Header } from "./clip-ui";

const DIRS: { v: XfadeDir; label: string }[] = [
  { v: "left", label: "←" },
  { v: "right", label: "→" },
  { v: "up", label: "↑" },
  { v: "down", label: "↓" },
];

// Clip tab: identity (name), timing (start/trim/duration), speed/reverse, and
// transition (crossfade over the previous clip on the same track).
export function ClipTabClip({
  clip,
  comp,
  onChange,
  onSeek,
  onCrossfade,
  onSpeed,
}: {
  clip: Clip;
  comp: Composition;
  onChange: (patch: Partial<Clip>) => void;
  onSeek: (frame: number) => void;
  onCrossfade: (frames: number) => void;
  onSpeed: (speed: number) => void;
}) {
  const trimDur = clip.media && clip.media.type !== "image" ? clip.media.dur : undefined;
  const speed = clip.speed ?? 1;
  const inSec = clip.srcIn ?? 0;
  const outSec = inSec + (clip.len / comp.fps) * speed;
  const prev = comp.clips
    .filter((x) => x.track === clip.track && x.id !== clip.id && x.start < clip.start)
    .sort((a, b) => b.start - a.start)[0];
  const canXfade = clip.kind !== "audio" && !!prev;
  const maxXfade = prev ? Math.max(0, Math.min(prev.len - 1, clip.len - 1)) : 0;
  const xfade = clip.xfade ?? 0;

  return (
    <>
      <Field label="Name">
        <Input value={clip.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      <Field label={`Start: ${fmtFrame(clip.start, comp.fps)}`}>
        <Slider
          min={0}
          max={comp.duration - 1}
          value={clip.start}
          onChange={(e) => {
            onChange({ start: Number(e.target.value) });
            onSeek(Number(e.target.value));
          }}
        />
      </Field>
      {trimDur != null ? (
        <>
          <Header
            right={
              <span className="font-mono text-[10px] text-muted-foreground">
                {(clip.len / comp.fps).toFixed(2)}s of {trimDur.toFixed(2)}s
              </span>
            }
          >
            Trim
          </Header>
          <Field label={`In: ${inSec.toFixed(2)}s`}>
            <Slider
              min={0}
              max={trimDur}
              step={0.05}
              value={inSec}
              onChange={(e) =>
                onChange(clampTrim(trimDur, comp.fps, Number(e.target.value), Math.round(((outSec - Number(e.target.value)) * comp.fps) / speed), speed))
              }
            />
          </Field>
          <Field label={`Out: ${outSec.toFixed(2)}s`}>
            <Slider
              min={0}
              max={trimDur}
              step={0.05}
              value={outSec}
              onChange={(e) =>
                onChange({ len: clampTrim(trimDur, comp.fps, inSec, Math.round(((Number(e.target.value) - inSec) * comp.fps) / speed), speed).len })
              }
            />
          </Field>
        </>
      ) : (
        <Field label={`Duration: ${(clip.len / comp.fps).toFixed(2)}s`}>
          <Slider min={6} max={comp.duration} value={clip.len} onChange={(e) => onChange({ len: Number(e.target.value) })} />
        </Field>
      )}

      {clip.media && clip.media.type !== "image" && (
        <>
          <Header
            right={
              <span className={cn("font-mono text-[10px]", speed !== 1 || clip.reverse ? "text-primary" : "text-muted-foreground")}>
                {speed.toFixed(2)}×{clip.reverse ? " reversed" : ""}
              </span>
            }
          >
            Speed
          </Header>
          <Slider min={0.25} max={4} step={0.25} value={speed} onChange={(e) => onSpeed(Number(e.target.value))} />
          {clip.media.type === "video" && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => onChange({ reverse: !clip.reverse })}
              className={cn(
                "h-6 rounded-md px-0 text-xs font-medium",
                clip.reverse ? "bg-primary text-primary-foreground hover:bg-primary" : "bg-secondary text-foreground hover:bg-secondary",
              )}
            >
              {clip.reverse ? "Reverse: on" : "Reverse"}
            </Button>
          )}
        </>
      )}

      {canXfade && (
        <>
          <Header
            right={
              <span className={cn("font-mono text-[10px]", xfade > 0 ? "text-primary" : "text-muted-foreground")}>
                {xfade > 0 ? `${clip.xtype ?? "dissolve"} ${(xfade / comp.fps).toFixed(2)}s` : "cut"}
              </span>
            }
          >
            Transition
          </Header>
          <Field label={`Duration over “${prev!.name}”`}>
            <Slider min={0} max={maxXfade} value={xfade} onChange={(e) => onCrossfade(Number(e.target.value))} />
          </Field>
          {xfade > 0 && (
            <Field label="Style">
              <BtnRow
                options={(["dissolve", "wipe", "slide"] as const).map((t) => ({ v: t, label: t }))}
                value={clip.xtype ?? "dissolve"}
                onPick={(t) => onChange({ xtype: t })}
              />
            </Field>
          )}
          {xfade > 0 && (clip.xtype === "wipe" || clip.xtype === "slide") && (
            <Field label="Direction">
              <BtnRow
                options={DIRS.map((d) => ({ v: d.v, label: d.label }))}
                value={clip.xdir ?? (clip.xtype === "wipe" ? "left" : "right")}
                onPick={(v) => onChange({ xdir: v })}
              />
            </Field>
          )}
        </>
      )}
    </>
  );
}
