import { isPlainHttpUrl, isValidAppId } from "./create-app-api.ts";
import { iconPath } from "../media/icon-catalog.ts";

export type TileCategory = { id: string; label: string; icon: string; accent: string };
export type LaunchMode = "embed" | "tab";

/** Tile presets. The shell app registry stores only id/title/description/url/mode,
 *  so these categories are preview-only: they style the live tile and are never
 *  sent to the backend as if the API supported them. */
export const TILE_CATEGORIES: readonly TileCategory[] = [
  { id: "productivity", label: "Productivity", icon: "check", accent: "#1f6df0" },
  { id: "analytics", label: "Analytics", icon: "layers", accent: "#0f766e" },
  { id: "communication", label: "Communication", icon: "mail", accent: "#a855f7" },
  { id: "developer", label: "Developer", icon: "code", accent: "#b45309" },
  { id: "media", label: "Media", icon: "film", accent: "#be123c" },
  { id: "infrastructure", label: "Infrastructure", icon: "server", accent: "#334155" },
];

export const LAUNCH_MODES: readonly { id: LaunchMode; label: string; hint: string }[] = [
  { id: "embed", label: "Embed", hint: "Opens in a sandboxed frame inside the shell when the origin allows framing." },
  { id: "tab", label: "Separate tab", hint: "Opens as a remote window from its own origin, keeping cookies separate." },
];

export function slugifyAppId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}

export type DraftInput = { id: string; title: string; description: string; url: string; mode: LaunchMode };
export type DraftIssue = { field: "id" | "title" | "description" | "url"; message: string };

/** Field-level issues, in form order, so the UI can mark each input instead of
 *  showing one error at a time after a failed submit. */
export function validateDraft(input: DraftInput): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const id = input.id.trim();
  const title = input.title.trim();
  const description = input.description.trim();
  const url = input.url.trim();

  if (!id) issues.push({ field: "id", message: "App ID is required." });
  else if (!isValidAppId(id)) issues.push({ field: "id", message: "Use lowercase letters, digits, or hyphens (max 64 chars)." });
  if (!title) issues.push({ field: "title", message: "Title is required." });
  else if (title.length > 120) issues.push({ field: "title", message: "Title must be 120 characters or fewer." });
  if (description.length > 240) issues.push({ field: "description", message: "Description must be 240 characters or fewer." });
  if (!url) issues.push({ field: "url", message: "App URL is required." });
  else if (!isPlainHttpUrl(url)) issues.push({ field: "url", message: "Use a plain HTTP or HTTPS URL without credentials, query, or fragment." });
  return issues;
}

export function issueFor(issues: readonly DraftIssue[], field: DraftIssue["field"]): string | null {
  return issues.find((issue) => issue.field === field)?.message ?? null;
}

export function categoryFor(id: string): TileCategory {
  return TILE_CATEGORIES.find((category) => category.id === id) ?? TILE_CATEGORIES[0]!;
}

export function tileGlyphPath(category: TileCategory): string {
  return iconPath(category.icon);
}

export function launchHint(mode: LaunchMode): string {
  return LAUNCH_MODES.find((option) => option.id === mode)?.hint ?? "";
}
