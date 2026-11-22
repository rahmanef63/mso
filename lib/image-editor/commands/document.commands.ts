import { ASPECT_PRESETS } from "../lib/model";
import type { EditorCommand } from "./types";
import { describeDoc, num, obj, str } from "./schema";

// Canvas-level operations: resize, aspect presets, crop, and a read-only inspect.
export const documentCommands: EditorCommand[] = [
  {
    name: "doc.inspect",
    description:
      "Read-only: return the current canvas size and the layer stack (top→bottom) with kinds and which is selected. Call this first when unsure of state.",
    parameters: obj({}),
    run: (ctx) => describeDoc(ctx),
  },
  {
    name: "doc.resize",
    description: "Resize the canvas (does not scale layers).",
    parameters: obj({ "width!": num("New width px", { min: 1 }), "height!": num("New height px", { min: 1 }) }),
    run: (ctx, a) => {
      ctx.setDocSize(Number(a.width), Number(a.height));
      return `canvas → ${a.width}x${a.height}`;
    },
  },
  {
    name: "doc.aspect",
    description: `Resize the canvas to a named preset: ${ASPECT_PRESETS.map((p) => p.label).join(", ")}.`,
    parameters: obj({ "preset!": str("Preset label", { enum: ASPECT_PRESETS.map((p) => p.label) }) }),
    run: (ctx, a) => {
      const p = ASPECT_PRESETS.find((x) => x.label === a.preset);
      if (!p) throw new Error("unknown preset");
      ctx.setDocSize(p.w, p.h);
      return `canvas → ${p.label} (${p.w}x${p.h})`;
    },
  },
  {
    name: "doc.crop",
    description: "Crop the canvas to a rectangle (canvas px); layers shift and paint pixels re-bake.",
    parameters: obj({
      "x!": num("Left px", { min: 0 }),
      "y!": num("Top px", { min: 0 }),
      "width!": num("Width px", { min: 1 }),
      "height!": num("Height px", { min: 1 }),
    }),
    run: (ctx, a) => {
      ctx.applyCrop(Number(a.x), Number(a.y), Number(a.width), Number(a.height));
      return `cropped to ${a.width}x${a.height} @ (${a.x},${a.y})`;
    },
  },
];
