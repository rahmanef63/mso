import type { SessionSnapshot } from "./session-probe";

/** Accept only the latest probe and invalidate in-flight probes across logout. */
export function createSessionTransition(publish: (snapshot: SessionSnapshot) => void, clearSensitive: () => void) {
  let generation = 0;
  let signingOut = false;
  const commit = (next: SessionSnapshot) => {
    if (next.status === "out" || (next.status === "in" && next.role !== "owner")) clearSensitive();
    publish(next);
  };
  return {
    beginProbe: () => signingOut ? -1 : ++generation,
    acceptProbe: (id: number, next: SessionSnapshot | null) => {
      if (id !== generation || signingOut || !next) return false;
      commit(next);
      return true;
    },
    beginSignOut: () => { signingOut = true; const id = ++generation; clearSensitive(); return id; },
    finishSignOut: (id: number) => { if (id !== generation || !signingOut) return; ++generation; commit({ status: "out", role: null }); signingOut = false; },
  };
}
