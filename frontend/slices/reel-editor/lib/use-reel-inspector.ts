"use client";

import type { Clip, Composition } from "./mock-timeline";
import { usePublishInspector } from "./host";

// Surface composition state + Render action to the shell AI Inspector.
export function useReelInspector(comp: Composition, selected: Clip | null, startRender: () => void) {
  const aspect = comp.w >= comp.h ? "landscape" : "vertical";
  usePublishInspector(
    "reel-editor",
    {
      subject: `Reel ${comp.w}x${comp.h}`,
      props: [
        { label: "Resolution", value: `${comp.w}x${comp.h} (${aspect})` },
        { label: "FPS", value: String(comp.fps) },
        { label: "Duration", value: `${comp.duration} frames` },
        { label: "Clips", value: String(comp.clips.length) },
        { label: "Selected", value: selected?.name ?? "None" },
      ],
      actions: [{ id: "render", label: "Render", run: () => void startRender() }],
      context: `Reel editor: ${comp.w}x${comp.h} @ ${comp.fps}fps, ${comp.clips.length} clips`,
      suggestions: ["Make it vertical", "Suggest a hook", "Add a title"],
    },
    [comp.w, comp.h, comp.fps, comp.duration, comp.clips.length, selected?.name, startRender],
  );
}
