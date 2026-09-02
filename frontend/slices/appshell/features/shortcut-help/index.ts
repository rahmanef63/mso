import { defineFeature } from "../../registry/types";
import { ShortcutHelpOverlay } from "./components/shortcut-help-overlay";

// Keyboard-shortcut cheat sheet — ⌘/ overlay over lib/shortcuts.
export const shortcutHelpFeature = defineFeature({
  id: "shortcut-help",
  slots: { overlay: ShortcutHelpOverlay },
});
