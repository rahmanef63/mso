import { HOST_TOOLS } from "../host-tools/catalog";
import type { Tool, ToolGroup } from "./types";

// Presentation for the Agents / Skills / Automations editors. Groups only — the
// tools themselves come from the executable catalog below.
export const GROUP_META: Record<
  ToolGroup,
  { label: string; icon: string }
> = {
  files: { label: "File system", icon: "folder" },
  apps: { label: "Apps", icon: "grid" },
  system: { label: "System", icon: "gauge" },
  terminal: { label: "Terminal", icon: "terminal" },
  agent: { label: "Agent harness", icon: "sparkles" },
};

export const GROUP_ORDER: ToolGroup[] = [
  "files",
  "apps",
  "system",
  "terminal",
  "agent",
];

// ONE catalog. OS_TOOLS is now a VIEW of the executable host tools, not a second
// list beside them. It used to be 45 hand-written descriptors of which exactly one
// (apps.list) shared a name with anything real — and even that one disagreed on
// what it did. The other 44 described capabilities that do not exist: whole
// rendering, media, editor, browser, settings and video groups the model was never
// able to call. Picking them in the Agents/Skills editors configured nothing.
//
// Deriving means the pickers can only ever offer tools the model can actually run.
export const OS_TOOLS: Tool[] = HOST_TOOLS.map((t) => ({
  id: t.name,
  group: t.group,
  name: t.label,
  desc: t.description,
  params: Object.keys((t.parameters.properties ?? {}) as Record<string, unknown>),
}));

const BY_ID = new Map(OS_TOOLS.map((t) => [t.id, t]));
export const toolById = (id: string): Tool | undefined => BY_ID.get(id);

// toolsForAgent() lived here and computed a per-agent tool set that nothing
// enforced — use-host-commands.ts sends HOST_AI_TOOLS unconditionally. It only
// ever fed labels, so the labels were the lie. CONTRACT.md calls for its removal.
