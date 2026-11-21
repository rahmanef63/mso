"use client";

import { useEffect, useRef } from "react";
import { registerAlfaRunner, registerAlfaStop, unregisterAlfaRunner } from "@/features/appshell/alfa";

/**
 * Publish this panel as THE Alfa engine while it is mounted, so the per-app Alfa
 * sheet drives the real agent — same tools, same approval cards, same thread —
 * rather than a second, weaker chat that would drift from it.
 *
 * A registration rather than a headless extraction on purpose: the tool binding,
 * the parked-approval promises and the abort controller are all React-owned in the
 * panel, and duplicating them for the sheet would mean two engines to keep in step.
 *
 * The window may be minimised or behind another app and this still holds; only
 * unmount clears it, and a surface that finds no engine opens the Assistant.
 */
export function useAlfaRunner(
  send: (text: string, fromAppId?: string, appContext?: string) => Promise<void>,
  stop: () => void,
): void {
  // The registered closure must never capture a stale `send`.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  useEffect(() => {
    // The AbortController lives here, so Stop in the dock and the sheet has to come
    // back through this registration or those buttons do nothing.
    registerAlfaStop(() => stopRef.current());
    registerAlfaRunner(async () => async (text, ctx) => {
      // Pass app grounding cleanly into the system prompt instead of prefixing
      // the user's visible chat bubble with bracketed metadata.
      const appContext = ctx.subject
        ? `The user is in the ${ctx.subject} app.${ctx.context ? ` ${ctx.context}` : ""}`
        : undefined;
      await sendRef.current(text, ctx.appId, appContext);
    });
    return () => unregisterAlfaRunner();
  }, []);
}
