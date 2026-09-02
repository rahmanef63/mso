import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  discover: vi.fn(),
  register: vi.fn(),
  remove: vi.fn(),
  resolve: vi.fn(),
  send: vi.fn(),
  stream: vi.fn(),
  get: vi.fn(),
  cancel: vi.fn(),
  handoff: vi.fn(),
  audit: vi.fn(),
  rate: vi.fn(),
  listCreds: vi.fn(),
  getCred: vi.fn(),
  createCred: vi.fn(),
  removeCred: vi.fn(),
  setCred: vi.fn(),
  listInbound: vi.fn(),
  createInbound: vi.fn(),
  removeInbound: vi.fn(),
  tasksOwner: vi.fn(),
  auditTail: vi.fn(),
  resolveBinding: vi.fn(),
  localSessions: vi.fn(),
  localResolve: vi.fn(),
  localHandoff: vi.fn(),
  localSpawn: vi.fn(),
}));
vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: vi.fn(async () => ({
    role: "owner",
    session: { device_id: "cli-test" },
  })),
}));
vi.mock("@/lib/a2a", () => ({
  listA2AAgents: mocks.list,
  discoverA2AAgent: mocks.discover,
  registerA2AAgent: mocks.register,
  removeA2AAgent: mocks.remove,
  resolveA2AAgent: mocks.resolve,
  sendA2AMessage: mocks.send,
  sendA2AStreamingMessage: mocks.stream,
  getA2ATask: mocks.get,
  cancelA2ATask: mocks.cancel,
  handoffA2A: mocks.handoff,
  listA2AOutboundCredentials: mocks.listCreds,
  getA2AOutboundCredential: mocks.getCred,
  createA2AOutboundCredential: mocks.createCred,
  removeA2AOutboundCredential: mocks.removeCred,
  setA2AAgentCredential: mocks.setCred,
  listA2AInboundTokens: mocks.listInbound,
  createA2AInboundToken: mocks.createInbound,
  removeA2AInboundToken: mocks.removeInbound,
  listA2ATasksOwner: mocks.tasksOwner,
  resolveA2ACredentialBinding: mocks.resolveBinding,
  listA2ALocalSessions: mocks.localSessions,
  resolveA2ALocalSession: mocks.localResolve,
  handoffA2ALocalSession: mocks.localHandoff,
  spawnA2ALocalSubagent: mocks.localSpawn,
}));
vi.mock("@/lib/host", () => ({
  audit: mocks.audit,
  rateLimited: mocks.rate,
  readAuditTail: mocks.auditTail,
  readJson: async (req: Request) => req.json().catch(() => null),
}));

const { GET, POST } = await import("./route");
const post = (body: object) =>
  new NextRequest("http://localhost/api/v1/a2a", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rate.mockReturnValue(false);
  mocks.resolve.mockResolvedValue({ card: { name: "Peer" } });
  mocks.list.mockResolvedValue([]);
  mocks.listCreds.mockResolvedValue([]);
  mocks.listInbound.mockResolvedValue([]);
  mocks.tasksOwner.mockResolvedValue([]);
  mocks.auditTail.mockResolvedValue([]);
  mocks.resolveBinding.mockReturnValue({});
  mocks.localSessions.mockResolvedValue([]);
  mocks.localResolve.mockResolvedValue({ id: "local-session", title: "bece" });
  mocks.localHandoff.mockResolvedValue({
    session: { id: "local-session", title: "bece" },
    task: { id: "local-task", artifacts: [] },
  });
  mocks.localSpawn.mockResolvedValue({
    session: { id: "child-session", title: "reviewer" },
    task: { id: "child-task", artifacts: [] },
  });
});

describe("A2A CLI API", () => {
  it("lists and discovers agents", async () => {
    mocks.list.mockResolvedValue([{ alias: "peer" }]);
    mocks.discover.mockResolvedValue({ card: { name: "Peer" } });
    expect(
      await (await GET(new NextRequest("http://localhost/api/v1/a2a"))).json(),
    ).toEqual({ agents: [{ alias: "peer" }] });
    const found = await (
      await GET(
        new NextRequest(
          "http://localhost/api/v1/a2a?action=discover&url=https%3A%2F%2Fpeer.example",
        ),
      )
    ).json();
    expect(found.card.name).toBe("Peer");
  });
  it("routes register/send/task/cancel/handoff without adding hidden context", async () => {
    mocks.register.mockResolvedValue({ alias: "peer" });
    mocks.send.mockResolvedValue({ task: { id: "t1" } });
    mocks.get.mockResolvedValue({ id: "t1" });
    mocks.cancel.mockResolvedValue({ id: "t1" });
    mocks.handoff.mockResolvedValue({
      handoff: {},
      response: { task: { id: "t2" } },
    });
    expect(
      (
        await POST(
          post({
            action: "register",
            url: "https://peer.example",
            alias: "peer",
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await POST(post({ action: "send", target: "peer", message: "hello" })))
        .status,
    ).toBe(200);
    expect(mocks.send.mock.calls[0][1]).toBe("hello");
    const task = await GET(
      new NextRequest(
        "http://localhost/api/v1/a2a?action=task&target=peer&taskId=t1",
      ),
    );
    expect(task.status).toBe(200);
    expect(
      (await POST(post({ action: "cancel", target: "peer", taskId: "t1" })))
        .status,
    ).toBe(200);
    expect(
      (
        await POST(
          post({
            action: "handoff",
            target: "peer",
            objective: "research",
            context: "only this",
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.handoff.mock.calls[0][1]).toBe("research");
    expect(mocks.handoff.mock.calls[0][2]).toBe("only this");
  });
  it("returns owner A2A state without credential secrets and manages profiles", async () => {
    mocks.list.mockResolvedValue([
      {
        id: "peer-1",
        alias: "peer",
        card: { securitySchemeNames: [], securitySchemes: {} },
      },
    ]);
    mocks.listCreds.mockResolvedValue([
      { id: "cred-1", agentId: "peer-1", label: "prod", kind: "bearer" },
    ]);
    const state = await (
      await GET(new NextRequest("http://localhost/api/v1/a2a?action=state"))
    ).json();
    expect(state.credentials[0]).not.toHaveProperty("secret");
    mocks.createCred.mockResolvedValue({
      id: "cred-2",
      agentId: "peer-1",
      label: "new",
      kind: "bearer",
    });
    mocks.setCred.mockResolvedValue({
      id: "peer-1",
      credentialProfileId: "cred-2",
    });
    const created = await POST(
      post({
        action: "credential-create",
        agentId: "peer-1",
        label: "new",
        kind: "bearer",
        secret: "top-secret",
      }),
    );
    expect(created.status).toBe(200);
    expect(mocks.createCred).toHaveBeenCalledWith(
      expect.objectContaining({ secret: "top-secret" }),
    );
    expect(mocks.audit.mock.calls.flat().join(" ")).not.toContain("top-secret");
    mocks.createInbound.mockResolvedValue({
      token: "mso_a2a_once",
      profile: { id: "in-1", label: "peer", scope: "read" },
    });
    const inbound = await (
      await POST(
        post({ action: "inbound-token-create", label: "peer", scope: "read" }),
      )
    ).json();
    expect(inbound.token).toBe("mso_a2a_once");
  });
  it("routes same-host session list, handoff, spawn, and inbox without exposing credentials", async () => {
    mocks.localSessions.mockResolvedValue([
      { id: "local-session", title: "bece", cwd: "/srv/bece" },
    ]);
    const listed = await (
      await GET(
        new NextRequest("http://localhost/api/v1/a2a?action=local-sessions"),
      )
    ).json();
    expect(listed.sessions[0].title).toBe("bece");

    const handoff = await POST(
      post({
        action: "local-handoff",
        sessionRef: "bece",
        objective: "review this",
      }),
    );
    expect(handoff.status).toBe(200);
    expect(mocks.localHandoff).toHaveBeenCalledWith("bece", "review this");

    const spawn = await POST(
      post({
        action: "local-spawn",
        sourceSessionRef: "bece",
        objective: "audit this",
        title: "reviewer",
      }),
    );
    expect(spawn.status).toBe(200);
    expect(mocks.localSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerPrincipal: "cli:cli-test",
        sourceSessionRef: "bece",
        objective: "audit this",
        title: "reviewer",
      }),
    );

    mocks.tasksOwner.mockResolvedValue([
      { id: "for-bece", targetSessionId: "local-session" },
      { id: "other", targetSessionId: "other-session" },
    ]);
    const inbox = await (
      await GET(
        new NextRequest(
          "http://localhost/api/v1/a2a?action=local-inbox&session=bece",
        ),
      )
    ).json();
    expect(inbox.tasks).toEqual([
      { id: "for-bece", targetSessionId: "local-session" },
    ]);
  });
});
