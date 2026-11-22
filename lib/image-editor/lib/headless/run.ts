import type { Doc } from "../types";
import { createHeadlessEditor } from "./editor-core";
import { createLayer } from "../model";
import { imageSize } from "./image-size";
import type { AnthropicTool, EditorCommand, EditorCtx } from "../../commands/types";
import { documentCommands } from "../../commands/document.commands";
import { layerCommands } from "../../commands/layer.commands";
import { transformCommands } from "../../commands/transform.commands";
import { toolCommands } from "../../commands/tool.commands";
import { adjustCommands } from "../../commands/adjust.commands";
import { styleCommands } from "../../commands/style.commands";

// The headless-safe command set: every editor operation EXCEPT the two that need
// a live browser (export.image → Konva stage; image.removeBackground → @imgly
// WASM). Headless export is done by render.ts instead. Pure → server + CLI safe.
export const HEADLESS_COMMANDS: EditorCommand[] = [
  ...documentCommands,
  ...layerCommands,
  ...transformCommands,
  ...toolCommands,
  ...adjustCommands,
  ...styleCommands,
];

const BY_NAME = new Map(HEADLESS_COMMANDS.map((c) => [c.name, c]));

// Anthropic tool array (same shape as EDITOR_TOOLS) for the headless command set.
export const HEADLESS_TOOLS: AnthropicTool[] = HEADLESS_COMMANDS.map((c) => ({
  name: c.name,
  description: c.description,
  input_schema: c.parameters,
}));

export type Invocation = { name: string; args?: Record<string, unknown> };
export type CmdResult = { name: string; ok: boolean; result: string };

// Structural guard — reject anything that isn't a real editor Doc before running
// commands against it (the route trusts neither request bodies nor files on disk).
export function isDoc(x: unknown): x is Doc {
  const d = x as Doc;
  return !!d && typeof d === "object" && typeof d.width === "number" && typeof d.height === "number" && Array.isArray(d.layers);
}

// Apply a sequence of commands to a doc on a fresh headless context and return
// the resulting doc + per-command outcomes. A failing command is recorded and
// the run continues (matches the in-browser agent's per-tool error handling).
export async function runCommands(
  doc: Doc,
  cmds: Invocation[],
): Promise<{ doc: Doc; results: CmdResult[] }> {
  const ctx = createHeadlessEditor(doc) as unknown as EditorCtx;
  const results: CmdResult[] = [];
  for (const c of cmds) {
    const cmd = BY_NAME.get(c.name);
    if (!cmd) {
      results.push({ name: c.name, ok: false, result: "unknown command" });
      continue;
    }
    try {
      const r = await cmd.run(ctx, c.args ?? {});
      results.push({ name: c.name, ok: true, result: r });
    } catch (e) {
      results.push({ name: c.name, ok: false, result: e instanceof Error ? e.message : "failed" });
    }
  }
  return { doc: ctx.doc, results };
}

// Build a doc from an input image. `src` is what the doc STORES (a data URL, or
// preferably a light same-origin path-URL like /api/v1/fs/raw?path=…). Pass
// explicit `width`/`height` when the caller already probed them (e.g. the route
// read the file header off disk); otherwise they're derived from `src`. The real
// editor renders the pixels later by loading `src`.
export function buildDocFromImage(
  src: string,
  opts: { name?: string; width?: number; height?: number } = {},
): Doc {
  const { width, height } = opts.width && opts.height ? { width: opts.width, height: opts.height } : imageSize(src);
  const layer = createLayer("image", {
    name: opts.name ?? "Image",
    src,
    t: { x: 0, y: 0, width, height, rotation: 0, scaleX: 1, scaleY: 1 },
  });
  return { width, height, bg: "transparent", layers: [layer] };
}
