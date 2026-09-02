import { defineFeature } from "../../registry/types";
import { Inspector } from "./components/inspector";
import { AlfaSheet } from "./components/alfa-sheet";

// Inspector — the app-context panel + Alfa. The publish bus (usePublishInspector)
// stays in appshell core so apps publish state without depending on this feature.
//
// TWO slots, one feature, one open-state: the right dock on desktop (rightPanel is
// rendered only by the macOS and Windows shells) and a bottom sheet on mobile via
// `overlay`, which every shell renders. Before this, Alfa did not exist at all on a
// phone. Each returns null on the surface it is not for, so only one ever mounts.
export const inspectorFeature = defineFeature({
  id: "inspector",
  slots: { rightPanel: Inspector, overlay: AlfaSheet },
});
