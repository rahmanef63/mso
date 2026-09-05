import { randomBytes } from "node:crypto";
import type { ArtifactInput, SessionArtifact } from "./artifact-types";
export function artifactFormat(bytes: Buffer): { extension: string; mimeType: SessionArtifact["mimeType"]; kind: SessionArtifact["kind"] } {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { extension: "png", mimeType: "image/png", kind: "screenshot" };
  if (bytes.length > 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return { extension: "jpg", mimeType: "image/jpeg", kind: "screenshot" };
  if (bytes.length > 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP")
    return { extension: "webp", mimeType: "image/webp", kind: "screenshot" };
  try {
    const data = JSON.parse(bytes.toString("utf8"));
    if (data && typeof data === "object") return { extension: "json", mimeType: "application/json", kind: "report" };
  } catch {
    /* not an accepted artifact */
  }
  throw new Error("only PNG/JPEG/WebP images or JSON reports are accepted");
}
function slug(value: unknown, fallback: string, max = 40): string {
  return (
    String(value || fallback)
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, max) || fallback
  );
}
export function artifactMetadata(input: ArtifactInput): ArtifactInput {
  if (typeof input.project !== "string" || !input.project.trim() || typeof input.feature !== "string" || !input.feature.trim())
    throw new Error("artifact project and feature are required");
  let url: string | undefined;
  if (input.url) {
    if (input.url.length > 2048) throw new Error("artifact URL is too long");
    const parsed = new URL(input.url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid artifact URL");
    url = parsed.origin + parsed.pathname;
  }
  const dimension = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 20000 ? n : undefined);
  return {
    project: slug(input.project, "project"),
    feature: slug(input.feature, "feature"),
    environment: slug(input.environment, "local", 16),
    locale: input.locale ? slug(input.locale, "und", 16) : undefined,
    width: dimension(input.width),
    height: dimension(input.height),
    url,
    producer: ["playwright", "camoufox", "mso", "other"].includes(input.producer || "") ? input.producer : "other",
    workflowId: input.workflowId && /^[a-f0-9-]{36}$/.test(input.workflowId) ? input.workflowId : undefined,
  };
}
export function artifactName(input: ArtifactInput, extension: string, now: Date) {
  const id = "shot_" + randomBytes(12).toString("hex");
  const stamp = now
    .toISOString()
    .replace(/[^0-9TZ]/g, "")
    .toLowerCase();
  const filename =
    [
      "mso",
      input.project,
      input.feature,
      input.environment,
      input.locale || "und",
      input.width && input.height ? `${input.width}x${input.height}` : "native",
      stamp,
      id.slice(-8),
    ].join("__") +
    "." +
    extension;
  return { id, filename };
}
