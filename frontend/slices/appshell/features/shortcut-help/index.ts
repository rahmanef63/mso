import { defineFeature } from "../../registry/types";
import { DeferredShortcutHelp } from "./deferred";

// Keyboard-shortcut cheat sheet — ⌘/ overlay over lib/shortcuts.
export const shortcutHelpFeature = defineFeature({
  id: "shortcut-help",
  slots: { overlay: DeferredShortcutHelp },
});
