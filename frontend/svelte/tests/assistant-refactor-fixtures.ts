// Fixtures for assistant-refactor.test.ts. Kept beside the test so the test
// file stays inside the repository's 220-line physical line ratchet.

const enc = new TextEncoder();

export const signal = new AbortController().signal;

export function sse(chunks: string[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
  );
}

export const createCockpitFetcher = (): typeof fetch => async (input, init) => {
  const url = String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  if (url === "/api/threads" && method === "GET") {
    return Response.json({ threads: [{ id: "t1", title: "Deploy check", createdAt: 1000, updatedAt: 2000 }] });
  }
  if (url === "/api/threads?id=t1" && method === "GET") {
    return Response.json({
      id: "t1",
      title: "Deploy check",
      createdAt: 1000,
      updatedAt: 2000,
      messages: [{ id: "m1", role: "user", text: "hi" }],
      history: [{ role: "user", text: "hi" }],
    });
  }
  if (url === "/api/threads" && method === "POST") return Response.json({ ok: true, id: "t1" });
  if (url === "/api/threads" && method === "PATCH") {
    return Response.json({ ok: true, thread: { id: "t1", title: "Renamed", createdAt: 1000, updatedAt: 3000 } });
  }
  if (url === "/api/threads?id=t1" && method === "DELETE") return Response.json({ ok: true });
  if (url === "/api/v1/agent-profiles") {
    return Response.json({
      store: {
        version: 1,
        revision: 1,
        defaultProfileId: "p1",
        profiles: [{
          id: "p1",
          revision: 2,
          enabled: true,
          config: {
            name: "Ops Reader",
            avatar: "O",
            instructions: "Read only",
            runtime: "mso-readonly",
            model: { provider: "anthropic", model: "claude-sonnet" },
            tools: ["vps_status"],
          },
        }],
      },
    });
  }
  if (url === "/api/v1/agent-profiles/run") {
    return Response.json({
      runId: "r1",
      profileId: "p1",
      profileRevision: 2,
      status: "completed",
      text: "Host healthy",
      rounds: 1,
      toolCalls: [{ name: "vps_status", ok: true }],
    });
  }
  if (url === "/api/v1/agent-tools") {
    return Response.json({ scope: "read", tools: [{ name: "vps_status", description: "Host stats", scope: "read", approvalRequired: false }] });
  }
  if (url.startsWith("/api/v1/agent-sessions")) {
    return Response.json({ sessions: [{ id: "s1", title: "CLI run", source: "cli", eventCount: 4, estimatedTokens: 120 }] });
  }
  if (url === "/api/v1/alfa/cockpit") {
    return Response.json({
      model: { provider: "anthropic", model: "claude-sonnet" },
      projects: { total: 3, rows: [] },
      sessions: [{ id: "s1" }],
      localAgents: [{ id: "a1" }],
      legacyMemoryCount: 2,
    });
  }
  return new Response("Not Found", { status: 404 });
};

export type ControllerCalls = {
  fetcher: typeof fetch;
  savedBodies: unknown[];
  deletedUrls: string[];
  assistantBodies: Array<Record<string, unknown>>;
};

export function createControllerFetcher(): ControllerCalls {
  const savedBodies: unknown[] = [];
  const deletedUrls: string[] = [];
  const assistantBodies: Array<Record<string, unknown>> = [];

  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/api/threads" && method === "GET") return Response.json({ threads: [] });
    if (url === "/api/threads" && method === "POST") {
      savedBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return Response.json({ ok: true, id: "t-new" });
    }
    if (url.startsWith("/api/threads?id=") && method === "DELETE") {
      deletedUrls.push(url);
      return Response.json({ ok: true });
    }
    if (url === "/api/v1/agent-profiles") {
      return Response.json({
        store: {
          version: 1,
          revision: 1,
          defaultProfileId: "p1",
          profiles: [{
            id: "p1",
            revision: 3,
            enabled: true,
            config: {
              name: "Audit Bot",
              avatar: "",
              instructions: "Inspect",
              runtime: "mso-readonly",
              model: { provider: "openai", model: "gpt-4o" },
              tools: ["vps_status"],
            },
          }],
        },
      });
    }
    if (url === "/api/v1/agent-profiles/run") {
      return Response.json({
        runId: "run-9",
        profileId: "p1",
        profileRevision: 3,
        status: "completed",
        text: "Profile check passed.",
        rounds: 1,
        toolCalls: [{ name: "vps_status", ok: true }],
      });
    }
    if (url === "/api/v1/agent-tools") return Response.json({ scope: "read", tools: [] });
    if (url.startsWith("/api/v1/agent-sessions")) return Response.json({ sessions: [] });
    if (url === "/api/v1/alfa/cockpit") return new Response("Not Found", { status: 404 });
    if (url === "/api/assistant") {
      assistantBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return sse([
        'event: tool_use\ndata: {"id":"tc1","name":"fs_list"}\n\n',
        'event: delta\ndata: "Listed projects."\n\n',
        'event: done\ndata: {"stopReason":"end_turn"}\n\n',
      ]);
    }
    return new Response("Not Found", { status: 404 });
  };

  return { fetcher, savedBodies, deletedUrls, assistantBodies };
}
