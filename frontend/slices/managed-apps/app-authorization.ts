/** Client-side authorization pipeline for managed-app frames.
 *
 *  Split out of the React component so the real behavior — an actual fetch of the
 *  session route plus abort semantics — is testable without a DOM renderer.
 *
 *  Only the Orca bridge may choose a different framed document: the server builds
 *  the canonical `…/web-index.html#pairing=…` URL. Every other app frames its own
 *  fixed origin root, and a server-supplied `webClientUrl` for them is refused
 *  rather than navigated to (no untrusted same-origin navigation path).
 */
export interface AuthorizedFrame {
  source: string;
  url: string;
}

export async function resolveAuthorizedFrame(response: Response, embeddedSource: string, appId: string): Promise<AuthorizedFrame> {
  if (!response.ok) throw new Error("authorization failed");
  const data = await response.json();
  const expectedOrigin = new URL(embeddedSource).origin;
  if (data.origin !== expectedOrigin || typeof data.ticket !== "string" || data.ticket.length === 0) {
    throw new Error("authorization origin mismatch");
  }

  let targetSource = embeddedSource;
  if (appId === "orca") {
    if (typeof data.webClientUrl !== "string") throw new Error("authorization origin mismatch");
    const candidate = new URL(data.webClientUrl);
    if (candidate.origin !== expectedOrigin || candidate.pathname !== "/web-index.html" || candidate.search !== "") {
      throw new Error("authorization origin mismatch");
    }
    if (!candidate.hash.startsWith("#pairing=")) throw new Error("authorization origin mismatch");
    targetSource = data.webClientUrl;
  } else if (data.webClientUrl !== undefined && data.webClientUrl !== null) {
    throw new Error("authorization origin mismatch");
  }

  const url = new URL(targetSource);
  if (url.origin !== expectedOrigin) throw new Error("authorization origin mismatch");
  const fragment = new URLSearchParams(url.hash.slice(1));
  fragment.set("app_ticket", data.ticket);
  url.hash = fragment.toString();
  return { source: embeddedSource, url: url.toString() };
}

export async function requestAuthorizedFrame(appId: string, embeddedSource: string, signal: AbortSignal): Promise<AuthorizedFrame> {
  const response = await fetch(`/api/v1/managed-apps/${appId}/session`, { cache: "no-store", signal });
  return resolveAuthorizedFrame(response, embeddedSource, appId);
}

export interface FrameAuthState {
  generation: number;
  auth: AuthorizedFrame | null;
  error: boolean;
}

/** Select the frame URL for the CURRENT generation. A result stamped with an older
 *  generation (a stale response that raced a refresh/remount) is ignored, so an old
 *  authorized frame can never be re-mounted. */
export function selectAuthorizedFrame(state: FrameAuthState, generation: number, embeddedSource: string): { url: string | null; error: boolean } {
  if (state.generation !== generation) return { url: null, error: false };
  return { url: state.auth?.source === embeddedSource ? state.auth.url : null, error: state.error };
}
