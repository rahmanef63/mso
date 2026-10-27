"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { type Clip, type TextAnim, type TextFont, type TextStyle } from "../lib/mock-timeline";
import { TEXT_PRESETS } from "../lib/draw-text";
import { BtnRow, Field, Header } from "./clip-ui";

const ANIMS: TextAnim[] = ["rise", "pop", "fade"];
const FONTS: { v: TextFont; label: string; css: string }[] = [
  { v: "sans", label: "Sans", css: "system-ui, sans-serif" },
  { v: "serif", label: "Serif", css: "Georgia, serif" },
  { v: "mono", label: "Mono", css: "ui-monospace, monospace" },
  { v: "display", label: "Bold", css: "'Arial Black', Impact, sans-serif" },
  { v: "hand", label: "Hand", css: "'Comic Sans MS', cursive" },
];

// Text tab: content, entrance, style presets, font / size / colors / box.
export function ClipTabText({ clip, onChange }: { clip: Clip; onChange: (patch: Partial<Clip>) => void }) {
  const ts = clip.tstyle ?? {};
  const set = (patch: Partial<TextStyle>) => onChange({ tstyle: { ...ts, ...patch } });

  return (
    <>
      <Header>Text</Header>
      <Field label="Content">
        <Input value={clip.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} />
      </Field>
      <Field label="Entrance">
        <BtnRow options={ANIMS.map((a) => ({ v: a, label: a }))} value={clip.anim ?? "rise"} onPick={(a) => onChange({ anim: a })} />
      </Field>

      <Field label="Style presets">
        <div className="grid grid-cols-5 gap-1">
          {TEXT_PRESETS.map((p) => (
            <Button
              key={p.id}
              type="button"
              variant="ghost"
              title={p.id}
              onClick={() => onChange({ tstyle: { ...p.style } })}
              className="grid h-9 w-auto min-w-0 place-items-center rounded-md border border-border bg-black/60 p-0 text-sm font-extrabold"
              style={{
                color: p.style.color ?? "#fff",
                fontFamily: FONTS.find((f) => f.v === (p.style.font ?? "sans"))?.css,
                WebkitTextStroke: p.style.stroke ? `1px ${p.style.stroke}` : undefined,
                textShadow: p.style.shadow === false ? undefined : "0 1px 3px rgba(0,0,0,.6)",
                background: p.style.bg ?? "rgba(0,0,0,0.6)",
              }}
            >
              Aa
            </Button>
          ))}
        </div>
      </Field>

      <Field label="Font">
        <BtnRow options={FONTS.map((f) => ({ v: f.v, label: <span style={{ fontFamily: f.css }}>{f.label}</span> }))} value={ts.font ?? "sans"} onPick={(font) => set({ font })} />
      </Field>
      <Field label={`Size: ${Math.round((ts.size ?? 1) * 100)}%`}>
        <Slider min={50} max={200} value={Math.round((ts.size ?? 1) * 100)} onChange={(e) => set({ size: Number(e.target.value) / 100 })} />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Color">
          <input type="color" value={ts.color ?? "#ffffff"} onChange={(e) => set({ color: e.target.value })} className="h-7 w-full cursor-pointer rounded-md border border-border bg-secondary" />
        </Field>
        <Field label="Stroke">
          <div className="flex items-center gap-1.5">
            <input type="color" value={ts.stroke ?? "#000000"} onChange={(e) => set({ stroke: e.target.value, strokeW: ts.strokeW ?? 0.08 })} className="h-7 w-9 cursor-pointer rounded-md border border-border bg-secondary" />
            <Button
              type="button"
              variant="ghost"
              onClick={() => set({ stroke: ts.stroke ? undefined : "#000000", strokeW: 0.08 })}
              className={cn("h-7 flex-1 rounded-md px-0 text-[11px] font-normal", ts.stroke ? "bg-primary text-primary-foreground hover:bg-primary" : "bg-secondary text-foreground hover:bg-secondary")}
            >
              {ts.stroke ? "On" : "Off"}
            </Button>
          </div>
        </Field>
      </div>
      {ts.stroke && (
        <Field label={`Stroke width: ${Math.round((ts.strokeW ?? 0.08) * 100)}`}>
          <Slider min={2} max={20} value={Math.round((ts.strokeW ?? 0.08) * 100)} onChange={(e) => set({ strokeW: Number(e.target.value) / 100 })} />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label="Background">
          <div className="flex items-center gap-1.5">
            <input type="color" value={toHex(ts.bg) ?? "#000000"} onChange={(e) => set({ bg: e.target.value, shadow: false })} className="h-7 w-9 cursor-pointer rounded-md border border-border bg-secondary" />
            <Button
              type="button"
              variant="ghost"
              onClick={() => set({ bg: ts.bg ? undefined : "rgba(0,0,0,0.72)", shadow: ts.bg ? ts.shadow : false })}
              className={cn("h-7 flex-1 rounded-md px-0 text-[11px] font-normal", ts.bg ? "bg-primary text-primary-foreground hover:bg-primary" : "bg-secondary text-foreground hover:bg-secondary")}
            >
              {ts.bg ? "On" : "Off"}
            </Button>
          </div>
        </Field>
        <Field label="Shadow">
          <Button
            type="button"
            variant="ghost"
            onClick={() => set({ shadow: ts.shadow === false ? true : false })}
            className={cn("h-7 rounded-md px-0 text-[11px] font-normal", ts.shadow !== false ? "bg-primary text-primary-foreground hover:bg-primary" : "bg-secondary text-foreground hover:bg-secondary")}
          >
            {ts.shadow !== false ? "On" : "Off"}
          </Button>
        </Field>
      </div>
    </>
  );
}

// <input type="color"> only accepts #rrggbb — map rgba presets to a hex guess.
function toHex(c?: string): string | null {
  if (!c) return null;
  if (c.startsWith("#")) return c.slice(0, 7);
  const m = c.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
}
