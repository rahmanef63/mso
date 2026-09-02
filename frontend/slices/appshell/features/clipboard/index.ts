import { defineFeature } from "../../registry/types";
import { ClipboardOverlay } from "./components/clipboard-overlay";

// Clipboard manager — ⌘⇧V history overlay over lib/clipboard (capture starts
// when the overlay feature mounts).
export const clipboardFeature = defineFeature({
  id: "clipboard",
  slots: { overlay: ClipboardOverlay },
});
