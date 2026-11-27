import type { EditorTool } from "./image-editor-types.ts";

const IMAGE_TOOL_KEYS: Record<string, EditorTool> = {
  v: "select", c: "crop", b: "brush", e: "eraser", t: "text", s: "shape",
};

// Structural event shape so this stays testable without a DOM.
export type EditorKeyEvent = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  target?: unknown;
  preventDefault?: () => void;
};

type KeyTarget = {
  undo: () => void;
  redo: () => void;
  selectTool: (tool: EditorTool) => void;
};

export function handleEditorKey(event: EditorKeyEvent, target: KeyTarget): void {
  const tag = (event.target as { tagName?: string } | null | undefined)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  const mod = Boolean(event.metaKey || event.ctrlKey);
  const key = (event.key || "").toLowerCase();
  if (mod && key === "z") {
    event.preventDefault?.();
    if (event.shiftKey) target.redo(); else target.undo();
    return;
  }
  if (mod) return;
  const tool = IMAGE_TOOL_KEYS[key];
  if (tool) {
    event.preventDefault?.();
    target.selectTool(tool);
  }
}
