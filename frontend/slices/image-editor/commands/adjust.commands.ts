import { createLayer } from "../lib/model";
import type { Adjustments } from "../lib/types";
import type { EditorCommand } from "./types";
import { bool, num, obj, resolveLayer, str, targetProps } from "./schema";

const ADJ_KEYS: (keyof Adjustments)[] = [
  "brightness", "contrast", "saturation", "hue", "blur", "grayscale", "invert", "sepia",
];

// Non-destructive per-layer adjustments (brightness/contrast/HSL/blur + toggles).
export const adjustCommands: EditorCommand[] = [
  {
    name: "adjust.set",
    description:
      "Set non-destructive adjustments on a layer. Any omitted field is left unchanged. Ranges: brightness -1..1, contrast -100..100, saturation -2..10, hue 0..360, blur 0..40.",
    parameters: obj({
      brightness: num("-1..1", { min: -1, max: 1 }),
      contrast: num("-100..100", { min: -100, max: 100 }),
      saturation: num("-2..10", { min: -2, max: 10 }),
      hue: num("0..360", { min: 0, max: 360 }),
      blur: num("0..40", { min: 0, max: 40 }),
      grayscale: bool("Desaturate fully"),
      invert: bool("Invert colors"),
      sepia: bool("Sepia tone"),
      ...targetProps,
    }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      const patch: Partial<Adjustments> = {};
      for (const k of ADJ_KEYS) if (a[k] !== undefined) (patch as Record<string, unknown>)[k] = a[k];
      if (Object.keys(patch).length === 0) throw new Error("no adjustment fields provided");
      ctx.patchAdj(l.id, patch);
      return `adjusted "${l.name}": ${Object.keys(patch).join(", ")}`;
    },
  },
  {
    name: "adjust.reset",
    description: "Clear all adjustments on a layer (back to neutral).",
    parameters: obj({ ...targetProps }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      ctx.patchAdj(l.id, {
        brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0,
        grayscale: false, invert: false, sepia: false,
      });
      return `reset adjustments on "${l.name}"`;
    },
  },
  {
    name: "adjust.addLayer",
    description:
      "Add an ADJUSTMENT layer: a content-less layer that filters everything below it. Set its adjustments with adjust.set targeting the new layer.",
    parameters: obj({ name: str("Layer name (default 'Adjustment')") }),
    run: (ctx, a) => {
      // Adjustment layers are created via the normal layer path so the editor
      // accumulator (filtered-group) picks them up.
      const layer = createLayer("adjustment", a.name ? { name: String(a.name) } : {});
      ctx.addLayer(layer, { select: true });
      return `added adjustment layer "${layer.name}" (${layer.id})`;
    },
  },
];
