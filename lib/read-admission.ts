export class ReadBusyError extends Error {
  constructor() { super("file reads busy; retry after active reads finish"); }
}

/** Count active work, not requests per minute; release is safe on competing cleanup paths. */
export function readAdmission(perActor: number, global: number) {
  const actors = new Map<string, number>();
  let active = 0;
  return (actor: string) => {
    const count = actors.get(actor) ?? 0;
    if (count >= perActor || active >= global) throw new ReadBusyError();
    actors.set(actor, count + 1); active++;
    let released = false;
    return () => {
      if (released) return;
      released = true; active--;
      const remaining = (actors.get(actor) ?? 1) - 1;
      if (remaining) actors.set(actor, remaining); else actors.delete(actor);
    };
  };
}
