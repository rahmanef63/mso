// Pre-deploy smoke test — vitest, not Playwright. Hits the most critical
// HTTP surface of a running production server to catch the classes of bugs
// the CLAUDE.md deploy notes call out: stale chunk MIME, version pipeline,
// auth gate, basic API liveness.
//
// HOW TO RUN
//   bun run vitest run scripts/e2e/smoke.test.ts
// requires:
//   E2E_BASE_URL=http://localhost:4005   (or wherever the prod build serves)
//
// `describe.skipIf` makes this a no-op in `bun run test` unless E2E_BASE_URL is
// set. The CI hook (scripts/ci.sh) opts in post-deploy.

import { describe, expect, it } from "vitest";

const BASE = process.env.E2E_BASE_URL ?? "";
const skip = !BASE;

async function get(path: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5_000);
  try {
    return await fetch(`${BASE}${path}`, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// The describe label is the skip reason the user sees in the vitest report when
// E2E_BASE_URL is unset — it tells them WHY the suite is skipped + how to opt
// in, instead of a silent "(skipped)" with no breadcrumb.
describe.skipIf(skip)(
  skip
    ? "[smoke] SKIPPED — set E2E_BASE_URL=http://host:port to enable live deploy probe"
    : `[smoke] live deploy probe @ ${BASE}`,
  () => {
  it.skipIf(skip)("GET /api/auth/me returns 200 or 401 — never crashes", async () => {
    const res = await get("/api/auth/me");
    expect([200, 401]).toContain(res.status);
    // Body should be JSON-parseable regardless of auth state.
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  // /api/health, NOT /api/version — and /api/v1/sys/stats, NOT /api/v1/sys/cpu.
  // Neither of those two ever existed in this repo (no git history for either path),
  // so half of this deploy gate had been asserting 404 == 200 since it was written:
  // it reported failure on every run, which is exactly how a gate stops being run.
  it.skipIf(skip)("GET /api/health returns JSON with buildId", async () => {
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { buildId?: unknown };
    expect(typeof body.buildId).toBe("string");
    expect((body.buildId as string).length).toBeGreaterThan(0);
  });

  it.skipIf(skip)("GET /api/v1/sys/stats without auth returns 401 (gate working)", async () => {
    const res = await get("/api/v1/sys/stats");
    // Auth gate is healthy when an unauthenticated probe returns 401.
    // Accept 403 too in case the gate evolves to "forbidden".
    expect([401, 403]).toContain(res.status);
  });

  it.skipIf(skip)("every root-referenced _next/static JS/CSS asset serves with correct MIME", async () => {
    const homeRes = await get("/");
    expect(homeRes.status).toBe(200);
    const html = await homeRes.text();
    const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)<>]+\.(?:js|css)(?:\?[^"'\s)<>]*)?/g) ?? [])];
    expect(assets.length, "no _next/static JS/CSS assets found in home HTML").toBeGreaterThan(0);
    expect(assets.length).toBeLessThanOrEqual(120);
    for (const asset of assets) {
      const res = await get(asset, { method: "HEAD" });
      expect(res.status, asset).toBe(200);
      const ct = (res.headers.get("content-type") ?? "").toLowerCase();
      expect(ct, asset).toContain(asset.split("?", 1)[0].endsWith(".css") ? "text/css" : "javascript");
    }
  });
  },
);
