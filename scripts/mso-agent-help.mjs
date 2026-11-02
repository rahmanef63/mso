import process from "node:process";
// Derives help lines and formatted text directly from command and settings registries.
import { createPrinter } from "./mso-agent-print.mjs";
import { helpLines } from "./mso-agent-help-lines.mjs";

export { helpLines };

// Static exports for backward compatibility and test assertions.
export const HELP_LINES = helpLines();
export const HELP_TEXT = HELP_LINES.join("\n");

export function printHelp(options = {}) {
  const printer = createPrinter(options);
  // Re-render when caller passes terminal width or custom colors; fallback to canonical HELP_TEXT.
  const colors = options.colors || options.session?.colors;
  // Live terminal columns take precedence over stale session dimensions so terminal resizes
  // are immediately respected when the user runs /help.
  const width = options.width || process.stdout?.columns || options.session?.width;
  if (width || colors) {
    printer.printBlock(helpLines({ ...options, colors, width }).join("\n"));
  } else {
    printer.printBlock(HELP_TEXT);
  }
}
