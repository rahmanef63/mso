import { defineFeature } from "../../registry/types";
import { ToastHost } from "./components/toast-host";
import { DynamicIsland } from "./components/dynamic-island";

// Notifications — transient toast stack (both surfaces) + the mobile Dynamic
// Island live-activity pill. The toast/activity buses stay in appshell core so
// any app can fire toast()/setActivity() without depending on this slice.
export const notificationsFeature = defineFeature({
  id: "notifications",
  slots: {
    notifications: ToastHost,
    topPill: DynamicIsland,
  },
});
