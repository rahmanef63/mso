import type { AgentVaultNote } from "./agent-vault-api.ts";

export function normalizePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/").replace(/\.md$/i, "").toLowerCase();
}

/**
 * Resolve only to a published note in the selected snapshot, never to a host path.
 * Relative links resolve against the current note directory; wikilinks may match by title.
 */
export function resolveNoteLink(
  notes: AgentVaultNote[], from: string, raw: string, wiki = false,
): AgentVaultNote | undefined {
  let target: string;
  try { target = decodeURIComponent(raw.split("#")[0]!.split("?")[0]!).trim(); } catch { return undefined; }
  if (!target || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(target)) return undefined;
  const direct = normalizePath(target);
  const directory = from.slice(0, Math.max(0, from.lastIndexOf("/")));
  const relative = normalizePath(`${directory}/${target}`);
  const exact = notes.find((note) => normalizePath(note.path) === relative || (wiki && normalizePath(note.path) === direct));
  if (exact || !wiki) return exact;
  const matches = notes.filter((note) =>
    normalizePath(note.title) === direct || normalizePath(note.path.split("/").pop()!.replace(/\.md$/i, "")) === direct);
  return matches.length === 1 ? matches[0] : undefined;
}

export function safeExternalLink(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* unresolved or non-web links stay text */ }
  return undefined;
}

/** Wikilink targets referenced by a note, deduplicated, in document order. */
export function outgoingLinks(content: string): string[] {
  const seen = new Set<string>();
  for (const match of content.matchAll(/\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g)) {
    const target = match[1]?.trim();
    if (target) seen.add(target);
  }
  return [...seen];
}

/** Notes whose wikilinks resolve to the selected note. Bounded by the snapshot, not the host. */
export function backlinksOf(notes: AgentVaultNote[], contents: Map<string, string>, path: string): AgentVaultNote[] {
  const target = normalizePath(path);
  return notes.filter((note) => {
    if (note.path === path) return false;
    const body = contents.get(note.path);
    if (!body) return false;
    return outgoingLinks(body).some((raw) => normalizePath(resolveNoteLink(notes, note.path, raw, true)?.path ?? "") === target);
  });
}
