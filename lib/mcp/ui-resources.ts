import { MSO_BLOCK_RESOURCE, MSO_BLOCK_URI } from "./ui-block";
import { MSO_PAGE_RESOURCE, MSO_PAGE_URI } from "./ui-surface";

export { MSO_BLOCK_URI, MSO_PAGE_URI };
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

// Read-only aliases keep already-cached ChatGPT action descriptors functional
// across the UI-contract migration. They are intentionally not advertised by
// resources/list: the public product contract has exactly Block and Page.
export const LEGACY_WORKFLOW_PROGRESS_URI = "ui://mso/workflow-progress-v3.html";
export const LEGACY_SURFACE_URI = "ui://mso/surface-v5.html";

export type McpUiResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  text: string;
  _meta: Record<string, unknown>;
};

const RESOURCES: readonly McpUiResource[] = [MSO_BLOCK_RESOURCE, MSO_PAGE_RESOURCE];
const LEGACY_ALIASES = new Map<string, McpUiResource>([
  [LEGACY_WORKFLOW_PROGRESS_URI, MSO_BLOCK_RESOURCE],
  [LEGACY_SURFACE_URI, MSO_PAGE_RESOURCE],
]);

export function listUiResources() {
  return RESOURCES.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType }));
}

export function readUiResource(uri: string): McpUiResource | undefined {
  const canonical = RESOURCES.find((resource) => resource.uri === uri);
  if (canonical) return canonical;
  const legacy = LEGACY_ALIASES.get(uri);
  return legacy ? { ...legacy, uri } : undefined;
}
