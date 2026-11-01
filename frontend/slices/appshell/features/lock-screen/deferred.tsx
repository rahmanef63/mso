"use client";

import { useLocked } from "../../lib/lock";
import { DeferredSurface } from "../../primitives/deferred-surface";

const load = () => import("./components/lock-screen").then((module) => ({ default: module.LockScreen }));

/**
 * Lock screen presentation, deferred — but only the presentation.
 *
 * The idle auto-lock timer that used to justify keeping this eager now lives in
 * `appshell/provider/app-shell.tsx` via `useIdleAutoLock`, mounted whether or not this chunk has
 * been fetched. So `useLocked()` is read here (it is a cheap subscription in `lib/lock`), and the
 * curtain's chunk is requested the moment the shell is actually locked.
 *
 * `keepMounted` is deliberately not set: the curtain already returns null when unlocked, and
 * keeping a locked shell's overlay alive after unlock would hold its clock interval running.
 */
export function DeferredLockScreen() {
  const locked = useLocked();
  return <DeferredSurface active={locked} load={load} label="Lock screen" />;
}
