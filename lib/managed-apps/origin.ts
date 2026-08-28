// Which ORIGIN a managed-app dashboard is served from.
//
// The dashboards run in an iframe with allow-same-origin, because their SPAs need
// their own cookies and storage to work at all. On the cockpit origin that also
// made them same-origin with the cockpit: upstream JS could reach `window.top` and
// call /api/v1/exec with the user's session, and no CSP can stop it (CSP binds a
// realm, not a reference across realms). So each app gets its OWN host, pointed at
// this same process: `hermes.mso.example.com`, `openclaw.mso.example.com`.
// `window.top` is then cross-origin and opaque.
//
// One host PER APP, not one shared host: a shared one would put Hermes and
// OpenClaw back in a single origin where they can script each other.
//
// Middleware (`proxy.ts`) enforces the other half: on an app host, every path is
// rewritten into that app's proxy and everything else 404s, so /api/v1/exec does
// not exist on those origins at all. An unset/invalid template disables vendor
// dashboard embedding entirely; MSO's own Details management surface remains usable.
// There is deliberately no same-origin iframe fallback.
//
// Edge-safe and client-safe: no node builtins, no catalog import (that one reads
// node:os). NEXT_PUBLIC_ because the iframe `src` is built in the browser.
import { MANAGED_APP_IDS, type ManagedAppId } from "./types";

/** e.g. `{id}.mso.example.com`. Empty/unset = vendor dashboard embedding disabled. */
const TEMPLATE = process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE?.trim() ?? "";

const TOKEN = "{id}";

export const splitOriginEnabled = (): boolean => TEMPLATE.includes(TOKEN);

const NAMESPACE_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A reserved host in the split-origin namespace. The label is code-owned, not a
 * request value; validating it here prevents accidental host-template injection. */
export function appNamespaceHost(label: string): string | null {
  return splitOriginEnabled() && NAMESPACE_LABEL.test(label)
    ? TEMPLATE.replace(TOKEN, label).toLowerCase()
    : null;
}

/** The host this app's dashboard is served from, or null when dashboard embedding is disabled. */
export function managedAppHost(id: ManagedAppId): string | null {
  return appNamespaceHost(id);
}

/** `https://<host>` — the iframe origin. null when dashboard embedding is disabled. */
export function managedAppOrigin(id: ManagedAppId): string | null {
  const host = managedAppHost(id);
  return host ? `https://${host}` : null;
}

/** Which app a request Host belongs to, if any. Port and trailing dot ignored:
 *  a Host header may carry either, and both name the same origin. */
export function managedAppIdForHost(host: string | null | undefined): ManagedAppId | null {
  if (!host || !splitOriginEnabled()) return null;
  const bare = host.split(":")[0].replace(/\.$/, "").toLowerCase();
  return MANAGED_APP_IDS.find((id) => managedAppHost(id) === bare) ?? null;
}

/** The name the app hosts live under (`{id}.mso.example.com` → `mso.example.com`).
 *  Deployment-owned; null when embedding is disabled or when the leftover is a single
 *  label ("com", ""), which is nobody's deployment. */
function templateParent(): string | null {
  if (!splitOriginEnabled()) return null;
  const parent = TEMPLATE.slice(TEMPLATE.indexOf(TOKEN) + TOKEN.length)
    .replace(/^[.-]+/, "")
    .toLowerCase();
  return parent.includes(".") ? parent : null;
}

/** A host INSIDE the app namespace that is not one of the apps — e.g. someone adds
 *  `staging.mso.example.com` pointing at this port, or a wildcard appears.
 *
 *  Such a host must 404, not serve the cockpit: the session cookie is widened to
 *  `Domain=mso.example.com` so it is sent there, and a page on it would be
 *  same-origin with a full cockpit — the exact reach the split removes, handed back
 *  by a DNS edit nobody connected to this file. Only the namespace is refused, never
 *  the parent itself, so this cannot lock the operator out of the cockpit.
 *
 *  Deliberately not an allowlist env: a wrong value there WOULD lock them out. */
export function isUnclaimedAppNamespaceHost(host: string | null | undefined): boolean {
  const parent = templateParent();
  if (!host || !parent) return false;
  const bare = host.split(":")[0].replace(/\.$/, "").toLowerCase();
  return bare.endsWith(`.${parent}`) && managedAppIdForHost(bare) === null;
}

/** Request header the middleware stamps when it rewrites an app-host request into
 *  that app's proxy route. The route needs it because a rewrite is invisible from
 *  inside the handler — it sees the rewritten path as if it had been asked for
 *  directly. NEVER trusted from a client: middleware deletes any inbound copy on
 *  every request, and the route only reads it when split mode is on. Forged, it
 *  would otherwise buy root-mounted mode on the COCKPIT origin — upstream cookies
 *  at Path=/ and a policy naming the cockpit as a legal framer, i.e. the hole. */
export const MANAGED_APP_HOST_HEADER = "x-os-managed-app-host";

/** The COCKPIT origin. On an app host the frame is cross-origin, so the policy
 *  must name this in `frame-ancestors` or the browser refuses to display the
 *  dashboard at all.
 *
 *  Deployment env only, never a request header: this value decides WHO may frame
 *  the dashboard, so a client-settable source would let a page nominate itself.
 *  OS_PUBLIC_ORIGIN is not NEXT_PUBLIC — in the browser only the fallback
 *  resolves, and every caller is server-side.
 *
 *  Fallback is the template's parent name (`{id}.mso.example.com` →
 *  `https://mso.example.com`), which is deployment-owned too. A wrong value fails
 *  CLOSED — naming the wrong origin means the frame is refused, which is visible.
 *  null when nothing resolves, and the caller must then refuse framing outright
 *  rather than guess. */
export function cockpitOrigin(): string | null {
  const explicit = process.env.OS_PUBLIC_ORIGIN?.trim();
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      // Misconfigured (no scheme, junk): fall through instead of emitting it.
    }
  }
  const parent = templateParent();
  return parent ? `https://${parent}` : null;
}
