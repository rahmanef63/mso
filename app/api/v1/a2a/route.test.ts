import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET, mocks, POST, post } from "./route-fixture";

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
});
