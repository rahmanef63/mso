import { type McpTool, READ_ONLY, S } from "./tool-kit";
import { MSO_NATIVE_UI_PROBE_URI } from "./ui-native-probe";

export const NATIVE_UI_PROBE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    message: { type: "string" },
  },
  required: ["ok", "message"],
  additionalProperties: false,
} as const;

export const NATIVE_UI_PROBE_TOOLS: McpTool[] = [{
  name: "mso_native_ui_probe",
  title: "MSO Native UI Probe",
  description: "Render one minimal static MCP App resource with no routing, iframe, network access, app shell, or bridge logic. Use only to distinguish server resource binding from ChatGPT host-side native UI mounting.",
  chatgptDescription: "Mount the minimal static MSO Native UI diagnostic resource.",
  scope: "read",
  annotations: READ_ONLY,
  inputSchema: S({}, []),
  outputSchema: NATIVE_UI_PROBE_OUTPUT_SCHEMA,
  meta: {
    ui: { resourceUri: MSO_NATIVE_UI_PROBE_URI, visibility: ["model", "app"] },
    "ui/resourceUri": MSO_NATIVE_UI_PROBE_URI,
  },
  run: async () => ({ ok: true, message: "MSO NATIVE UI WORKS" }),
}];
