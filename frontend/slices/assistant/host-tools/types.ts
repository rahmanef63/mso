import type { AppDescriptor, OsApi } from "../lib/host";
import type { ToolGroup } from "../lib/types";

// A JSON Schema object (Anthropic tool `input_schema` shape) — flat primitive/
// enum properties only, matching the image-editor command schema.
export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

// "read" runs immediately; "mutate" requires per-call human approval before it
// touches the VPS. The tier a user sees on the approval card is the tier the
// loop enforces — this field is the single source.
export type HostEffect = "read" | "mutate";

// One AI-callable host operation. `run` receives the live OsApi port + the
// model's args and returns a short, serialisable result the model sees as the
// tool_result. Throw on bad input; the binding catches it into a failed outcome.
export type HostToolRuntime = { apps: AppDescriptor[] };

export type HostTool = {
  /** Dotted name, e.g. "fs.write". Unique across the catalog. */
  name: string;
  /** Display grouping for the pickers. Presentation only — never sent to the model. */
  group: ToolGroup;
  /** Short human label for the pickers, e.g. "New folder". Never sent to the model. */
  label: string;
  description: string;
  parameters: JsonSchema;
  effect: HostEffect;
  run: (api: OsApi, args: Record<string, unknown>, runtime: HostToolRuntime) => string | Promise<string>;
};
