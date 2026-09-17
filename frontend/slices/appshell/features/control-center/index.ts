import { defineFeature } from "../../registry/types";
import { DeferredControlCenter } from "./deferred";
import { ControlCenterDesktop } from "./components/control-center-desktop";

// Control Center — the SAME real toggles on both surfaces: an iOS-style pull-down
// Sheet (controlCenter slot, mobile) + a macOS menu-bar popover (menuBarStatus
// slot, which only the macOS menu bar renders). Open state for the mobile Sheet is
// owned by the mobile surface via the shell-UI context; the desktop popover is local.
export const controlCenterFeature = defineFeature({
  id: "control-center",
  slots: { controlCenter: DeferredControlCenter, menuBarStatus: ControlCenterDesktop },
});
