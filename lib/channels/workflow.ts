import { createAgentSession } from "@/lib/agent/session-store";
import { maxScope } from "@/lib/mcp/scope";
import { msoCapabilityRuntime } from "@/lib/mcp/capability-runtime";
import { findActiveChannelSource } from "@/lib/workflow/graph-triggers";
import { startWorkflowGraph } from "@/lib/workflow/graph-engine";
import { ChannelError } from "./errors";
import { channelById, recordChannelActivity } from "./store";
import type { ChannelInboundEvent } from "./types";

function workflowInput(channel: Awaited<ReturnType<typeof channelById>>, event: ChannelInboundEvent) {
  const { raw: _raw, ...safeEvent } = event;
  return {
    channel: { id: channel.id, name: channel.name, provider: channel.provider },
    event: safeEvent,
  };
}

export async function dispatchChannelInbound(channelId: string, event: ChannelInboundEvent) {
  const channel = await channelById(channelId);
  await recordChannelActivity(channelId);
  if (!channel.workflowId) return { workflow: null };

  const source = await findActiveChannelSource(channel.workflowId, channel.id);
  if (!source) throw new ChannelError("channel_workflow_trigger_not_found", 409);

  const session = await createAgentSession(source.principal, "cli", {
    title: `Channel: ${channel.name}`,
    titleSource: "auto",
  });
  const { TOOLS_BY_NAME } = await import("@/lib/mcp/tools");
  const context = {
    principal: source.principal,
    actor: source.principal,
    sessionId: session.id,
    scope: maxScope(),
    capabilities: msoCapabilityRuntime,
  } as const;
  const idempotency = `channel:${channel.id}:${event.eventId}`.slice(0, 128);
  const run = await startWorkflowGraph(
    source.graph,
    workflowInput(channel, event),
    idempotency,
    context,
    (name) => TOOLS_BY_NAME.get(name),
    source.principal,
    { type: "channel", nodeId: source.node.id, receivedAt: event.receivedAt },
  );
  return { workflow: { runId: run.id, state: run.state, graphId: source.graph.id } };
}
