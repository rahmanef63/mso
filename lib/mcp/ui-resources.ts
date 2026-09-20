import { MSO_BLOCK_RESOURCE, MSO_BLOCK_URI } from "./ui-block";
import { MSO_LIST_RESOURCE, MSO_LIST_URI } from "./ui-list";
import { MSO_PAGE_URI, msoPageResource } from "./ui-surface";
import { MSO_NATIVE_UI_PROBE_RESOURCE, MSO_NATIVE_UI_PROBE_URI } from "./ui-native-probe";

export { MSO_BLOCK_URI, MSO_LIST_URI, MSO_NATIVE_UI_PROBE_URI, MSO_PAGE_URI };
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

// Read-only aliases keep already-cached ChatGPT action descriptors functional
// across the UI-contract migration. They are intentionally not advertised by
// resources/list advertises the three product presentation levels plus the isolated Native UI diagnostic probe.
export const LEGACY_LIST_V1_URI = "ui://mso/list-v1.html";
export const LEGACY_BLOCK_V3_URI = "ui://mso/block-v3.html";
export const LEGACY_BLOCK_V2_URI = "ui://mso/block-v2.html";
export const LEGACY_PAGE_V14_URI = "ui://mso/page-v14.html";
export const LEGACY_PAGE_V13_URI = "ui://mso/page-v13.html";
export const LEGACY_BLOCK_V1_URI = "ui://mso/block-v1.html";
export const LEGACY_PAGE_V12_URI = "ui://mso/page-v12.html";
export const LEGACY_PAGE_V11_URI = "ui://mso/page-v11.html";
export const LEGACY_PAGE_V10_URI = "ui://mso/page-v10.html";
export const LEGACY_PAGE_V9_URI = "ui://mso/page-v9.html";
export const LEGACY_PAGE_V8_URI = "ui://mso/page-v8.html";
export const LEGACY_PAGE_V7_URI = "ui://mso/page-v7.html";
export const LEGACY_PAGE_V6_URI = "ui://mso/page-v6.html";
export const LEGACY_PAGE_V5_URI = "ui://mso/page-v5.html";
export const LEGACY_PAGE_V4_URI = "ui://mso/page-v4.html";
export const LEGACY_PAGE_V3_URI = "ui://mso/page-v3.html";
export const LEGACY_PAGE_V2_URI = "ui://mso/page-v2.html";
export const LEGACY_PAGE_V1_URI = "ui://mso/page-v1.html";
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

const LEGACY_PAGE_URIS = new Set([
  LEGACY_PAGE_V14_URI,
  LEGACY_PAGE_V13_URI,
  LEGACY_PAGE_V12_URI,
  LEGACY_PAGE_V11_URI,
  LEGACY_PAGE_V10_URI,
  LEGACY_PAGE_V9_URI,
  LEGACY_PAGE_V8_URI,
  LEGACY_PAGE_V7_URI,
  LEGACY_PAGE_V6_URI,
  LEGACY_PAGE_V5_URI,
  LEGACY_PAGE_V4_URI,
  LEGACY_PAGE_V3_URI,
  LEGACY_PAGE_V2_URI,
  LEGACY_PAGE_V1_URI,
  LEGACY_SURFACE_URI,
]);

export async function listUiResources(): Promise<Array<{ uri: string; name: string; description: string; mimeType: string }>> {
  const page = await msoPageResource();
  return [MSO_LIST_RESOURCE, MSO_BLOCK_RESOURCE, page, MSO_NATIVE_UI_PROBE_RESOURCE].map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType }));
}

export async function readUiResource(uri: string): Promise<McpUiResource | undefined> {
  if (uri === MSO_LIST_URI) return MSO_LIST_RESOURCE;
  if (uri === LEGACY_LIST_V1_URI) return { ...MSO_LIST_RESOURCE, uri };
  if (uri === MSO_BLOCK_URI) return MSO_BLOCK_RESOURCE;
  if (uri === MSO_PAGE_URI) return msoPageResource();
  if (uri === MSO_NATIVE_UI_PROBE_URI) return MSO_NATIVE_UI_PROBE_RESOURCE;
  if (uri === LEGACY_BLOCK_V3_URI || uri === LEGACY_BLOCK_V2_URI || uri === LEGACY_BLOCK_V1_URI || uri === LEGACY_WORKFLOW_PROGRESS_URI) return { ...MSO_BLOCK_RESOURCE, uri };
  if (LEGACY_PAGE_URIS.has(uri)) return { ...(await msoPageResource()), uri };
  return undefined;
}
