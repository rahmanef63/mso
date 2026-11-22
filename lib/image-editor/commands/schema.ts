import type { EditorCtx, JsonSchema } from "./types";
import type { Layer } from "../lib/types";

// Tiny JSON-Schema property builders — keep command files readable. Each returns
// a property node; `obj()` assembles them and tracks `required` keys.
export const str = (description: string, opts: { enum?: readonly string[] } = {}) => ({
  type: "string" as const,
  description,
  ...(opts.enum ? { enum: opts.enum as string[] } : {}),
});
export const num = (description: string, opts: { min?: number; max?: number } = {}) => ({
  type: "number" as const,
  description,
  ...(opts.min !== undefined ? { minimum: opts.min } : {}),
  ...(opts.max !== undefined ? { maximum: opts.max } : {}),
});
export const bool = (description: string) => ({ type: "boolean" as const, description });

// Build an object schema. Mark a key required by suffixing its name with "!".
export function obj(props: Record<string, unknown>): JsonSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    const key = k.endsWith("!") ? k.slice(0, -1) : k;
    if (k.endsWith("!")) required.push(key);
    properties[key] = v;
  }
  return { type: "object", properties, required, additionalProperties: false };
}

// Common layer-target selector shared by most commands. Resolve order:
// explicit id → name (case-insensitive) → 1-based stack index → current selection.
export const targetProps = {
  layerId: str("Layer id to target. Omit to use the selected layer."),
  layerName: str("Target layer by (case-insensitive) name instead of id."),
};

export function resolveLayer(ctx: EditorCtx, args: Record<string, unknown>): Layer {
  const { doc, selectedId } = ctx;
  const id = typeof args.layerId === "string" ? args.layerId : undefined;
  const name = typeof args.layerName === "string" ? args.layerName.toLowerCase() : undefined;
  let layer: Layer | undefined;
  if (id) layer = doc.layers.find((l) => l.id === id);
  else if (name) layer = doc.layers.find((l) => l.name.toLowerCase() === name);
  else if (selectedId) layer = doc.layers.find((l) => l.id === selectedId);
  if (!layer) throw new Error(id || name ? "layer not found" : "no layer selected");
  return layer;
}

// A compact, model-friendly description of current editor state (for read-back).
export function describeDoc(ctx: EditorCtx): string {
  const { doc, selectedId } = ctx;
  const layers = doc.layers
    .map((l, i) => `#${i + 1} ${l.name} [${l.kind}]${l.id === selectedId ? " *selected" : ""}${l.visible ? "" : " hidden"}`)
    .reverse()
    .join("; ");
  return `Canvas ${doc.width}x${doc.height}, bg ${doc.bg}. Layers (top→bottom): ${layers || "none"}.`;
}
