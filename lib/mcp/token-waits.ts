const waits = new Map<string, Set<AbortController>>();

export function registerMcpTokenWait(hash:string, parent?:AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  const set = waits.get(hash) ?? new Set<AbortController>();
  set.add(controller); waits.set(hash,set);
  parent?.addEventListener("abort",abort,{once:true});
  if (parent?.aborted) abort();
  return {signal:controller.signal, release:()=> {
    parent?.removeEventListener("abort",abort);
    set.delete(controller); if (!set.size && waits.get(hash) === set) waits.delete(hash);
  }};
}

export function abortMcpTokenWaits(hash:string): void {
  for (const controller of waits.get(hash) ?? []) controller.abort(new Error("MCP authorization revoked"));
  waits.delete(hash);
}
