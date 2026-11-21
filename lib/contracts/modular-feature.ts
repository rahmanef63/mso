// Versioned contract for out-of-band modular MSO feature packages installed under
// ~/.mso/features/<id>/ and served without rebuilding or restarting MSO core.

import type { DeviceRole } from "@/lib/auth/roles";

export type ModularFeatureManifest = {
  schemaVersion: 1;
  id: string;
  version: string;
  title: string;
  description?: string;
  slug?: string;
  minRole: DeviceRole;
  entry: string;
  defaultSize?: { w: number; h: number };
  integrity: string;
  updatedAt: string;
};

export type ModularFeatureSummary = Pick<
  ModularFeatureManifest,
  "id" | "version" | "title" | "description" | "slug" | "minRole" | "entry" | "defaultSize" | "updatedAt"
>;

export type ModularFeatureSnapshot = {
  schemaVersion: 1;
  features: ModularFeatureSummary[];
};

const ID_RE = /^[a-z][a-z0-9-]{1,40}$/;
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/;
const SHA256_RE = /^sha256-[a-f0-9]{64}$/;
const ROLES = new Set<DeviceRole>(["viewer", "operator", "owner"]);

export const modularFeatureAppId = (id: string) => `mod-${id}`;

export function isValidFeatureId(id: string): boolean {
  return ID_RE.test(id);
}

export function isValidRelativeEntry(entry: string): boolean {
  if (!entry || entry.startsWith("/") || entry.includes("\\") || entry.includes("\0")) return false;
  const parts = entry.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function validateModularManifest(raw: unknown): ModularFeatureManifest {
  if (!raw || typeof raw !== "object") throw new Error("manifest must be a JSON object");
  const m = raw as Record<string, unknown>;
  if (m.schemaVersion !== 1) throw new Error("manifest schemaVersion must be 1");
  if (typeof m.id !== "string" || !isValidFeatureId(m.id)) throw new Error("invalid feature id");
  if (typeof m.version !== "string" || !SEMVER_RE.test(m.version)) throw new Error("invalid semver version");
  if (typeof m.title !== "string" || m.title.trim().length < 1 || m.title.length > 60) {
    throw new Error("title must be 1..60 characters");
  }
  const minRole = (typeof m.minRole === "string" ? m.minRole : "owner") as DeviceRole;
  if (!ROLES.has(minRole)) throw new Error("minRole must be viewer, operator, or owner");
  if (typeof m.entry !== "string" || !isValidRelativeEntry(m.entry)) throw new Error("invalid relative entry path");
  if (typeof m.integrity !== "string" || !SHA256_RE.test(m.integrity)) {
    throw new Error("integrity must be sha256-<64 lowercase hex>");
  }
  const slug = typeof m.slug === "string" && isValidFeatureId(m.slug) ? m.slug : undefined;
  const description = typeof m.description === "string" ? m.description.slice(0, 240) : undefined;
  const updatedAt = typeof m.updatedAt === "string" && m.updatedAt ? m.updatedAt : new Date().toISOString();
  let defaultSize: { w: number; h: number } | undefined;
  if (m.defaultSize && typeof m.defaultSize === "object") {
    const sz = m.defaultSize as Record<string, unknown>;
    if (typeof sz.w === "number" && typeof sz.h === "number" && sz.w >= 320 && sz.h >= 240) {
      defaultSize = { w: Math.min(2000, Math.round(sz.w)), h: Math.min(1400, Math.round(sz.h)) };
    }
  }
  return {
    schemaVersion: 1,
    id: m.id,
    version: m.version,
    title: m.title.trim(),
    description,
    slug,
    minRole,
    entry: m.entry,
    defaultSize,
    integrity: m.integrity,
    updatedAt,
  };
}
