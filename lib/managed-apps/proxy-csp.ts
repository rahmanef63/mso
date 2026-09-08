// The containment policy the managed-app proxy puts on the iframe, and the merge
// that keeps the upstream's own hardening instead of replacing it with ours.
//
// Ours is the only policy the browser sees: the response allowlist in
// proxy-headers.ts never copies the upstream `content-security-policy` (it carries
// `frame-ancestors 'none'`, which would un-frame the app). Dropping it wholesale
// also threw away real hardening — live OpenClaw pins its two inline scripts by
// sha256 and grants no 'unsafe-inline' at all — so the upstream policy is now
// INTERSECTED into ours per directive: a source survives only if BOTH policies
// allow it, and the emitted directive is the tighter of the two. Hermes sends no
// policy, so for Hermes the result is ours, unchanged.
//
// Server-only (it pins the injected shim by hash, via node:crypto).
// proxy-headers.ts must not import it.

type Policy = Map<string, string[]>;

/** The one deployment fact the policy needs. The app is always root-mounted on its
 *  OWN host now — `prefixUrl` is that origin's root, the policy is origin-scoped, and
 *  nothing is injected into the document, so the upstream's own base-uri may win. */
export interface PolicyMount {
  /** The cockpit origin. Root-mounted, the frame is CROSS-origin, so
   *  frame-ancestors must name it or the browser refuses to display the dashboard.
   *  It is also the one external host never honoured out of an upstream policy: a
   *  compromised upstream granting itself `connect-src https://mso.example.com`
   *  would be calling the cockpit API from inside the frame. Missing ⇒ 'none',
   *  because a frame that will not display is a visible failure while a guessed
   *  framer is a silent invitation. */
  cockpitOrigin?: string | null;
}

// Containment for the iframe: it runs on the mso origin with
// allow-same-origin, so without this any JS the upstream serves could fetch
// /api/v1/exec with the cockpit session. CSP source expressions match fetch
// directives by PATH PREFIX when the source ends in "/", so scoping every
// directive to the app's absolute proxy URL leaves the rest of the origin —
// /api/v1/exec, /api/v1/fs, /api/v1/term — outside the policy.
// 'self' is deliberately absent everywhere: it would re-open the whole origin,
// and a nested <iframe src="/"> would then run cockpit JS under its own CSP.
// script/style/media stay permissive in KIND (inline, data:, blob:) because an
// upstream with no policy of its own (Hermes) needs it — but never in ORIGIN.
// Three deliberate calls:
//   • no 'unsafe-eval' — grepped both installed bundles: zero `eval(`, zero
//     `new Function(`, so it bought nothing and paid for a JIT-string sink.
//   • worker-src is blob:-ONLY, dropping the prefix. Neither bundle constructs a
//     Worker from a URL (every "Worker" hit is i18n copy), and worker-src also
//     governs serviceWorker.register — which no blob: URL is eligible for — so
//     this is what actually stops an upstream SW from outliving the window.
//   • img-src drops `https:` root-mounted. The session cookie is Domain-widened to
//     reach the app hosts, so a credentialed `new Image().src =
//     "<cockpit>/api/v1/fs/raw?path=…"` fires with it and onload/onerror is an
//     existence oracle over OS_FS_READ_ROOTS. Bytes stay unreadable and every
//     side-effecting endpoint is POST/DELETE (CSRF-gated), but the wildcard buys
//     nothing here: neither installed bundle references an external image host
//     (grepped — Hermes has none at all), and one an upstream DECLARES still
//     survives the intersection. Single-origin keeps it: there the frame is
//     same-origin and could read the bytes outright, so the oracle is moot.
//   • font-src keeps `https:`: webfont fetches are CORS-anonymous, so they carry no
//     cookie and cannot be an oracle — and fonts.gstatic.com breaks visibly.
//   • img-src/font-src carry `https:`: chat avatars and remote webfont files are
//     inert bytes, and blocking them broke visibly. connect-src names no foreign
//     HOST beyond what the upstream itself declares.
//     Its one addition is the ws:// twin of the prefix (root-mounted only), which
//     is the same origin under a scheme CSP will not match implicitly.
// Who may frame us. The cockpit is a different origin now, so it has to be named —
// plus 'self', because an app page nested inside another app page needs EVERY
// ancestor allowed.
function frameAncestors(mount: PolicyMount): string[] {
  return mount.cockpitOrigin ? ["'self'", mount.cockpitOrigin] : ["'none'"];
}

// The ws:// twin of the prefix. CSP matches the SCHEME part literally, so an
// `https://host` source does NOT authorise `wss://host` — a dashboard driven by a
// gateway socket is blocked by a policy that already allows every HTTP call it
// makes to the very same host. This grants no new HOST, only the socket scheme on
// the one origin the frame is already confined to.
const socketOrigin = (url: string): string => url.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");

function ourPolicy(prefixUrl: string, mount: PolicyMount): Policy {
  return new Map([
    ["default-src", [prefixUrl]],
    ["script-src", [prefixUrl, "'unsafe-inline'", "blob:"]],
    ["style-src", [prefixUrl, "'unsafe-inline'"]],
    ["img-src", [prefixUrl, "data:", "blob:"]],
    ["font-src", [prefixUrl, "data:", "https:"]],
    ["media-src", [prefixUrl, "data:", "blob:"]],
    ["worker-src", ["blob:"]],
    ["connect-src", [prefixUrl, socketOrigin(prefixUrl), "data:", "blob:"]],
    ["frame-src", [prefixUrl]],
    ["form-action", [prefixUrl]],
    ["base-uri", [prefixUrl]],
    ["frame-ancestors", frameAncestors(mount)],
    ["object-src", ["'none'"]],
  ]);
}

// One directive is ours no matter what the upstream says: being framed by the cockpit
// is the reason this proxy exists, so an upstream `frame-ancestors 'none'` can never
// win. base-uri is NOT ours — nothing injects `<base href>` any more, so OpenClaw's
// `base-uri 'none'` is honoured: strictly tighter, and the policy its own deployment
// already runs under.
const oursWin = (name: string): boolean => name === "frame-ancestors";

// Fetch directives fall back to default-src when absent (CSP3 §6.1), so OpenClaw's
// `default-src 'self'` constrains our frame-src too. form-action/base-uri/
// frame-ancestors never fall back: an upstream that omits them constrains nothing.
const FALLS_BACK = new Set([
  "script-src",
  "style-src",
  "img-src",
  "font-src",
  "media-src",
  "connect-src",
  "worker-src",
  "frame-src",
  "object-src",
]);

// Where an upstream-declared external host is honoured rather than blocked: the
// upstream declares it because its own UI needs it (fonts.googleapis.com,
// api.openai.com, tweakcn.com). Bounded to https hosts that are not our own origin.
const HONOUR_EXTERNAL = new Set(["style-src", "font-src", "img-src", "media-src", "connect-src"]);
const PINNABLE = new Set(["script-src", "style-src"]);

const isPinned = (src: string) => /^'(?:sha(?:256|384|512)-|nonce-)/i.test(src);
const isNonce = (src: string) => /^'nonce-/i.test(src);
// Only a HASH may be copied out of the upstream policy. A nonce-source matches a
// script ELEMENT by its nonce attribute whatever its URL, so copying one would let
// the upstream load script from any origin inside the frame — the exact thing the
// path scoping exists to stop. A hash only matches content the upstream authored.
const isHash = (src: string) => /^'sha(?:256|384|512)-/i.test(src);
const isScheme = (src: string) => /^[a-z][a-z0-9+.\-]*:$/i.test(src);

// hostname, not host: `URL.host` carries the port, and cookies are port-agnostic,
// so `https://mso.example.com:8443` must still count as our own origin. Trailing
// dot is the same name to DNS.
const canonHost = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/\.$/, "").toLowerCase();
  } catch {
    return null;
  }
};

const sameHost = (src: string, prefixUrl: string): boolean => {
  const host = canonHost(src);
  return host !== null && host === canonHost(prefixUrl);
};

function survives(src: string, theirs: string[], prefixUrl: string): boolean {
  if (src === "'none'") return true;
  const lower = theirs.map((token) => token.toLowerCase());
  if (isScheme(src)) return lower.includes(src.toLowerCase());
  if (src.startsWith("'")) {
    // A hash or nonce anywhere in the upstream list makes 'unsafe-inline' inert
    // (CSP2 §7.3.1), so it cannot be what keeps an inline script alive either.
    return lower.includes(src.toLowerCase()) && !theirs.some(isPinned);
  }
  // Our path-scoped source: only if the upstream permits same-origin loads at all.
  if (lower.includes("'self'")) return true;
  if (lower.includes(prefixUrl.slice(0, prefixUrl.indexOf(":") + 1).toLowerCase())) return true;
  return theirs.some((token) => sameHost(token, prefixUrl));
}

// An upstream can rewrite its own policy at will, so a honoured source is capped:
// https only, no wildcards, and NEVER our own origin — `connect-src
// https://mso.example.com` from a compromised upstream would hand its JS
// /api/v1/exec, which is the one thing the scoping exists to prevent. The cockpit
// is excluded separately because root-mounted it is no longer the same host as
// prefixUrl, so `sameHost` alone would let the upstream name it.
const honoured = (src: string, prefixUrl: string, cockpit?: string | null): boolean =>
  /^https:\/\/[^\s'"*]+$/i.test(src) &&
  !sameHost(src, prefixUrl) &&
  !(cockpit ? sameHost(src, cockpit) : false);

// Only the directives we emit are intersected — an upstream `script-src-elem` or
// `sandbox` is not carried over (our own default-src still bounds every fetch
// directive it could stand in for).
function intersect(name: string, mine: string[], up: Policy, prefixUrl: string, mount: PolicyMount): string[] {
  const theirs = up.get(name) ?? (FALLS_BACK.has(name) ? up.get("default-src") : undefined);
  // Absent, or `*`: the upstream constrains nothing here, so ours is the policy.
  if (!theirs || theirs.includes("*")) return mine;
  // A nonce policy is unintersectable: the nonce cannot be copied (see isHash) and
  // dropping it would leave 'none', killing the app's own scripts. Ours governs.
  if (PINNABLE.has(name) && theirs.some(isNonce)) return mine;
  const kept = mine.filter((src) => survives(src, theirs, prefixUrl));
  const added = theirs.filter(
    (src) =>
      (PINNABLE.has(name) && isHash(src)) ||
      (HONOUR_EXTERNAL.has(name) && honoured(src, prefixUrl, mount.cockpitOrigin)),
  );
  const merged = [...new Set([...kept, ...added])];
  return merged.length ? merged : ["'none'"];
}

// A comma in the header means several policies, every one of them enforced
// (CSP3 §8.1), so each is intersected in turn. Fragments that parse as junk carry
// directive names we never emit, so they drop out on their own.
function parsePolicies(raw: string): Policy[] {
  return raw.split(",").map((one) => {
    const policy: Policy = new Map();
    for (const part of one.split(";")) {
      const tokens = part.trim().split(/\s+/).filter(Boolean);
      const name = tokens.shift()?.toLowerCase();
      if (name && !policy.has(name)) policy.set(name, tokens);
    }
    return policy;
  });
}

export function contentSecurityPolicy(
  prefixUrl: string,
  upstream?: string | null,
  mount: PolicyMount = {},
): string {
  let policy = ourPolicy(prefixUrl, mount);
  for (const theirs of upstream ? parsePolicies(upstream) : []) {
    policy = new Map(
      [...policy].map(([name, sources]) => [
        name,
        oursWin(name) ? sources : intersect(name, sources, theirs, prefixUrl, mount),
      ]),
    );
  }
  return [...policy].map(([name, sources]) => [name, ...sources].join(" ")).join("; ");
}
