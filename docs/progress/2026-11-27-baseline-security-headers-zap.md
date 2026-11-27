# 2026-11-27 — Restore baseline security headers and refresh the ZAP review scope

The scheduled `OWASP ZAP Baseline` run on `main` had been failing closed since the
Svelte cutover. Its `Require only reviewed passive findings` step rejected the report
with `ZAP report contains an unreviewed alert rule: 10063`, and 10021, 10035 and 10050
were queued behind it.

## Root cause

`next.config.mjs` was the only place that set `X-Content-Type-Options`,
`Strict-Transport-Security`, `Permissions-Policy` and `X-Robots-Tag`. The cutover that
removed Next.js deleted that file and nothing replaced it, so production served the
document, the immutable chunks and every 404 without them. `proxy.ts` sets the CSP and,
for API and viewer routes, its own copies; the two header sets never covered the same
responses.

Three secondary staleness bugs were in the report validator itself:

- `STATIC_CACHE_PATHS` still listed `/_next/static/chunks/*.js`, `/*.css` and
  `/_next/static/media/*.woff2`. The SvelteKit build emits
  `/_app/immutable/{chunks,entry,nodes,assets}/<hash>.{js,css,woff2}`, so every real
  cache hit was "outside the reviewed static-asset scope".
- `10109 Modern Web Application` was not in `security/zap-baseline.conf`, so the pass
  could not accept a report that names it even though the AJAX Spider observation has
  no bearing on a passive baseline.
- A router miss answered `404` with no cache directive, and Cloudflare stores that with
  its own Browser Cache TTL, so the next probe hits cache as rule 10050.

## Change

- `scripts/server-headers.mjs` (new) — one table of baseline headers and
  `applyBaselineSecurityHeaders()`, which fills only names a response did not set.
  `clipboard-write=(self)` stays because the copy buttons call
  `navigator.clipboard.writeText`; camera, microphone, geolocation, payment, usb, serial
  and hid are denied.
- `scripts/server.mjs` — applies the table at the single point a `Response` leaves the
  server, so the document, static assets, 404s and errors all carry it, while the noVNC
  viewer keeps its deliberately narrower `Permissions-Policy`.
- `lib/http/router.ts` — a miss is served `Cache-Control: no-store`.
- `scripts/check-zap-report.mjs` — the reviewed immutable scope is now SvelteKit's
  `/_app/immutable/*`; the dead `/_next/static/*` shapes are rejected.
- `security/zap-baseline.conf` — `10109` added as `INFO` with its rationale.
- `docs/SECURITY-ASSURANCE.md` — records the new scope and where the headers live.

## Verification

Local production build, then a real pinned ZAP baseline against it:

```
bash scripts/build-safe.sh
node scripts/server.mjs --hostname 127.0.0.1 --port 4319
docker run --rm --network host -v /tmp/opencode/zapscan2:/zap/wrk/:rw \
  ghcr.io/zaproxy/zaproxy@sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef \
  zap-baseline.py -t http://127.0.0.1:4319 -m 2 -c /zap/wrk/zap-baseline.conf -J report.json
```

`FAIL-NEW: 0  WARN-NEW: 0  INFO: 4  PASS: 64`. Feeding that report to the gate (with
the host normalized to an HTTPS target) returns
`ZAP report accepted: 1 site(s), 10 reviewed INFO alert group(s)`. The pre-fix
production report is still rejected on `10063`, which is the regression lock.

Header proof on the local build, all three response classes:

```
$ curl -sD- -o /dev/null http://127.0.0.1:4319/
permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), clipboard-write=(self)
strict-transport-security: max-age=31536000
x-content-type-options: nosniff
x-robots-tag: noindex, nofollow, noarchive

$ curl -sD- -o /dev/null http://127.0.0.1:4319/robots.txt
HTTP/1.1 404 Not Found
cache-control: no-store
permissions-policy: ...
strict-transport-security: max-age=31536000
x-content-type-options: nosniff
```

`node scripts/run-smart-gate.mjs --pr-fast` passes. `scripts/server-headers.test.ts` is
new and asserts the three ZAP-relevant headers, that a route's own value wins, and that
`scripts/server.mjs` applies them at the exit point.

## Remaining

- The scheduled run only proves this after merge and a fresh dispatch of `dast.yml`;
  `workflow_dispatch` was not run here.
- `dast.yml` still scans whatever `vars.MSO_DAST_URL` names. Nothing changed about who
  authorizes that target.
- Browser pointer journeys for the image editor, inherited from the earlier refactor
  threads, remain unverified.
