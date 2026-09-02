import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentApiError } from "./mso-agent-errors.mjs";
import { api } from "./mso-agent-runtime.mjs";

afterEach(() => vi.unstubAllGlobals());

describe("MSO Agent API error metadata", () => {
  it("keeps HTTP status/path and marks an HTTP response as dispatched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "bad request" }), {
      status: 400, headers: { "content-type": "application/json" },
    })));
    let caught: any;
    try { await api("/api/test"); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AgentApiError);
    expect(caught).toMatchObject({ status: 400, path: "/api/test", method: "GET", requestDispatched: true });
  });

  it("marks a transport failure before a response as dispatch-unconfirmed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket closed"); }));
    let caught: any;
    try { await api("/api/test", { method: "POST", body: "{}" }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AgentApiError);
    expect(caught).toMatchObject({ status: null, path: "/api/test", method: "POST", requestDispatched: false });
  });
});
