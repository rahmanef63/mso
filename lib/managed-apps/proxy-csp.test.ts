// The containment policy, and the intersection that keeps the upstream's own
// hardening. The OpenClaw fixture below is verbatim from a live
// `curl -D- http://127.0.0.1:18789/` HTML response — that is the policy the merge
// has to be right about.
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./proxy-csp";

// The app is always root-mounted on its own host now; the cockpit is the framer.
const PREFIX_URL = "https://hermes.mso.example.com/";
const COCKPIT = "https://mso.example.com";
const MOUNT = { cockpitOrigin: COCKPIT };

const OPENCLAW =
  "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; " +
  "script-src 'self' 'sha256-xlWU9W5DLkdwhgKfV5ywIgqPfePNDkqtaKOBVD1gkB4=' 'sha256-YE++OxiPw+vXrIb7PDq83l6z34Hi3wFFCJVdIBVD5zU='; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; " +
  "media-src 'self' data: blob:; font-src 'self' https://fonts.gstatic.com; worker-src 'self'; " +
  "connect-src 'self' ws: wss: https://api.openai.com https://tweakcn.com";

const SOCKET = "wss://hermes.mso.example.com/";

const directive = (csp: string, name: string) =>
  csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.split(" ")[0] === name)!;

describe("contentSecurityPolicy without an upstream policy (Hermes sends none)", () => {
  const csp = contentSecurityPolicy(PREFIX_URL, undefined, MOUNT);

  it("keeps the host API out of every fetch directive", () => {
    // A source ending in "/" matches by path prefix, so /api/v1/exec — same
    // origin, reachable with the cockpit session — is not a legal target.
    for (const name of ["default-src", "connect-src", "form-action", "base-uri", "frame-src"]) {
      expect(directive(csp, name)).toContain(PREFIX_URL);
    }
    expect(directive(csp, "connect-src")).toBe(`connect-src ${PREFIX_URL} wss://hermes.mso.example.com/ data: blob:`);
    expect("https://mso.example.com/api/v1/exec".startsWith(PREFIX_URL)).toBe(false);
    expect("https://mso.example.com/api/v1/term".startsWith(PREFIX_URL)).toBe(false);
  });

  it("never grants 'self' — that would re-open the origin via a nested iframe", () => {
    expect(csp.replace(`frame-ancestors 'self' ${COCKPIT}`, "")).not.toContain("'self'");
    expect(directive(csp, "frame-src")).toBe(`frame-src ${PREFIX_URL}`);
    expect(csp).toContain("object-src 'none'");
  });

  it("still allows what an unpoliced upstream needs, and pins no hash", () => {
    // Hermes' /login ships an inline <script>; a hash would make 'unsafe-inline'
    // inert (CSP2 §7.3.1) and kill it, so nothing may be pinned here.
    expect(directive(csp, "script-src")).toBe(`script-src ${PREFIX_URL} 'unsafe-inline' blob:`);
    expect(directive(csp, "style-src")).toBe(`style-src ${PREFIX_URL} 'unsafe-inline'`);
    expect(csp).not.toContain("sha256-");
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it("grants no 'unsafe-eval' — neither bundle contains eval or new Function", () => {
    expect(csp).not.toContain("unsafe-eval");
  });

  it("allows workers only from blob:, which no service worker can be", () => {
    expect(directive(csp, "worker-src")).toBe("worker-src blob:");
    expect(directive(csp, "worker-src")).not.toContain(PREFIX_URL);
  });

  it("permits https: fonts but never https: images or connections", () => {
    // Root-mounted, img-src drops the blanket `https:` it carried under a path scope:
    // the frame is a whole origin now, and an image URL is an exfiltration channel.
    expect(directive(csp, "img-src")).toBe(`img-src ${PREFIX_URL} data: blob:`);
    expect(directive(csp, "font-src")).toBe(`font-src ${PREFIX_URL} data: https:`);
    const wildcarded = csp
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.split(/\s+/).includes("https:"))
      .map((part) => part.split(" ")[0]);
    expect(wildcarded).toEqual(["font-src"]);
  });
});

describe("contentSecurityPolicy intersected with the live OpenClaw policy", () => {
  const csp = contentSecurityPolicy(PREFIX_URL, OPENCLAW, MOUNT);

  it("adopts the upstream's inline-script pins instead of 'unsafe-inline'", () => {
    const script = directive(csp, "script-src");
    expect(script).toContain("'sha256-xlWU9W5DLkdwhgKfV5ywIgqPfePNDkqtaKOBVD1gkB4='");
    expect(script).toContain("'sha256-YE++OxiPw+vXrIb7PDq83l6z34Hi3wFFCJVdIBVD5zU='");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("blob:"); // upstream never granted it
    expect(script.startsWith(`script-src ${PREFIX_URL} `)).toBe(true);
  });

  it("honours the external https hosts the upstream declares for itself", () => {
    expect(directive(csp, "style-src")).toBe(`style-src ${PREFIX_URL} 'unsafe-inline' https://fonts.googleapis.com`);
    expect(directive(csp, "font-src")).toBe(`font-src ${PREFIX_URL} https://fonts.gstatic.com`);
    expect(directive(csp, "connect-src")).toBe(
      `connect-src ${PREFIX_URL} wss://hermes.mso.example.com/ https://api.openai.com https://tweakcn.com`,
    );
    // The upstream's bare `wss:` is not copied — it would be every host on earth.
    // The only socket source is the app's OWN origin, added by us: CSP matches the
    // scheme literally, so the https source does not authorise the dashboard's socket.
    expect(csp).not.toContain(" wss: ");
    expect(directive(csp, "connect-src").split(" ").filter((src) => src.startsWith("wss://"))).toEqual([`${SOCKET}`]);
  });

  it("lets the tighter policy win where the upstream is stricter than us", () => {
    expect(directive(csp, "img-src")).toBe(`img-src ${PREFIX_URL} data: blob:`); // https: dropped
    expect(directive(csp, "media-src")).toBe(`media-src ${PREFIX_URL} data: blob:`);
    // `worker-src 'self'` ∩ `worker-src blob:` is empty — tighter than either.
    expect(directive(csp, "worker-src")).toBe("worker-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("keeps frame-ancestors ours, and lets the upstream tighten base-uri", () => {
    // `frame-ancestors 'none'` is why the proxy exists at all, so it can never win.
    // base-uri IS the upstream's now: nothing injects a <base> any more, so OpenClaw's
    // `base-uri 'none'` is honoured — strictly tighter than naming our own origin.
    expect(directive(csp, "base-uri")).toBe("base-uri 'none'");
    expect(directive(csp, "frame-ancestors")).toBe(`frame-ancestors 'self' ${COCKPIT}`);
    expect(directive(csp, "form-action")).toBe(`form-action ${PREFIX_URL}`);
  });

  it("still never grants 'self', however much the upstream leans on it", () => {
    expect(csp.replace(`frame-ancestors 'self' ${COCKPIT}`, "")).not.toContain("'self'");
    // default-src 'self' upstream, path-scoped here: the host API stays out.
    expect(directive(csp, "default-src")).toBe(`default-src ${PREFIX_URL}`);
    expect(directive(csp, "frame-src")).toBe(`frame-src ${PREFIX_URL}`);
  });
});

describe("contentSecurityPolicy refuses to be widened by the upstream", () => {
  it("never honours our own origin — that is the /api/v1/exec hole itself", () => {
    const csp = contentSecurityPolicy(
      PREFIX_URL,
      "connect-src 'self' https://mso.example.com https://mso.example.com/api/v1/exec",
      MOUNT,
    );
    expect(directive(csp, "connect-src")).toBe(`connect-src ${PREFIX_URL} ${SOCKET}`);
    expect(csp).not.toContain("/api/v1/exec");
  });

  it("ignores wildcard hosts, plain http and non-host sources", () => {
    const csp = contentSecurityPolicy(
      PREFIX_URL,
      "img-src 'self' data: https://*.evil.example http://tracker.example; connect-src 'self' data: blob: 'unsafe-eval'",
      MOUNT,
    );
    expect(directive(csp, "img-src")).toBe(`img-src ${PREFIX_URL} data:`);
    expect(directive(csp, "connect-src")).toBe(`connect-src ${PREFIX_URL} wss://hermes.mso.example.com/ data: blob:`);
    expect(csp).not.toContain("evil.example");
    expect(csp).not.toContain("tracker.example");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("treats a bare `*` upstream directive as no constraint, not as 'none'", () => {
    // `img-src *` is the loosest policy there is; intersecting it to nothing would
    // break every image for no security gain. Ours stays the binding one.
    const csp = contentSecurityPolicy(PREFIX_URL, "default-src 'self'; img-src *", MOUNT);
    expect(directive(csp, "img-src")).toBe(`img-src ${PREFIX_URL} data: blob:`);
  });

  it("enforces every policy in a comma-joined header, not just the first", () => {
    const csp = contentSecurityPolicy(PREFIX_URL, "script-src 'self' 'unsafe-inline',script-src 'self'", MOUNT);
    const script = directive(csp, "script-src");
    // Nothing is injected into the document, so nothing is pinned: the directive is
    // exactly what both policies allow.
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).toBe(`script-src ${PREFIX_URL}`);
  });

  it("keeps 'unsafe-inline' (and pins nothing) when the upstream allows inline too", () => {
    const csp = contentSecurityPolicy(PREFIX_URL, "default-src 'self'; script-src 'self' 'unsafe-inline' blob:", MOUNT);
    expect(directive(csp, "script-src")).toBe(`script-src ${PREFIX_URL} 'unsafe-inline' blob:`);
    expect(csp).not.toContain("sha256-");
  });

  it("collapses to 'none' under a default-src 'none' upstream instead of inventing sources", () => {
    const csp = contentSecurityPolicy(PREFIX_URL, "default-src 'none'", MOUNT);
    expect(directive(csp, "default-src")).toBe("default-src 'none'");
    expect(directive(csp, "img-src")).toBe("img-src 'none'");
    expect(directive(csp, "script-src")).toBe("script-src 'none'");
    // Directives that never fall back to default-src stay ours.
    expect(directive(csp, "form-action")).toBe(`form-action ${PREFIX_URL}`);
    expect(directive(csp, "frame-ancestors")).toBe(`frame-ancestors 'self' ${COCKPIT}`);
  });

  it("never copies an upstream nonce — it would match script from ANY origin", () => {
    const csp = contentSecurityPolicy(PREFIX_URL, "default-src 'self'; script-src 'nonce-abc123' 'strict-dynamic'", MOUNT);
    expect(csp).not.toContain("nonce-");
    // And the app's own scripts must survive: ours governs the directive instead.
    expect(directive(csp, "script-src")).toBe(`script-src ${PREFIX_URL} 'unsafe-inline' blob:`);
  });

  it("treats our own origin on another port, or trailing-dot, as ours — not external", () => {
    const csp = contentSecurityPolicy(
      PREFIX_URL,
      "connect-src 'self' https://mso.example.com:8443 https://mso.example.com./x",
      MOUNT,
    );
    expect(directive(csp, "connect-src")).toBe(`connect-src ${PREFIX_URL} ${SOCKET}`);
  });

  it("survives a malformed prefix URL without throwing", () => {
    expect(() => contentSecurityPolicy("not-a-url", OPENCLAW, MOUNT)).not.toThrow();
  });
});
