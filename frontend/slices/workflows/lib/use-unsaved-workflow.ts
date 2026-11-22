"use client";

import { useCallback, useEffect } from "react";
import { setCloseGuard } from "@/features/appshell";

export function useUnsavedWorkflow(dirty: boolean, winId?: string) {
  const confirmDiscard = useCallback(() => !dirty || window.confirm("Discard unsaved workflow changes?"), [dirty]);
  useEffect(() => {
    if (winId) setCloseGuard(winId, dirty ? confirmDiscard : null);
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    if (dirty) window.addEventListener("beforeunload", beforeUnload);
    return () => {
      if (winId) setCloseGuard(winId, null);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, winId, confirmDiscard]);
  return confirmDiscard;
}
