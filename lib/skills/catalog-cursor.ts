// Signed, bounded encoding for a resumable skill-catalog position. The cursor is
// caller-controlled input even though MSO minted it; authenticity prevents a client from
// inventing a huge fast-forward offset, while strict structural caps bound decode work.
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { SKILL_SCAN_LIMITS, type SkillScanCursor } from "./catalog-types";

const VERSION = "v1";
const FALLBACK_SECRET = randomBytes(32);

function secret(): Buffer {
  const configured = process.env.OS_SESSION_SECRET;
  return configured ? Buffer.from(configured, "utf8") : FALLBACK_SECRET;
}

function mac(payload: string): string {
  return createHmac("sha256", secret()).update(`${VERSION}.${payload}`).digest("base64url");
}

function normalize(parsed: SkillScanCursor): SkillScanCursor | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const doneRoots = Array.isArray(parsed.doneRoots)
    ? [...new Set(parsed.doneRoots.filter((r): r is string => typeof r === "string" && r.length > 0 && r.length <= 4096))].slice(0, 512)
    : [];
  const projectOffset = Number.isFinite(parsed.projectOffset)
    ? Math.min(SKILL_SCAN_LIMITS.maxProjects, Math.max(0, Math.floor(parsed.projectOffset)))
    : 0;
  const root = parsed.resume && typeof parsed.resume.root === "string" && parsed.resume.root.length <= 4096
    ? parsed.resume.root
    : undefined;
  const entries = parsed.resume && Number.isFinite(parsed.resume.entriesConsumed)
    ? Math.max(0, Math.floor(parsed.resume.entriesConsumed ?? 0))
    : 0;
  if (entries > SKILL_SCAN_LIMITS.maxResumeEntriesPerRoot) return undefined;
  return {
    doneRoots,
    projectOffset,
    ...(root ? { resume: { root, entriesConsumed: entries } } : {}),
  };
}

export function encodeSkillCursor(cursor: SkillScanCursor): string {
  const safe = normalize(cursor);
  if (!safe) throw new Error("skill cursor exceeds structural limits");
  const json = JSON.stringify(safe);
  if (Buffer.byteLength(json, "utf8") > SKILL_SCAN_LIMITS.maxCursorBytes) {
    throw new Error("skill cursor exceeds byte limit");
  }
  const payload = Buffer.from(json, "utf8").toString("base64url");
  return `${VERSION}.${payload}.${mac(payload)}`;
}

export function decodeSkillCursor(raw: string | undefined): SkillScanCursor | undefined {
  if (!raw || raw.length > Math.ceil(SKILL_SCAN_LIMITS.maxCursorBytes * 1.5) + 128) return undefined;
  const [version, payload, suppliedMac, extra] = raw.split(".");
  if (version !== VERSION || !payload || !suppliedMac || extra !== undefined) return undefined;
  const expected = mac(payload);
  const a = Buffer.from(suppliedMac, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  try {
    const decoded = Buffer.from(payload, "base64url");
    if (decoded.byteLength > SKILL_SCAN_LIMITS.maxCursorBytes) return undefined;
    return normalize(JSON.parse(decoded.toString("utf8")) as SkillScanCursor);
  } catch {
    return undefined;
  }
}
