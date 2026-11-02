import process from "node:process";
// Derives help lines and formatted text directly from command and settings registries.
// Commands like /find are declared in COMMAND_MANIFEST in mso-agent-commands.mjs.
import { createPrinter } from "./mso-agent-print.mjs";
import { helpLines } from "./mso-agent-help-lines.mjs";
import { getKeybinds } from "./mso-agent-keybinds.mjs";

export { helpLines };

// Static exports for backward compatibility and test assertions.
export const HELP_LINES = helpLines();
export const HELP_TEXT = HELP_LINES.join("\n");

export function printHelp(options = {}) {
  const printer = createPrinter(options);
  const colors = options.colors || options.session?.colors;
  // Live terminal columns beat a stale session width, so a resize is respected the moment /help runs.
  const width = options.width || process.stdout?.columns || options.session?.width;
  // Effective keybinds, so a custom keymap is described instead of the shipped default.
  const keybinds = options.keybinds || getKeybinds();
  printer.printBlock(helpLines({ ...options, colors, width, keybinds }).join("\n"));
}
