import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET, mocks, POST, post } from "./route-fixture";

describe("A2A owner and local access", () => {
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
    expect(mocks.localHandoff).toHaveBeenCalledWith(
      "bece",
      "review this",
      expect.objectContaining({ list: expect.any(Function), invoke: expect.any(Function) }),
    );

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
