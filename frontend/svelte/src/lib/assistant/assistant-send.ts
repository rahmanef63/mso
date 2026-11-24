import { ApiError, streamAssistant, type AssistantWireMessage } from "./assistant-api.ts";
import { runSavedProfile } from "./assistant-cockpit-api.ts";
import type { AssistantMessage, AssistantState, AssistantToolCall } from "./assistant-types.ts";
import type { ShellBridge } from "../shell-bridge.ts";
import type { createWorkspaceActions } from "./assistant-workspace.ts";

export type SendContext = {
  readonly state: AssistantState;
  readonly fetcher: typeof fetch;
  readonly getBridge: () => ShellBridge;
  readonly workspace: ReturnType<typeof createWorkspaceActions>;
  readonly disposed: () => boolean;
  readonly nextId: () => string;
  readonly emit: (patch: Partial<AssistantState>) => void;
  readonly patchMessage: (id: string, fn: (msg: AssistantMessage) => AssistantMessage, extra?: Partial<AssistantState>) => void;
  readonly toWireHistory: (messages: AssistantMessage[]) => AssistantWireMessage[];
  readonly buildSystemPrompt: () => string | undefined;
  readonly beginStream: () => { run: number; chatGen: number; chat: number };
  readonly setStreamAbort: (ctrl: AbortController | undefined) => void;
  readonly isStale: (run: number, chat: number, ctrl: AbortController) => boolean;
};

export async function sendAssistantMessage(ctx: SendContext, rawPrompt: string): Promise<void> {
  if (ctx.disposed() || ctx.state.streaming) return;
  const prompt = rawPrompt.trim();
  if (!prompt) return;

  const { run, chat: activeChat } = ctx.beginStream();
  const now = Date.now();
  const activeProfile = ctx.state.activeProfileId
    ? ctx.state.profiles.find((p) => p.id === ctx.state.activeProfileId && p.enabled) ?? null
    : null;
  const userMsg: AssistantMessage = { id: ctx.nextId(), role: "user", text: prompt, createdAt: now };
  const assistantId = ctx.nextId();
  const assistantMsg: AssistantMessage = {
    id: assistantId, role: "assistant", text: "", createdAt: now,
    ...(activeProfile ? { profileName: activeProfile.name } : {}),
  };
  const wireMessages = [...ctx.toWireHistory(ctx.state.messages), { role: "user" as const, text: prompt }];

  ctx.emit({
    messages: [...ctx.state.messages, userMsg, assistantMsg],
    streaming: true,
    error: null,
    liveActivity: { label: activeProfile ? `Running ${activeProfile.name}...` : "Thinking...", state: "running", toolCount: 0 },
  });

  const ctrl = new AbortController();
  ctx.setStreamAbort(ctrl);
  const stale = () => ctx.isStale(run, activeChat, ctrl);

  try {
    if (activeProfile) {
      const result = await runSavedProfile(
        { profileId: activeProfile.id, profileRevision: activeProfile.revision, prompt },
        ctrl.signal, ctx.fetcher, ctx.getBridge(),
      );
      if (stale()) return;
      const toolCalls: AssistantToolCall[] = result.toolCalls.map((call, idx) => ({
        id: `${result.runId}-tool-${idx}`, name: call.name, status: call.ok ? "done" : "error",
      }));
      ctx.patchMessage(
        assistantId,
        (m) => ({ ...m, text: result.text, ...(toolCalls.length ? { toolCalls } : {}) }),
        {
          streaming: false,
          liveActivity: {
            label: toolCalls.length ? `${activeProfile.name} completed (${toolCalls.length} tool calls)` : `${activeProfile.name} completed`,
            state: "done", toolCount: toolCalls.length,
          },
        },
      );
      ctx.workspace.persistCurrentThread(ctx.state.messages);
      return;
    }

    const system = ctx.buildSystemPrompt();
    let toolCount = 0;
    await streamAssistant(
      {
        messages: wireMessages,
        ...(ctx.state.selectedModel ? { model: ctx.state.selectedModel } : {}),
        ...(system ? { system } : {}),
      },
      {
        onText(chunk) { if (!stale()) ctx.patchMessage(assistantId, (m) => ({ ...m, text: m.text + chunk })); },
        onReasoning(chunk) { if (!stale()) ctx.patchMessage(assistantId, (m) => ({ ...m, reasoning: (m.reasoning ?? "") + chunk })); },
        onToolUse(tool) {
          if (stale()) return;
          toolCount++;
          ctx.patchMessage(
            assistantId,
            (m) => ({ ...m, toolCalls: [...(m.toolCalls ?? []), { id: tool.id, name: tool.name, input: tool.input, status: "done" }] }),
            { liveActivity: { label: `Called ${tool.name}`, state: "running", toolName: tool.name, toolCount } },
          );
        },
        onError(message) {
          if (stale()) return;
          ctx.patchMessage(assistantId, (m) => ({ ...m, error: message }), {
            streaming: false, error: message, liveActivity: { label: "Turn failed", state: "error", toolCount },
          });
        },
        onDone() {
          if (stale()) return;
          ctx.emit({
            streaming: false,
            liveActivity: { label: toolCount > 0 ? `Completed (${toolCount} tool calls)` : "Response complete", state: "done", toolCount },
          });
          ctx.workspace.persistCurrentThread(ctx.state.messages);
        },
      },
      ctrl.signal, ctx.fetcher, ctx.getBridge(),
    );
  } catch (error) {
    if (stale()) return;
    const message = error instanceof ApiError ? error.message : "Could not reach Alfa Assistant. Check the backend and retry.";
    ctx.patchMessage(assistantId, (m) => ({ ...m, error: message }), {
      streaming: false, error: message, liveActivity: { label: "Turn failed", state: "error", toolCount: 0 },
    });
  } finally {
    ctx.setStreamAbort(undefined);
    if (!stale() && ctx.state.streaming) ctx.emit({ streaming: false });
  }
}
