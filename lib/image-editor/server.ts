// SERVER barrel for the headless editor — pure data only (no DOM, no canvas, no
// native deps). The API route imports from here to run the editor's command
// registry against a Doc and to build a doc from an opened image. There is NO
// server renderer: to SEE a doc, open it in the real editor (media-studio loads
// a `.doc.json` / `.ie.json` path) — "render = the actual mso editor".
export { runCommands, HEADLESS_COMMANDS, HEADLESS_TOOLS, buildDocFromImage, isDoc } from "./lib/headless/run";
export type { Invocation, CmdResult } from "./lib/headless/run";
export { imageSize } from "./lib/headless/image-size";
export { blankDoc } from "./lib/model";
export type { Doc } from "./lib/types";
