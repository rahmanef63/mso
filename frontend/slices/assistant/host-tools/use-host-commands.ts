"use client";

import { useMemo, useRef } from "react";
import { matchDestructive, useOsApi } from "../lib/host";
import type { AiTool, ToolInvocation, ToolOutcome } from "../lib/host";
import { useApps, type ToolCard } from "@/features/appshell";
import { findHostTool, HOST_AI_TOOLS } from "./registry";

// The chat panel supplies these so the binding can render each call as a card and
// park on an approval decision for mutate tools.
export type HostToolUi = {
  pushCard: (id: string, card: ToolCard) => void;
  updateCard: (id: string, patch: Partial<ToolCard>) => void;
  /** Resolves when the user clicks Approve/Deny on that card. */
  requestApproval: (id: string) => Promise<{ approve: boolean; remember: boolean }>;
};

// "Allow this exact call again" is offered only for low-blast-radius mutations —
// never exec.run (arbitrary RCE) or a delete. Exact-signature scoped, never a glob.
const REMEMBERABLE = new Set(["fs.write", "fs.mkdir", "fs.move", "fs.copy"]);

// Stable signature for the remember/auto-deny sets: name + key-sorted input.
function signature(name: string, input: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(input ?? {}, Object.keys(input ?? {}).sort())}`;
}

// Binds the host-tool catalog to the LIVE OsApi + the approval gate. Returns the
// tool schemas (for the AI request) + `invoke`, which the agent loop calls per
// tool_use. Read tools run immediately; mutate tools push a pending card and
// await the user's decision. Denials (and unknown/failed tools) come back as a
// crash-free failed outcome so the model reads the message and adapts. The
// gate here is an ADDITIONAL human layer over the server's auth + jail + audit —
// not the security boundary.
export function useHostCommands(ui: HostToolUi): {
  tools: AiTool[];
  invoke: (call: ToolInvocation) => Promise<ToolOutcome>;
} {
  const api = useOsApi();
  const apps = useApps();
  const denied = useRef<Set<string>>(new Set());
  const allowed = useRef<Set<string>>(new Set());
  const seq = useRef(0);
  return useMemo(
    () => ({
      tools: HOST_AI_TOOLS,
      invoke: async ({ name, input }) => {
        const tool = findHostTool(name);
        const id = `hc${seq.current++}`;
        const args = input ?? {};
        if (!tool) {
          const msg = `unknown tool "${name}"`;
          ui.pushCard(id, { name, effect: "mutate", input: args, status: "error", result: msg });
          return { ok: false, result: msg };
        }
        const execute = async (): Promise<ToolOutcome> => {
          ui.updateCard(id, { status: "running" });
          try {
            const result = await tool.run(api, args, { apps });
            ui.updateCard(id, { status: "ok", result });
            return { ok: true, result };
          } catch (e) {
            const msg = e instanceof Error ? e.message : "tool failed";
            ui.updateCard(id, { status: "error", result: msg });
            return { ok: false, result: msg };
          }
        };

        if (tool.effect === "read") {
          ui.pushCard(id, { name, effect: "read", input: args, status: "running" });
          return execute();
        }

        // mutate → approval gate.
        const danger = name === "exec.run" ? matchDestructive(String(args.cmd ?? "")) ?? undefined : undefined;
        const sig = signature(name, args);
        ui.pushCard(id, { name, effect: "mutate", input: args, status: "pending", danger });
        if (denied.current.has(sig)) {
          ui.updateCard(id, { status: "denied", result: "Auto-denied (already declined this exact call)." });
          return { ok: false, result: "Auto-denied: the user already declined this exact call. Stop retrying it — propose an alternative or ask." };
        }
        if (allowed.current.has(sig)) return execute();
        const { approve, remember } = await ui.requestApproval(id);
        if (!approve) {
          denied.current.add(sig);
          ui.updateCard(id, { status: "denied", result: "Denied by the user." });
          return { ok: false, result: "Denied by the user. Do not retry this exact call; propose an alternative or ask what they'd prefer." };
        }
        if (remember && REMEMBERABLE.has(name)) allowed.current.add(sig);
        return execute();
      },
    }),
    [api, apps, ui],
  );
}
