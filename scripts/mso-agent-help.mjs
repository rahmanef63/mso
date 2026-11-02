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
  // Colors and terminal width adjust output to match caller capabilities.
  const colors = options.colors || options.session?.colors;
  // Live terminal columns take precedence over stale session dimensions so terminal resizes
  // are immediately respected when the user runs /help.
  const width = options.width || process.stdout?.columns || options.session?.width;
  if (width || colors) {
    printer.printBlock(helpLines({ ...options, colors, width }).join("\n"));
  } else {
    printer.printBlock(HELP_TEXT);
  }
  const width = options.width || options.session?.width || process.stdout?.columns;
  // Derive effective keybinds so custom user mappings in ~/.mso/keybinds.json are displayed.
  const keybinds = options.keybinds || getKeybinds();
  // Always render dynamically so width, palette, and effective user keybinds reflect the active terminal.
  printer.printBlock(helpLines({ ...options, colors, width, keybinds }).join("\n"));
}
