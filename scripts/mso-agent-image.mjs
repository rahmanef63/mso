// Pure image helpers and upload boundary for attaching images to agent turns.
// Uploads target the session temp artifacts directory via /api/v1/fs/upload.

import fs from "node:fs";
import path from "node:path";
import { BASE, requestHeaders } from "./mso-agent-api.mjs";

export const ALLOWED_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);

export function validateImagePath(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    return { ok: false, error: "image path required" };
  }
  const resolved = path.resolve(filePath.trim());
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, error: `file not found: ${filePath}` };
  }
  if (!stat.isFile()) {
    return { ok: false, error: `not a regular file: ${filePath}` };
  }
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      error: `unsupported image format: ${ext || "(none)"} (expected .png, .jpg, .jpeg, .gif, .webp)`,
    };
  }
  return { ok: true, path: resolved, ext, size: stat.size };
}

export function pendingImageBlock(images) {
  if (!Array.isArray(images) || !images.length) return "";
  const lines = [
    "--- ATTACHED IMAGES ---",
    ...images.map((img) => img.remotePath || img.path),
    "------------------------",
  ];
  return lines.join("\n");
}

export async function uploadSessionImage(session, localPath) {
  const destDir = session?.agentSession?.artifacts?.directory;
  if (!destDir) {
    throw new Error("session artifacts directory is unavailable");
  }
  const valid = validateImagePath(localPath);
  if (!valid.ok) {
    throw new Error(valid.error);
  }
  const buffer = fs.readFileSync(valid.path);
  const filename = path.basename(valid.path);
  const blob = new Blob([buffer]);

  const form = new FormData();
  form.append("dest", destDir);
  form.append("file", blob, filename);

  const res = await fetch(`${BASE}/api/v1/fs/upload`, {
    method: "POST",
    body: form,
    headers: requestHeaders(false),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = `upload failed (HTTP ${res.status})`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) message = String(parsed.error);
    } catch {
      if (text) message = text.slice(0, 200);
    }
    throw new Error(message);
  }

  const remotePath = path.join(destDir, filename);
  return {
    path: valid.path,
    remotePath,
    bytes: valid.size,
  };
}
