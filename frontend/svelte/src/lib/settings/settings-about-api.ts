import { ApiError } from "../host-api.ts";
import { detectShellBridge } from "../shell-bridge.ts";
import type { ShellBridge } from "../shell-bridge.ts";
import { isRecord, requestJson } from "./settings-request.ts";

// ---------------------------------------------------------------------------
// About & Structured Changelog (Zero HTML)
// ---------------------------------------------------------------------------

export type ChangelogEntry = { scope: string; text: string };
export type ChangelogGroup = { label: string; entries: ChangelogEntry[] };
export type ChangelogDay = { date: string; groups: ChangelogGroup[] };

const DAY_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/;
const GROUP_RE = /^\*\*(.+?)\*\*\s*$/;
const ENTRY_RE = /^[-*]\s+(.*)$/;
const SCOPE_RE = /^`([^`]+)`\s*(.*)$/;

export function parseChangelog(markdown: string): ChangelogDay[] {
  const days: ChangelogDay[] = [];
  let day: ChangelogDay | null = null;
  let group: ChangelogGroup | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const dayMatch = DAY_RE.exec(line);
    if (dayMatch) {
      day = { date: dayMatch[1], groups: [] };
      days.push(day);
      group = null;
      continue;
    }
    if (!day) continue;

    const groupMatch = GROUP_RE.exec(line);
    if (groupMatch) {
      group = { label: groupMatch[1], entries: [] };
      day.groups.push(group);
      continue;
    }

    const entryMatch = ENTRY_RE.exec(line);
    if (!entryMatch) continue;
    if (!group) {
      group = { label: "Changed", entries: [] };
      day.groups.push(group);
    }
    const scoped = SCOPE_RE.exec(entryMatch[1].trim());
    group.entries.push(
      scoped
        ? { scope: scoped[1], text: scoped[2].trim() }
        : { scope: "", text: entryMatch[1].trim() },
    );
  }

  return days.filter((d) => d.groups.some((g) => g.entries.length > 0));
}

export async function readChangelog(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<{ markdown: string; generated: boolean; days: ChangelogDay[] }> {
  const raw = await requestJson("/api/changelog", { label: "changelog", signal, fetcher, bridge });
  if (!isRecord(raw) || typeof raw.markdown !== "string") {
    throw new ApiError("The changelog response is invalid.", 502);
  }
  return {
    markdown: raw.markdown,
    generated: Boolean(raw.generated),
    days: parseChangelog(raw.markdown),
  };
}
