import { json } from "@/lib/api/route";
import { getSessionContext } from "@/lib/auth/require-session";
import { readSetupJson } from "@/lib/infra/setup-http";
import { rateLimited } from "@/lib/host/rate-limit";
import {
  AgentGroupError,
  agentGroupsSnapshot,
  createAgentGroup,
  deleteAgentGroup,
  getAgentGroup,
  startAgentGroupRun,
  stopAgentGroupRun,
  updateAgentGroup,
} from "@/lib/agent-group";

const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" };

const failure = (error: unknown) => {
  const value = error instanceof AgentGroupError ? error : new AgentGroupError("agent_group_operation_failed", 400);
  return json({ error: value.code }, { status: value.status, headers });
};

async function owner() {
  const context = await getSessionContext();
  return context?.role === "owner" ? context : null;
}

export async function handleGetAgentGroup(req: Request): Promise<Response> {
  if (!(await owner())) return json({ error: "owner_required" }, { status: 403, headers });
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    return json(id ? await getAgentGroup(id) : await agentGroupsSnapshot(), { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function handlePostAgentGroup(req: Request): Promise<Response> {
  const context = await owner();
  if (!context) return json({ error: "owner_required" }, { status: 403, headers });
  try {
    const body = await readSetupJson(req, 64 * 1024);
    const action = typeof body.action === "string" ? body.action : "";
    if (rateLimited(`agent-groups:${action}:${context.session.device_id}`, action === "run" ? 30 : 60, 60_000)) {
      throw new AgentGroupError("rate_limited", 429);
    }
    if (action === "create") {
      if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) throw new AgentGroupError("invalid_group_data");
      return json((await createAgentGroup(body.data as Record<string, unknown>)).result, { headers });
    }
    if (action === "update") {
      if (typeof body.id !== "string" || !Number.isSafeInteger(body.expectedRevision) || !body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
        throw new AgentGroupError("invalid_group_update");
      }
      return json((await updateAgentGroup(body.id, Number(body.expectedRevision), body.data as Record<string, unknown>)).result, { headers });
    }
    if (action === "delete") {
      if (typeof body.id !== "string" || !Number.isSafeInteger(body.expectedRevision)) throw new AgentGroupError("invalid_group_delete");
      return json((await deleteAgentGroup(body.id, Number(body.expectedRevision))).result, { headers });
    }
    if (action === "run") {
      if (typeof body.id !== "string" || typeof body.prompt !== "string") throw new AgentGroupError("invalid_group_run");
      const members = Array.isArray(body.members) ? body.members.filter((value): value is string => typeof value === "string") : undefined;
      return json(await startAgentGroupRun(body.id, body.prompt, members), { headers });
    }
    if (action === "stop") {
      if (typeof body.runId !== "string") throw new AgentGroupError("invalid_group_stop");
      return json(await stopAgentGroupRun(body.runId), { headers });
    }
    throw new AgentGroupError("unknown_group_action");
  } catch (error) {
    return failure(error);
  }
}
