// Talking to /api/v1/camoufox/service. No React here so the retry/readiness logic
// stays testable without a DOM.

export interface CamoufoxServiceStatus {
  running: boolean;
  enabled: boolean;
  installed: boolean;
  viewerReady?: boolean;
}

export async function fetchStatus(signal?: AbortSignal): Promise<CamoufoxServiceStatus> {
  const response = await fetch("/api/v1/camoufox/service", { cache: "no-store", signal });
  const payload = (await response.json()) as CamoufoxServiceStatus & { error?: string };
  // Never fall back to a synthetic "not installed": that reads as a settled fact
  // about the host when it is really an unanswered question, and it sends whoever
  // sees it looking for a missing install instead of the real fault.
  if (!response.ok) throw new Error(payload.error ?? "The browser session is unreachable");
  return payload;
}

export async function setPower(on: boolean, signal?: AbortSignal): Promise<CamoufoxServiceStatus> {
  const response = await fetch("/api/v1/camoufox/service", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: on ? "start" : "stop" }),
    signal,
  });
  const payload = (await response.json()) as CamoufoxServiceStatus & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Could not change the browser session");
  return payload;
}

/** systemd reports `active` before websockify/noVNC is listening. The cockpit cannot
 * fetch the dedicated viewer origin directly without widening CORS, so the authenticated
 * same-origin status route performs the bounded loopback probe and returns viewerReady. */
export async function waitForViewer(signal: AbortSignal, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!signal.aborted) {
    try {
      const status = await fetchStatus(signal);
      if (status.running && status.viewerReady) return true;
    } catch {
      if (signal.aborted) return false;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return false;
}
