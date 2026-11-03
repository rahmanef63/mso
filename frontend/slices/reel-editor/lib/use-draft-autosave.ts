"use client";
import { useEffect, useRef, useState } from "react";
import { setCloseGuard } from "@/features/appshell";
import type { Composition } from "./mock-timeline";
import { saveDraft } from "./draft";
import { getSettings } from "./settings";

export function useDraftAutosave(comp: Composition, baseline: { snapshot: string | null; available: boolean }, winId?: string) {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const draftSnapshot = useRef(baseline.snapshot);
  const initialComp = useRef(comp);
  const sessionMedia = comp.clips.some((c) => c.media?.url.startsWith("blob:"));
  useEffect(() => {
    if (!sessionMedia && !draftError) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    if (winId) setCloseGuard(winId, () => window.confirm("This timeline may not be recoverable. Uploaded media is available only in this session. Close anyway?"));
    return () => { window.removeEventListener("beforeunload", warn); if (winId) setCloseGuard(winId, null); };
  }, [winId, sessionMedia, draftError]);
  useEffect(() => {
    if (!getSettings().autosave) return;
    if (comp === initialComp.current) {
      if (!baseline.available) queueMicrotask(() => setDraftError("Timeline could not be saved in this browser."));
      return;
    }
    if (!baseline.available) return;
    const persist = () => {
      try {
        if (localStorage.getItem("reel.draft") !== draftSnapshot.current) {
          setSavedAt(null);
          setDraftError("Another tab changed the recovery draft. This timeline has not been saved.");
          return;
        }
        if (!saveDraft(comp)) throw new Error("Storage unavailable");
        draftSnapshot.current = localStorage.getItem("reel.draft");
        setDraftError(null);
        setSavedAt(Date.now());
      } catch { setSavedAt(null); setDraftError("Timeline could not be saved in this browser."); }
    };
    const t = setTimeout(persist, 800);
    window.addEventListener("pagehide", persist);
    return () => { clearTimeout(t); window.removeEventListener("pagehide", persist); persist(); };
  }, [comp, baseline.available]);
  return { savedAt, draftError, sessionMedia };
}
