import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { liveSessionAuthorized } from "@/lib/auth/live-authorization";
import { readRequestJson, RequestBodyError } from "@/lib/security/request-body";
import { DEFAULT_PROVIDER, readConfig } from "@/lib/config/store";
import { defaultModelFor } from "@/lib/models/defaults";
import { msoCapabilityRuntime } from "@/lib/mcp/capability-runtime";
import { PROFILE_READ_TOOLS } from "@/lib/contracts/agent-profile";
import { AgentProfileError } from "@/lib/agent/profile-schema";
import { readAgentProfiles, mutateAgentProfiles } from "@/lib/agent/profile-store";

const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

function failure(error: unknown) {
  return error instanceof AgentProfileError || error instanceof RequestBodyError
    ? fail(error.message, error.status)
    : fail("profile_store_unavailable", 500);
}

export async function handleGetAgentProfiles(): Promise<Response> {
  const context = await getSessionContext();
  if (!context?.session.device_id) return fail("unauthorized", 401);
  if (context.role !== "owner") return fail("profile_owner_required", 403);
  try {
    const principal = `web:${context.session.device_id}`;
    const [store, config] = await Promise.all([readAgentProfiles(principal), readConfig()]);
    const provider = config.provider || DEFAULT_PROVIDER;
    const tools = msoCapabilityRuntime
      .list("read")
      .filter((tool) => tool.scope === "read" && (PROFILE_READ_TOOLS as readonly string[]).includes(tool.name))
      .map(({ name, description }) => ({ name, description }));
    if (!(await liveSessionAuthorized(context.session, "owner"))) return fail("profile_owner_session_revoked", 403);
    return NextResponse.json(
      { store, selectedModel: { provider, model: config.model || defaultModelFor(provider) }, tools },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function handlePostAgentProfiles(req: Request): Promise<Response> {
  const context = await getSessionContext();
  if (!context?.session.device_id) return fail("unauthorized", 401);
  if (context.role !== "owner") return fail("profile_owner_required", 403);
  try {
    const body = await readRequestJson(req, 16 * 1024);
    const authorize = async () => {
      if (!(await liveSessionAuthorized(context.session, "owner")))
        throw new AgentProfileError("profile_owner_session_revoked", 403);
    };
    await authorize();
    const store = await mutateAgentProfiles(`web:${context.session.device_id}`, body, authorize);
    await authorize();
    return NextResponse.json({ store }, { headers });
  } catch (error) {
    return failure(error);
  }
}
