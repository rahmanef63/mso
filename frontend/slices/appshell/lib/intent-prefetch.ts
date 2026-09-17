import type { AppDescriptor } from "./types";

type PrefetchApp = Pick<AppDescriptor, "load" | "prefetch">;
export type PrefetchEnvironment = { hidden?: boolean; online?: boolean; saveData?: boolean; effectiveType?: string };
export const PREFETCH_INTENT_MS = 250;
const warmed = new WeakSet<PrefetchApp["load"]>();
const pending = new WeakSet<PrefetchApp["load"]>();

function browserEnvironment(): PrefetchEnvironment {
  if (typeof navigator === "undefined") return { online: false };
  const connection = (navigator as Navigator & { connection?: PrefetchEnvironment }).connection;
  return { hidden: typeof document !== "undefined" && document.hidden, online: navigator.onLine,
    saveData: connection?.saveData, effectiveType: connection?.effectiveType };
}

export function canIntentPrefetch(environment: PrefetchEnvironment): boolean {
  return !environment.hidden && environment.online !== false && !environment.saveData &&
    !["slow-2g", "2g"].includes(environment.effectiveType ?? "");
}

/** Cancel the intent timer, not an already-started import. Failed warming may retry. */
export function createIntentPrefetch(environment = browserEnvironment) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const schedule = (app: PrefetchApp, pointerType = "mouse") => {
    cancel();
    if (pointerType === "touch" || app.prefetch === "never" || !canIntentPrefetch(environment())) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!canIntentPrefetch(environment()) || warmed.has(app.load) || pending.has(app.load)) return;
      pending.add(app.load);
      // A speculative error must not reload an active editor or poison the real app loader.
      void Promise.resolve().then(() => app.load()).then(() => warmed.add(app.load))
        .catch(() => undefined).finally(() => pending.delete(app.load));
    }, PREFETCH_INTENT_MS);
  };
  return { schedule, cancel };
}
