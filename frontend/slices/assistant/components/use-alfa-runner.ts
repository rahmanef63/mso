"use client";

import { useEffect, useRef } from "react";
import { registerAlfaRunner, registerAlfaStop, unregisterAlfaRunner } from "@/features/appshell";

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
  send: (text: string, fromAppId?: string) => Promise<void>,
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
      // Ground the turn in whatever app the sheet was opened over, the way the old
      // scoped inspector chat did — and tag it so the shared thread can show the
      // cross-feature trail.
      const grounded = ctx.subject
        ? `[Context — the user is in the ${ctx.subject} app.${ctx.context ? ` ${ctx.context}` : ""}] ${text}`
        : text;
      await sendRef.current(grounded, ctx.appId);
    });
    return () => unregisterAlfaRunner();
  }, []);
}
