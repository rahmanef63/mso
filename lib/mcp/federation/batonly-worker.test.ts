import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  executeMsoFederation,
  runBatonlyFederationPoll,
  type FederationRequest,
} from "./batonly-worker";

const readRequest = (): FederationRequest => ({
  id: "request-1",
  projectId: "project-1",
  source: "mso",
  operation: "projects_list",
  scope: "read",
  confirmed: false,
  status: "claimed",
  arguments: {},
});

describe("Batonly federation worker", () => {
  it("preserves inner MSO scope and confirmation policy", async () => {
    await expect(executeMsoFederation({ ...readRequest(), scope: "write" })).rejects.toThrow(/scope mismatch/i);
    await expect(executeMsoFederation({
      ...readRequest(),
      operation: "project_knowledge_set",
      scope: "write",
      confirmed: false,
      arguments: { project: "baton", content: "safe" },
    })).rejects.toThrow(/confirmation/i);
  });

  it("blocks recursive Baton MCP execution", async () => {
    await expect(executeMsoFederation({
      ...readRequest(),
      operation: "project_mcp_call",
      scope: "exec",
      confirmed: true,
      arguments: { project: "baton", server: "baton", tool: "baton_federation_requests_list", arguments: {} },
    })).rejects.toThrow(/recursive/i);
  });

  it("pulls, claims, executes and completes one request through the Baton protocol", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let listed = false;
    const batonCall = async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "baton_federation_worker_heartbeat") return { workerId: "batonly-federation" };
      if (name === "baton_federation_requests_list") {
        if (listed) return [];
        listed = true;
        const { arguments: _arguments, ...summary } = readRequest();
        return [summary];
      }
      if (name === "baton_federation_request_claim") return readRequest();
      if (name === "baton_federation_request_complete") return { status: "succeeded" };
      if (name === "baton_federation_request_fail") return { status: "failed" };
      throw new Error("unexpected Baton call: " + name);
    };

    const outcome = await runBatonlyFederationPoll({ batonCall, cwd: process.cwd() });
    expect(outcome).toMatchObject({ processed: 1, requestId: "request-1", outcome: "succeeded" });
    expect(calls.map((row) => row.name)).toEqual(expect.arrayContaining([
      "baton_federation_worker_heartbeat",
      "baton_federation_requests_list",
      "baton_federation_request_claim",
      "baton_federation_request_complete",
    ]));
    const completed = calls.find((row) => row.name === "baton_federation_request_complete");
    expect(completed?.args.resultJson).toEqual(expect.any(String));
    expect(String(completed?.args.resultJson)).not.toMatch(/Bearer\s|accessToken|apiKey/i);
  });
});
