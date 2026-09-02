import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(os.tmpdir(), "mso-a2a-server-"));
process.env.OS_A2A_CREDENTIAL_STORE = path.join(root, "outbound.json");
process.env.OS_A2A_INBOUND_TOKEN_STORE = path.join(root, "inbound.json");
process.env.OS_A2A_TASK_STORE = path.join(root, "tasks.json");
process.env.OS_A2A_INBOUND_ENABLED = "1";
process.env.OS_PUBLIC_ORIGIN = "https://mso.example.test";
process.env.NEXT_PUBLIC_OS_DEMO = "0";

const runner = vi.hoisted(() => vi.fn());
vi.mock("./inbound-agent", () => ({ runInboundA2AAgent: runner }));
const { createA2AInboundToken } = await import("./credentials");
const { createA2ATask } = await import("./tasks");
const { handleA2ARequest } = await import("./server");
const { inboundAgentCard } = await import("./inbound-config");

afterAll(() => rmSync(root, { recursive: true, force: true }));

const rpc = (token: string | null, body: object) =>
  new Request("https://mso.example.test/a2a/v1", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

describe("authenticated inbound A2A server", () => {
  it("advertises a secured v1 JSONRPC Agent Card only on the configured HTTPS origin", () => {
    const card = inboundAgentCard();
    expect(card.supportedInterfaces[0]).toEqual({
      url: "https://mso.example.test/a2a/v1",
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
    });
    expect(card.capabilities.streaming).toBe(true);
    expect(card.securityRequirements).toEqual([
      { schemes: { msoBearer: { list: [] } } },
    ]);
  });

  it("requires HTTP Bearer auth before A2A method dispatch", async () => {
    const response = await handleA2ARequest(
      rpc(null, { jsonrpc: "2.0", id: 1, method: "ListTasks", params: {} }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("runs SendMessage in an isolated principal with exactly the credential scope", async () => {
    const { token, profile } = await createA2AInboundToken("writer", "write");
    runner.mockImplementationOnce(async ({ prompt, scope, principal }) => {
      expect(prompt).toBe("inspect this");
      expect(scope).toBe("write");
      expect(principal).toBe(`a2a:${profile.id}`);
      return { text: "done", rounds: 1, toolCalls: [] };
    });
    const response = await handleA2ARequest(
      rpc(token, {
        jsonrpc: "2.0",
        id: "send-1",
        method: "SendMessage",
        params: {
          message: {
            messageId: "m1",
            role: "ROLE_USER",
            parts: [{ text: "inspect this", mediaType: "text/plain" }],
          },
        },
      }),
    );
    const body = await response.json();
    expect(body.result.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(body.result.task.artifacts[0].parts[0].text).toBe("done");
    expect(body.result.task.metadata["mso.scope"]).toBe("write");
  });

  it("isolates task ownership across inbound tokens", async () => {
    const first = await createA2AInboundToken("first", "read");
    const second = await createA2AInboundToken("second", "read");
    runner.mockResolvedValueOnce({
      text: "private result",
      rounds: 1,
      toolCalls: [],
    });
    const sent = await (
      await handleA2ARequest(
        rpc(first.token, {
          jsonrpc: "2.0",
          id: 2,
          method: "SendMessage",
          params: {
            message: {
              messageId: "m2",
              role: "ROLE_USER",
              parts: [{ text: "task", mediaType: "text/plain" }],
            },
          },
        }),
      )
    ).json();
    const taskId = sent.result.task.id;
    const hidden = await (
      await handleA2ARequest(
        rpc(second.token, {
          jsonrpc: "2.0",
          id: 3,
          method: "GetTask",
          params: { id: taskId },
        }),
      )
    ).json();
    expect(hidden.error.code).toBe(-32001);
  });

  it("streams Task → status/artifact updates → terminal status over SSE", async () => {
    const { token } = await createA2AInboundToken("streamer", "read");
    runner.mockImplementationOnce(async ({ onDelta }) => {
      onDelta?.("hel");
      onDelta?.("lo");
      return { text: "hello", rounds: 1, toolCalls: [] };
    });
    const response = await handleA2ARequest(
      rpc(token, {
        jsonrpc: "2.0",
        id: "stream-1",
        method: "SendStreamingMessage",
        params: {
          message: {
            messageId: "m3",
            role: "ROLE_USER",
            parts: [{ text: "stream", mediaType: "text/plain" }],
          },
        },
      }),
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    const envelopes = text
      .split(/\n\n/)
      .filter(Boolean)
      .map((block) => JSON.parse(block.replace(/^data:\s*/, "")));
    expect(envelopes[0].result.task.status.state).toBe("TASK_STATE_SUBMITTED");
    expect(
      envelopes.some(
        (row) =>
          row.result?.statusUpdate?.status?.state === "TASK_STATE_WORKING",
      ),
    ).toBe(true);
    expect(
      envelopes
        .filter((row) => row.result?.artifactUpdate)
        .map((row) => row.result.artifactUpdate.artifact.parts[0].text)
        .join(""),
    ).toBe("hello");
    expect(envelopes.at(-1).result.statusUpdate.status.state).toBe(
      "TASK_STATE_COMPLETED",
    );
  });
  it("paginates ListTasks within the authenticated principal", async () => {
    const { token, profile } = await createA2AInboundToken("pager", "read");
    const principal = `a2a:${profile.id}`;
    for (let index = 0; index < 3; index += 1) {
      await createA2ATask(principal, "read", {
        messageId: `page-${index}`,
        role: "ROLE_USER",
        parts: [{ text: `task ${index}`, mediaType: "text/plain" }],
      });
    }
    const first = await (
      await handleA2ARequest(
        rpc(token, {
          jsonrpc: "2.0",
          id: "page-1",
          method: "ListTasks",
          params: { pageSize: 2 },
        }),
      )
    ).json();
    expect(first.result.tasks).toHaveLength(2);
    expect(first.result.totalSize).toBe(3);
    expect(first.result.nextPageToken).toBeTruthy();

    const second = await (
      await handleA2ARequest(
        rpc(token, {
          jsonrpc: "2.0",
          id: "page-2",
          method: "ListTasks",
          params: { pageSize: 2, pageToken: first.result.nextPageToken },
        }),
      )
    ).json();
    expect(second.result.tasks).toHaveLength(1);
    expect(second.result.nextPageToken).toBe("");

    const invalid = await (
      await handleA2ARequest(
        rpc(token, {
          jsonrpc: "2.0",
          id: "page-bad",
          method: "ListTasks",
          params: { pageToken: "not-a-valid-token" },
        }),
      )
    ).json();
    expect(invalid.error.code).toBe(-32602);
  });
});
