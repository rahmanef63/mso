import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAdapter } from "./http-adapter";

// The managed-app calls are the one place in this adapter where the wire shape and
// the port shape genuinely disagree, and the disagreement is INVISIBLE to tsc: `req`
// is generic, so whatever type the call site claims is what TypeScript believes the
// route sent. That is how two separate shipped bugs hid here — an envelope that was
// never unwrapped (`.length` of an object → Alfa reporting "no managed applications
// on this host") and a `running` boolean the routes have never sent at all
// (`ManagedAppView` carries a `state` enum) → "stopped" right after a start that
// worked. Both were reported to the operator as fact by an AI tool. Only a test that
// feeds the ROUTE's literal JSON can catch the next one.
function mockFetch(payload: unknown) {
  // The `url` parameter is declared even though the body ignores it: without it
  // `mock.calls` types as an empty tuple and the URL assertions below fail to
  // compile (TS2493), which is how the url-drift half of this test gets its teeth.
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

const view = (id: string, state: string) => ({
  id,
  name: id === "hermes" ? "Hermes" : "OpenClaw",
  description: "",
  installed: true,
  installationType: "systemd",
  state,
  healthy: state === "running",
  version: null,
  dashboardAvailable: state === "running",
  publicDashboardUrl: null,
  diagnostic: null,
  supportedActions: ["start", "stop", "restart", "backup"],
});

describe("HttpAdapter — managed apps", () => {
  const api = HttpAdapter({ url: "" });

  it("unwraps the {apps:[…]} envelope GET /api/v1/managed-apps actually sends", async () => {
    const f = mockFetch({ apps: [view("hermes", "running"), view("openclaw", "stopped")] });
    const apps = await api.apps.list();
    expect(f.mock.calls[0]?.[0]).toBe("/api/v1/managed-apps");
    expect(apps).toHaveLength(2);
    expect(apps.map((a) => a.running)).toEqual([true, false]);
  });

  it("counts unhealthy and starting as running", async () => {
    // Not a naming quibble. `unhealthy` is a live unit failing its /health probe and
    // `starting` is one mid-start; calling either "stopped" tells the operator to go
    // restart a daemon that is already up.
    mockFetch({ apps: [view("hermes", "unhealthy"), view("openclaw", "starting")] });
    expect((await api.apps.list()).map((a) => a.running)).toEqual([true, true]);
  });

  it("unwraps {app:{…}} from a power action and reports post-action liveness", async () => {
    const f = mockFetch({ app: view("hermes", "running") });
    const app = await api.apps.power("hermes", "start");
    expect(f.mock.calls[0]?.[0]).toBe("/api/v1/managed-apps/hermes");
    // `name` undefined here was the model saying "undefined: stopped (after start)".
    expect(app.name).toBe("Hermes");
    expect(app.running).toBe(true);
  });

  it("surfaces the route's own error message, not the bare status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "managed application operation failed" }), { status: 409 }),
    ));
    await expect(api.apps.power("hermes", "restart")).rejects.toThrow("managed application operation failed");
  });
});


describe("HttpAdapter — project candidates", () => {
  const api = HttpAdapter({ url: "" });

  it("uses the bounded read route and preserves cursor/truncation metadata", async () => {
    const payload = {
      project: { id: "root/mso", name: "mso", path: "/srv/mso" },
      revision: "rev",
      rebuilt: false,
      reusedSeed: false,
      indexedEntries: 12,
      candidates: [{ path: "lib/workflow/replay.ts", kind: "path", size: 120, score: 1 }],
      matches: [{ path: "lib/workflow/replay.ts", line: 10, preview: "bounded replay" }],
      truncated: true,
      truncationReasons: ["page"],
      cursor: "next-page",
    };
    const f = mockFetch(payload);
    const result = await api.projects.candidateSearch("root/mso", "bounded replay", 12, "cursor-1");
    const url = String(f.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/api/v1/projects/candidates?");
    expect(url).toContain("project=root%2Fmso");
    expect(url).toContain("q=bounded+replay");
    expect(url).toContain("limit=12");
    expect(url).toContain("cursor=cursor-1");
    expect(result).toEqual(payload);
  });
});
