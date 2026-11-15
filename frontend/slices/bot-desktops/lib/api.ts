"use client";

// HTTP surface for /api/v1/desktop/*. The routes are already gated (viewer-or-owner
// reads, rate-limited lifecycle), so this file only shapes requests and errors; it
// holds no policy of its own.

export interface BotDesktop {
  id: string;
  name: string;
  state: string;
  status: string;
  labels: { user: string | null; bot: string | null };
  created: string;
  ports: string;
}

export type LifecycleAction = "start" | "stop" | "restart" | "logs";

export interface LifecycleResult {
  action: LifecycleAction;
  container: string;
  state: BotDesktop | null;
  logs?: string[];
}

/**
 * A refusal is not a transient fault, and the caller must be able to tell them
 * apart without matching on message text: polling a 401 forever is a bug, retrying
 * a network blip is correct.
 */
export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

export const isPermissionError = (cause: unknown): boolean => cause instanceof PermissionError;

/** Every bot desktop container this host knows about (label grokbot.desktop=1). */
export async function listDesktops(signal?: AbortSignal): Promise<BotDesktop[]> {
  const response = await fetch("/api/v1/desktop/containers", { cache: "no-store", signal });
  // 401 is a deployment state (nobody signed in), not a fault: say what to do about
  // it rather than passing the API's bare word through to a person.
  if (response.status === 401) throw new PermissionError("Sign in to MSO as the owner to see bot desktops.");
  if (response.status === 403) throw new PermissionError("This account cannot read bot desktops. An owner role is required.");
  const payload = (await response.json().catch(() => ({}))) as { containers?: BotDesktop[]; error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Could not read bot desktops (${response.status})`);
  return payload.containers ?? [];
}

/**
 * start | stop | restart | logs. Four fixed verbs; the container id is the only
 * argument and the server validates it again before any docker call.
 */
export async function desktopAction(container: string, action: LifecycleAction): Promise<LifecycleResult> {
  const response = await fetch("/api/v1/desktop/lifecycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ container, action }),
  });
  const payload = (await response.json().catch(() => ({}))) as LifecycleResult & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `${action} failed (${response.status})`);
  return payload;
}

/**
 * A screenshot URL for one display. `screen` is a display number: the primary box
 * runs :99 and the extra bot screens are :1..:3. Returned as a URL rather than bytes
 * so the browser caches and the `<img>` owns the request; `generation` busts the
 * cache when the caller refreshes on purpose.
 */
export function screenshotUrl(container: string, screen: string, generation = 0): string {
  const query = new URLSearchParams({ container, screen });
  if (generation) query.set("t", String(generation));
  return `/api/v1/desktop/screenshot?${query.toString()}`;
}

/** The displays a bot box creates, in the order a person would want them. */
export const SCREENS = ["99", "1", "2", "3"] as const;

/** A running container is the only one worth screenshotting. */
export const isRunning = (desktop: BotDesktop): boolean => desktop.state.toLowerCase() === "running";
