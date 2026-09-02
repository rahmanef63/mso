import { NextResponse } from "next/server";
import {
  createA2AInboundToken,
  createA2AOutboundCredential,
  getA2AOutboundCredential,
  resolveA2ACredentialBinding,
  listA2AAgents,
  registerA2AAgent,
  removeA2AAgent,
  removeA2AInboundToken,
  removeA2AOutboundCredential,
  setA2AAgentCredential,
} from "@/lib/a2a";
import { audit } from "@/lib/host/audit-api";
import { a2aLimited } from "./route-shared";

export async function handleA2ACredentialAction(
  action: string,
  body: Record<string, unknown>,
  actor: string,
  target: string,
): Promise<NextResponse | null> {
  if (action === "register") {
    if (a2aLimited(actor, action, 20))
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    const url = typeof body.url === "string" ? body.url : "";
    if (!url)
      return NextResponse.json({ error: "url_required" }, { status: 400 });
    const agent = await registerA2AAgent(
      url,
      typeof body.alias === "string" ? body.alias : undefined,
    );
    void audit({
      action: "a2a.registry",
      actor,
      target: url,
      detail: "agent.register",
    });
    return NextResponse.json({ agent });
  }
  if (action === "remove") {
    if (a2aLimited(actor, action, 20))
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    if (!target)
      return NextResponse.json({ error: "target_required" }, { status: 400 });
    const ok = await removeA2AAgent(target);
    void audit({
      action: "a2a.registry",
      actor,
      target,
      ok,
      detail: "agent.remove",
    });
    return NextResponse.json({ ok });
  }
  if (action === "credential-create") {
    if (a2aLimited(actor, action, 20))
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    const agentId = typeof body.agentId === "string" ? body.agentId : "";
    const label = typeof body.label === "string" ? body.label : "";
    const secret = typeof body.secret === "string" ? body.secret : "";
    const kind = typeof body.kind === "string" ? body.kind : "";
    if (!agentId || !label || !secret)
      return NextResponse.json(
        { error: "agentId_label_secret_required" },
        { status: 400 },
      );
    const agent = (await listA2AAgents()).find((row) => row.id === agentId);
    if (!agent)
      return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
    const binding = resolveA2ACredentialBinding(agent.card, {
      kind: kind as "api-key" | "bearer" | "oauth2",
      schemeName:
        typeof body.schemeName === "string" ? body.schemeName : undefined,
      headerName:
        typeof body.headerName === "string" ? body.headerName : undefined,
    });
    const credential = await createA2AOutboundCredential({
      agentId,
      label,
      kind: kind as "api-key" | "bearer" | "oauth2",
      secret,
      schemeName: binding.schemeName,
      headerName: binding.headerName,
      expiresAt:
        typeof body.expiresAt === "string" ? body.expiresAt : undefined,
    });
    if (body.activate !== false)
      await setA2AAgentCredential(agentId, credential.id);
    void audit({
      action: "a2a.credential",
      actor,
      target: credential.id,
      detail: `outbound.create kind=${credential.kind}`,
    });
    return NextResponse.json({ credential });
  }
  if (action === "credential-use") {
    const credentialId =
      typeof body.credentialId === "string" ? body.credentialId : "";
    if (!target)
      return NextResponse.json({ error: "target_required" }, { status: 400 });
    const agent = await setA2AAgentCredential(
      target,
      credentialId || undefined,
    );
    void audit({
      action: "a2a.credential",
      actor,
      target: agent.id,
      detail: credentialId ? "outbound.activate" : "outbound.clear",
    });
    return NextResponse.json({ agent });
  }
  if (action === "credential-remove") {
    const credentialId =
      typeof body.credentialId === "string" ? body.credentialId : "";
    if (!credentialId)
      return NextResponse.json(
        { error: "credentialId_required" },
        { status: 400 },
      );
    const credential = await getA2AOutboundCredential(credentialId);
    if (credential) {
      const agent = (await listA2AAgents()).find(
        (row) => row.id === credential.agentId,
      );
      if (agent?.credentialProfileId === credentialId)
        await setA2AAgentCredential(agent.id, undefined);
    }
    const ok = await removeA2AOutboundCredential(credentialId);
    void audit({
      action: "a2a.credential",
      actor,
      target: credentialId,
      ok,
      detail: "outbound.remove",
    });
    return NextResponse.json({ ok });
  }
  if (action === "inbound-token-create") {
    const label = typeof body.label === "string" ? body.label : "";
    if (!label)
      return NextResponse.json({ error: "label_required" }, { status: 400 });
    const created = await createA2AInboundToken(
      label,
      typeof body.scope === "string" ? body.scope : "read",
    );
    void audit({
      action: "a2a.credential",
      actor,
      target: created.profile.id,
      detail: `inbound.create scope=${created.profile.scope}`,
    });
    return NextResponse.json(created);
  }
  if (action === "inbound-token-remove") {
    const tokenId = typeof body.tokenId === "string" ? body.tokenId : "";
    if (!tokenId)
      return NextResponse.json({ error: "tokenId_required" }, { status: 400 });
    const ok = await removeA2AInboundToken(tokenId);
    void audit({
      action: "a2a.credential",
      actor,
      target: tokenId,
      ok,
      detail: "inbound.remove",
    });
    return NextResponse.json({ ok });
  }
  return null;
}
