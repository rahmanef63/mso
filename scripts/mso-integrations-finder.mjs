#!/usr/bin/env node
export { buildFrame as frame } from "./integrations-tui/renderer.mjs";
export { visibleColumns, cellWidth, fitCells, stripAnsi } from "./integrations-tui/layout.mjs";
export { shortcutEvent } from "./integrations-tui/app.mjs";
import { run } from "./integrations-tui/app.mjs";
if (import.meta.url === `file://${process.argv[1]}`) run(process.argv[2]);
