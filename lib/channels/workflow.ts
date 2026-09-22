import { createAgentSession } from "@/lib/agent/session-store";
import type { CapabilityRuntime } from "@/lib/capabilities/runtime";
import type { Scope } from "@/lib/capabilities/scope";
import type { CapabilityTool } from "@/lib/capabilities/tool";
import { findActiveChannelSource } from "@/lib/workflow/graph-triggers";
import { startWorkflowGraph } from "@/lib/workflow/graph-engine";
import { ChannelError } from "./errors";
import { channelById, recordChannelActivity } from "./store";
import type { ChannelInboundEvent } from "./types";

export type ChannelWorkflowRuntime = {
  scope: Scope;
  capabilities?: CapabilityRuntime;
  resolveTool: (name: string) => CapabilityTool | undefined;
};

function workflowInput(channel: Awaited<ReturnType<typeof channelById>>, event: ChannelInboundEvent) {
  const { raw: _raw, ...safeEvent } = event;
  return {
    channel: { id: channel.id, name: channel.name, provider: channel.provider },
    event: safeEvent,
  };
}

export async function dispatchChannelInbound(
  channelId: string,
  event: ChannelInboundEvent,
  runtime: ChannelWorkflowRuntime,
) {
  const channel = await channelById(channelId);
  await recordChannelActivity(channelId);
  if (!channel.workflowId) return { workflow: null };

  const source = await findActiveChannelSource(channel.workflowId, channel.id);
  if (!source) throw new ChannelError("channel_workflow_trigger_not_found", 409);

  const session = await createAgentSession(source.principal, "cli", {
    title: "Channel: " + channel.name,
    titleSource: "auto",
  });
  const context = {
    principal: source.principal,
    actor: source.principal,
    sessionId: session.id,
    scope: runtime.scope,
    ...(runtime.capabilities ? { capabilities: runtime.capabilities } : {}),
  } as const;
  const idempotency = ["channel", channel.id, event.eventId].join(":").slice(0, 128);
  const run = await startWorkflowGraph(
    source.graph,
    workflowInput(channel, event),
    idempotency,
    context,
    runtime.resolveTool,
    source.principal,
    { type: "channel", nodeId: source.node.id, receivedAt: event.receivedAt },
  );
  return { workflow: { runId: run.id, state: run.state, graphId: source.graph.id } };
}
