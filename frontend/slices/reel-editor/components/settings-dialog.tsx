"use client";

import { useState } from "react";
import { FormDrawer } from "@/features/appshell";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { type EditorSettings, getSettings, saveSettings } from "../lib/settings";
import { Field } from "./clip-ui";

// Editor preferences: default image clip length + draft auto-save. Saved to
// localStorage immediately on change.
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [s, setS] = useState<EditorSettings>(getSettings);
  const set = (patch: Partial<EditorSettings>) => setS(saveSettings(patch));

  return (
    <FormDrawer open={open} onOpenChange={onOpenChange} size="sm">
      <FormDrawer.Header>
        <FormDrawer.Title>Editor settings</FormDrawer.Title>
      </FormDrawer.Header>

      <FormDrawer.Body className="flex flex-col gap-4">

        <Field label={`Default image duration — ${s.imageDur.toFixed(1)}s`}>
          <Slider min={1} max={10} step={0.5} value={s.imageDur} onChange={(e) => set({ imageDur: Number(e.target.value) })} />
        </Field>

        <Field label="Project media folder">
          <input
            defaultValue={s.projectDir}
            onBlur={(e) => e.target.value.trim() && set({ projectDir: e.target.value.trim() })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            placeholder="~/reel-projects/session"
            className="h-8 rounded-md border border-border bg-secondary px-2 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
        </Field>

        <Field label="Auto-save project draft">
          <Button
            type="button"
            variant="ghost"
            onClick={() => set({ autosave: !s.autosave })}
            className={cn(
              "h-7 rounded-md px-0 text-xs font-medium [@media(pointer:coarse)]:min-h-[44px]",
              s.autosave ? "bg-primary text-primary-foreground hover:bg-primary" : "bg-secondary text-foreground hover:bg-secondary",
            )}
          >
            {s.autosave ? "On — restores after reload" : "Off"}
          </Button>
        </Field>

        <p className="rounded-lg bg-secondary p-2.5 text-[11px] leading-relaxed text-muted-foreground">
          Drafts live in this browser. Uploaded files reference temporary URLs and won’t survive a reload — media from
          the file panel or samples restores fully.
        </p>
      </FormDrawer.Body>
    </FormDrawer>
  );
}
