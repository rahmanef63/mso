import { defineFeature } from "../../registry/types";
import { Spotlight } from "./components/spotlight";

// Search — the ⌘K command palette, mounted into the shell's full-screen overlay.
export const searchFeature = defineFeature({
  id: "search",
  slots: { overlay: Spotlight },
});
