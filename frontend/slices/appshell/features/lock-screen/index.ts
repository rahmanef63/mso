import { defineFeature } from "../../registry/types";
import { DeferredLockScreen } from "./deferred";

// Lock screen — privacy curtain overlay. The idle auto-lock timer is NOT part of this feature's
// eager cost any more: it moved to appshell/provider (useIdleAutoLock), so this overlay can be
// deferred without weakening protection.
export const lockScreenFeature = defineFeature({
  id: "lock-screen",
  slots: { overlay: DeferredLockScreen },
});
