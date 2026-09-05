import { mcpDirect, type McpContent, type McpDirectResult } from "./tool-kit";

export const PROJECT_FUNCTION_CONTENT_PROTOCOL = "mso.project-function-content.v1" as const;
const MAX_DIRECT_IMAGE_BYTES = 620 * 1024;
const MAX_DIRECT_TEXT_CHARS = 32 * 1024;
const MAX_DIRECT_CONTENT = 4;
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

type ProjectFunctionResult = { code: number; stdout: string; stderr: string };
type DirectProjectFunctionResult = McpDirectResult & { code: number };

const plainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function validSignature(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function parseContent(value: unknown): McpContent[] | null {
  if (!plainObject(value) || value.protocol !== PROJECT_FUNCTION_CONTENT_PROTOCOL || !Array.isArray(value.content)) return null;
  if (value.content.length === 0 || value.content.length > MAX_DIRECT_CONTENT) return null;
  let images = 0;
  const content: McpContent[] = [];
  for (const row of value.content) {
    if (!plainObject(row) || typeof row.type !== "string") return null;
    if (row.type === "text") {
      if (typeof row.text !== "string" || row.text.length > MAX_DIRECT_TEXT_CHARS) return null;
      content.push({ type: "text", text: row.text });
      continue;
    }
    if (row.type !== "image" || typeof row.data !== "string" || typeof row.mimeType !== "string" || !IMAGE_MIME.has(row.mimeType)) return null;
    if (++images > 1 || row.data.length > Math.ceil(MAX_DIRECT_IMAGE_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(row.data)) return null;
    const bytes = Buffer.from(row.data, "base64");
    if (bytes.length === 0 || bytes.length > MAX_DIRECT_IMAGE_BYTES || !validSignature(bytes, row.mimeType)) return null;
    content.push({ type: "image", data: row.data, mimeType: row.mimeType });
  }
  return images === 1 ? content : null;
}

/**
 * Project functions normally return their stdout/stderr envelope unchanged. A
 * function may opt into direct MCP visual content by emitting one strict JSON
 * document using PROJECT_FUNCTION_CONTENT_PROTOCOL. The runner's existing 1 MiB
 * stdout cap still applies before this parser runs; this second bound keeps the
 * decoded image comfortably below that wire limit.
 */
export function projectFunctionContent(result: ProjectFunctionResult): ProjectFunctionResult | DirectProjectFunctionResult {
  if (result.code !== 0 || result.stderr.trim() !== "") return result;
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout); } catch { return result; }
  const content = parseContent(parsed);
  if (!content) return result;
  return { ...mcpDirect(content), code: 0 };
}
