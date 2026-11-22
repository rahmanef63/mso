import { createLayer } from "../lib/model";
import type { LayerKind } from "../lib/types";
import type { EditorCommand } from "./types";
import { bool, num, obj, resolveLayer, str, targetProps } from "./schema";

const KINDS = ["paint", "text", "shape", "image", "adjustment"] as const;

// Create / delete / duplicate / reorder / show-hide / lock / rename / select.
export const layerCommands: EditorCommand[] = [
  {
    name: "layer.add",
    description:
      "Add a new layer. kind=text needs `text`; kind=shape needs `shape` (rect|ellipse) + optional fillColor; kind=image needs `src` (URL/data URL). New layer is placed on top and selected.",
    parameters: obj({
      "kind!": str("Layer type", { enum: KINDS }),
      name: str("Layer name"),
      text: str("Text content (kind=text)"),
      fontSize: num("Font size px (kind=text)"),
      fill: str("Text color hex (kind=text)"),
      shape: str("Shape kind (kind=shape)", { enum: ["rect", "ellipse"] }),
      fillColor: str("Shape fill hex (kind=shape)"),
      src: str("Image URL or data URL (kind=image)"),
    }),
    run: (ctx, a) => {
      const kind = a.kind as LayerKind;
      const extra: Record<string, unknown> = {};
      for (const k of ["name", "text", "fontSize", "fill", "shape", "fillColor", "src"]) {
        if (a[k] !== undefined) extra[k] = a[k];
      }
      const layer = createLayer(kind, extra);
      ctx.addLayer(layer, { select: true });
      return `added ${kind} layer "${layer.name}" (${layer.id})`;
    },
  },
  {
    name: "layer.remove",
    description: "Delete a layer.",
    parameters: obj({ ...targetProps }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      ctx.removeLayer(l.id);
      return `removed "${l.name}"`;
    },
  },
  {
    name: "layer.duplicate",
    description: "Duplicate a layer (copy placed above the original).",
    parameters: obj({ ...targetProps }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      ctx.duplicateLayer(l.id);
      return `duplicated "${l.name}"`;
    },
  },
  {
    name: "layer.select",
    description: "Make a layer the active selection.",
    parameters: obj({ ...targetProps }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      ctx.select(l.id);
      return `selected "${l.name}"`;
    },
  },
  {
    name: "layer.order",
    description: "Move a layer in the stack: raise (up one), lower (down one), front (top), or back (bottom).",
    parameters: obj({ "move!": str("Direction", { enum: ["raise", "lower", "front", "back"] }), ...targetProps }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      const move = a.move as string;
      if (move === "raise") ctx.raise(l.id);
      else if (move === "lower") ctx.lower(l.id);
      else {
        const from = ctx.doc.layers.findIndex((x) => x.id === l.id);
        ctx.reorder(from, move === "front" ? ctx.doc.layers.length - 1 : 0);
      }
      return `moved "${l.name}" ${move}`;
    },
  },
  {
    name: "layer.visibility",
    description: "Show or hide a layer.",
    parameters: obj({ "visible!": bool("true = show, false = hide"), ...targetProps }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      ctx.update(l.id, { visible: Boolean(a.visible) });
      return `${a.visible ? "showed" : "hid"} "${l.name}"`;
    },
  },
  {
    name: "layer.lock",
    description: "Lock or unlock a layer (locked = not editable/movable).",
    parameters: obj({ "locked!": bool("true = lock"), ...targetProps }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      ctx.update(l.id, { locked: Boolean(a.locked) });
      return `${a.locked ? "locked" : "unlocked"} "${l.name}"`;
    },
  },
  {
    name: "layer.rename",
    description: "Rename a layer.",
    parameters: obj({ "name!": str("New name"), ...targetProps }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      ctx.update(l.id, { name: String(a.name) });
      return `renamed to "${a.name}"`;
    },
  },
  {
    name: "layer.opacity",
    description: "Set a layer's opacity (0..1).",
    parameters: obj({ "opacity!": num("0 = transparent, 1 = opaque", { min: 0, max: 1 }), ...targetProps }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      ctx.update(l.id, { opacity: Number(a.opacity) });
      return `opacity of "${l.name}" → ${a.opacity}`;
    },
  },
];
