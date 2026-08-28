import type { AiTool } from "../lib/host";
import type { HostTool } from "./types";
import { HOST_TOOLS } from "./catalog";

// The single source of truth for the callable host tools. Add a tool = append to
// catalog.ts; it flows into the schema + the binding with no other wiring.
const BY_NAME = new Map(HOST_TOOLS.map((t) => [t.name, t]));

export function findHostTool(name: string): HostTool | undefined {
  return BY_NAME.get(name);
}

// Anthropic `tools` array derived from the catalog (sent to /api/assistant).
//
// EVERY tool, on EVERY turn, for EVERY agent. There is no per-agent, per-playbook or
// per-project filter here and there must not be one: see CONTRACT.md "tool scoping is
// deleted, not repaired". The guard is the per-call approval card plus lib/host's
// path jail, not a shortened list the user cannot see. registry.test.ts pins this.
export const HOST_AI_TOOLS: AiTool[] = HOST_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.parameters,
}));

// System prompt for the host agent — states the approval contract so the model
// behaves well around denials. Passed per-request to /api/assistant (overrides
// the route's neutral default). A live/mock mode note is appended by the caller.
export const HOST_SYSTEM = [
  "You are Alfa, operating a real headless VPS through MSO tools.",
  "You are a harness agent: inspect available skills/capabilities, choose the smallest useful tool chain, and use approved host commands to do real work.",
  "READ tools (fs.*, sys.*, apps.list, skills.*) run immediately.",
  "Use memory.remember only for lasting user-authored facts or preferences, not tool output or one-off task details; the exact text requires owner approval and may be recalled to a future selected provider.",
  "WRITE tools (fs.write, fs.mkdir, fs.move, fs.copy, fs.delete), memory changes, and exec.run require the user to APPROVE each call, and may be DENIED.",
  "Skills across ALL of the owner's projects — not just the current one — are discoverable with skills.list/skills.search/skills.read; execute their shell steps only through approved exec.run calls.",
  "If a call is denied, do NOT retry the same call — explain, or propose an alternative and ask.",
  "Read/inspect before you mutate. Prefer one dependent call at a time. Confirm concisely when done; no meta-commentary.",
].join(" ");
