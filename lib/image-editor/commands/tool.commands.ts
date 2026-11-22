import type { Tool } from "../lib/types";
import type { EditorCommand } from "./types";
import { num, obj, resolveLayer, str, targetProps } from "./schema";

const TOOLS: Tool[] = ["move", "brush", "eraser", "text", "rect", "ellipse", "eyedropper", "crop", "select", "hand"];

// Tool selection + brush settings + foreground/background colors + masks + undo.
export const toolCommands: EditorCommand[] = [
  {
    name: "tool.select",
    description: "Activate an editor tool.",
    parameters: obj({ "tool!": str("Tool name", { enum: TOOLS }) }),
    run: (ctx, a) => {
      ctx.setTool(a.tool as Tool);
      return `tool → ${a.tool}`;
    },
  },
  {
    name: "brush.set",
    description: "Set brush/eraser parameters. color also updates the foreground color.",
    parameters: obj({
      size: num("Brush diameter px", { min: 1, max: 400 }),
      color: str("Brush color hex"),
      opacity: num("0..1", { min: 0, max: 1 }),
      hardness: num("0..1 (edge softness)", { min: 0, max: 1 }),
    }),
    run: (ctx, a) => {
      const patch: Record<string, unknown> = {};
      for (const k of ["size", "color", "opacity", "hardness"]) if (a[k] !== undefined) patch[k] = a[k];
      if (a.color !== undefined) ctx.setFg(String(a.color));
      ctx.setBrush(patch);
      return `brush: ${Object.keys(patch).join(", ") || "unchanged"}`;
    },
  },
  {
    name: "color.set",
    description: "Set the foreground and/or background color (hex).",
    parameters: obj({ fg: str("Foreground hex"), bg: str("Background hex") }),
    run: (ctx, a) => {
      if (a.fg !== undefined) ctx.setFg(String(a.fg));
      if (a.bg !== undefined) ctx.setBg(String(a.bg));
      return `colors set`;
    },
  },
  {
    name: "color.swap",
    description: "Swap foreground and background colors.",
    parameters: obj({}),
    run: (ctx) => {
      ctx.swapColors();
      return "swapped fg/bg";
    },
  },
  {
    name: "mask.add",
    description: "Add a layer mask (paint on the mask to hide parts of the layer).",
    parameters: obj({ ...targetProps }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      ctx.addMask(l.id);
      return `added mask to "${l.name}"`;
    },
  },
  {
    name: "mask.remove",
    description: "Remove a layer's mask.",
    parameters: obj({ ...targetProps }),
    run: (ctx, a) => {
      const l = resolveLayer(ctx, a);
      ctx.removeMask(l.id);
      return `removed mask from "${l.name}"`;
    },
  },
  {
    name: "edit.undo",
    description: "Undo the last change.",
    parameters: obj({}),
    run: (ctx) => {
      ctx.undo();
      return "undone";
    },
  },
  {
    name: "edit.redo",
    description: "Redo the last undone change.",
    parameters: obj({}),
    run: (ctx) => {
      ctx.redo();
      return "redone";
    },
  },
];
