import type {
  Adjustments,
  Doc,
  DropShadow,
  Layer,
  LayerStyle,
  OuterGlow,
  Stroke,
  Tool,
} from "../lib/types";

export type Brush = { size: number; color: string; opacity: number; hardness: number };

export type EditorCtx = {
  doc: Doc;
  selectedId: string | null;
  selected: Layer | null;
  tool: Tool;
  brush: Brush;
  fg: string;
  bg: string;
  canUndo: boolean;
  canRedo: boolean;
  select: (id: string | null) => void;
  setTool: (t: Tool) => void;
  setBrush: (b: Partial<Brush>) => void;
  setFg: (c: string) => void;
  setBg: (c: string) => void;
  swapColors: () => void;
  resetColors: () => void;
  setDocSize: (w: number, h: number) => void;
  update: (id: string, patch: Partial<Layer>) => void;
  patchStyle: (id: string, patch: Partial<LayerStyle>) => void;
  patchShadow: (id: string, patch: Partial<DropShadow>) => void;
  patchGlow: (id: string, patch: Partial<OuterGlow>) => void;
  patchStroke: (id: string, patch: Partial<Stroke>) => void;
  patchAdj: (id: string, patch: Partial<Adjustments>) => void;
  addLayer: (layer: Layer, opts?: { select?: boolean }) => void;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  reorder: (from: number, to: number) => void;
  raise: (id: string) => void;
  lower: (id: string) => void;
  applyCrop: (x: number, y: number, w: number, h: number) => void;
  addMask: (id: string) => void;
  removeMask: (id: string) => void;
  recordPaint: (id: string, before: string, after: string) => void;
  undo: () => void;
  redo: () => void;
};

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type EditorCommand = {
  name: string;
  description: string;
  parameters: JsonSchema;
  run: (ctx: EditorCtx, args: Record<string, unknown>) => string | Promise<string>;
};

export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: JsonSchema;
};
