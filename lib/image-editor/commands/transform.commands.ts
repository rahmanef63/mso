import type { Transform } from "../lib/types";
import type { EditorCommand } from "./types";
import { num, obj, resolveLayer, str, targetProps } from "./schema";

// Geometry (move/resize/rotate/scale/flip) + content edits for text & shapes.
export const transformCommands: EditorCommand[] = [
  {
    name: "transform.set",
    description:
      "Set a layer's geometry. Any omitted field is unchanged. x/y = top-left in canvas px; rotation in degrees; scaleX/scaleY (negative = flip).",
    parameters: obj({
      x: num("Left px"),
      y: num("Top px"),
      width: num("Width px"),
      height: num("Height px"),
      rotation: num("Degrees"),
      scaleX: num("Horizontal scale (neg = flip)"),
      scaleY: num("Vertical scale (neg = flip)"),
      ...targetProps,
    }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      const t: Transform = { ...l.t };
      for (const k of ["x", "y", "width", "height", "rotation", "scaleX", "scaleY"] as const) {
        if (a[k] !== undefined) t[k] = Number(a[k]);
      }
      ctx.update(l.id, { t });
      return `transformed "${l.name}"`;
    },
  },
  {
    name: "transform.flip",
    description: "Flip a layer horizontally and/or vertically.",
    parameters: obj({
      horizontal: { type: "boolean", description: "Flip left-right" },
      vertical: { type: "boolean", description: "Flip top-bottom" },
      ...targetProps,
    }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      const t: Transform = { ...l.t };
      if (a.horizontal) t.scaleX = -t.scaleX;
      if (a.vertical) t.scaleY = -t.scaleY;
      ctx.update(l.id, { t });
      return `flipped "${l.name}"`;
    },
  },
  {
    name: "text.edit",
    description: "Edit a TEXT layer's content and typography.",
    parameters: obj({
      text: str("New text content"),
      fontSize: num("Font size px"),
      fill: str("Text color hex"),
      fontFamily: str("Font family CSS string"),
      fontStyle: str("normal | bold | italic | bold italic"),
      align: str("Alignment", { enum: ["left", "center", "right"] }),
      ...targetProps,
    }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      if (l.kind !== "text") throw new Error(`"${l.name}" is not a text layer`);
      const patch: Record<string, unknown> = {};
      for (const k of ["text", "fontSize", "fill", "fontFamily", "fontStyle", "align"]) {
        if (a[k] !== undefined) patch[k] = a[k];
      }
      ctx.update(l.id, patch);
      return `edited text "${l.name}"`;
    },
  },
  {
    name: "shape.edit",
    description: "Edit a SHAPE layer's kind and fill.",
    parameters: obj({
      shape: str("rect | ellipse", { enum: ["rect", "ellipse"] }),
      fillColor: str("Fill color hex"),
      ...targetProps,
    }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      if (l.kind !== "shape") throw new Error(`"${l.name}" is not a shape layer`);
      const patch: Record<string, unknown> = {};
      if (a.shape !== undefined) patch.shape = a.shape;
      if (a.fillColor !== undefined) patch.fillColor = a.fillColor;
      ctx.update(l.id, patch);
      return `edited shape "${l.name}"`;
    },
  },
];
