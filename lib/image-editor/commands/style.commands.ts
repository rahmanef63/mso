import { BLEND_MODES } from "../lib/types";
import type { EditorCommand } from "./types";
import { bool, num, obj, resolveLayer, str, targetProps } from "./schema";

// Photoshop "Blending Options": blend mode, clipping mask, drop shadow, outer
// glow, stroke. Each effect has an `enabled` toggle + parameters.
export const styleCommands: EditorCommand[] = [
  {
    name: "style.blend",
    description: "Set a layer's blend mode and/or clipping-mask flag.",
    parameters: obj({
      blend: str("Blend mode", { enum: BLEND_MODES }),
      clipBelow: bool("Clip to the layer below (clipping mask)"),
      ...targetProps,
    }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      const patch: Record<string, unknown> = {};
      if (a.blend !== undefined) patch.blend = a.blend;
      if (a.clipBelow !== undefined) patch.clipBelow = Boolean(a.clipBelow);
      ctx.patchStyle(l.id, patch);
      return `style of "${l.name}": ${Object.keys(patch).join(", ")}`;
    },
  },
  {
    name: "style.shadow",
    description: "Drop shadow. angle: 0=→,90=↓. distance/size in px, opacity 0..1.",
    parameters: obj({
      "enabled!": bool("Turn shadow on/off"),
      color: str("Shadow color hex"),
      opacity: num("0..1", { min: 0, max: 1 }),
      angle: num("0..360 degrees", { min: 0, max: 360 }),
      distance: num("Offset px"),
      size: num("Blur radius px"),
      ...targetProps,
    }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      const patch: Record<string, unknown> = { enabled: Boolean(a.enabled) };
      for (const k of ["color", "opacity", "angle", "distance", "size"]) if (a[k] !== undefined) patch[k] = a[k];
      ctx.patchShadow(l.id, patch);
      return `shadow ${a.enabled ? "on" : "off"} for "${l.name}"`;
    },
  },
  {
    name: "style.glow",
    description: "Outer glow around a layer.",
    parameters: obj({
      "enabled!": bool("Turn glow on/off"),
      color: str("Glow color hex"),
      opacity: num("0..1", { min: 0, max: 1 }),
      size: num("Blur radius px"),
      ...targetProps,
    }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      const patch: Record<string, unknown> = { enabled: Boolean(a.enabled) };
      for (const k of ["color", "opacity", "size"]) if (a[k] !== undefined) patch[k] = a[k];
      ctx.patchGlow(l.id, patch);
      return `glow ${a.enabled ? "on" : "off"} for "${l.name}"`;
    },
  },
  {
    name: "style.stroke",
    description: "Outline stroke around a layer.",
    parameters: obj({
      "enabled!": bool("Turn stroke on/off"),
      color: str("Stroke color hex"),
      width: num("Stroke width px"),
      ...targetProps,
    }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      const patch: Record<string, unknown> = { enabled: Boolean(a.enabled) };
      for (const k of ["color", "width"]) if (a[k] !== undefined) patch[k] = a[k];
      ctx.patchStroke(l.id, patch);
      return `stroke ${a.enabled ? "on" : "off"} for "${l.name}"`;
    },
  },
];
