import { createHash } from "node:crypto";
import path from "node:path";
import { mimeFor, readFileBytes } from "@/lib/host/fs-api";
import { createTempShare, tempShareUrl } from "@/lib/host/temp-share-api";
import { mcpDirect, PATH_P, READ_ONLY, S, str, type McpTool } from "./tool-kit";

export const FILE_TRANSFER_READ_TOOLS: McpTool[] = [
  {
    name: "fs_export_file",
    description:
      "Export one original VPS file (max 10 MiB) from OS_FS_READ_ROOTS to a private 15-minute approved-device temp-share. Returns SHA-256 and a download/resource link; no decoding, recompression or public URL.",
    scope: "read",
    annotations: READ_ONLY,
    limit: { key: "fs.export", max: 20, windowMs: 60_000 },
    inputSchema: S(PATH_P, ["path"]),
    run: async (a) => {
      const requested = str(a, "path");
      const bytes = await readFileBytes(requested, 10 * 1024 * 1024);
      const filename = path.basename(requested);
      const mimeType = mimeFor(requested);
      const share = await createTempShare({ data: bytes, filename, mimeType, ttlMs: 15 * 60_000, maxDownloads: 5 });
      const previewUrl = tempShareUrl(share.id);
      const downloadUrl = tempShareUrl(share.id, true);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const result = {
        path: requested,
        filename,
        mimeType,
        bytes: bytes.byteLength,
        sha256,
        previewUrl,
        downloadUrl,
        expiresAt: share.expiresAt,
        downloadsLeft: share.downloadsLeft,
      };
      return mcpDirect([
        {
          type: "resource_link",
          uri: downloadUrl,
          name: filename,
          description: "Authenticated original-byte download; requires an approved MSO browser session and expires automatically.",
          mimeType,
        },
        { type: "text", text: JSON.stringify(result) },
      ], false, { result });
    },
  },
];
