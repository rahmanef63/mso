import type { AgentVaultNote } from "@/lib/contracts/agent-vault";

function normalize(value: string): string {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/").replace(/\.md$/i, "").toLowerCase();
}

/** Resolve only to a published note in the selected snapshot, never to a host path. */
export function resolveNoteLink(notes: AgentVaultNote[], from: string, raw: string, wiki = false): AgentVaultNote | undefined {
  let target: string;
  try { target = decodeURIComponent(raw.split("#")[0].split("?")[0]).trim(); } catch { return; }
  if (!target || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(target)) return;
  const direct = normalize(target);
  const relative = normalize(`${from.slice(0, from.lastIndexOf("/"))}/${target}`);
  const exact = notes.find(note => normalize(note.path) === relative || (wiki && normalize(note.path) === direct));
  if (exact || !wiki) return exact;
  const matches = notes.filter(note => normalize(note.title) === direct || normalize(note.path.split("/").pop()!) === direct);
  return matches.length === 1 ? matches[0] : undefined;
}

export function safeExternalLink(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* unresolved or non-web links remain text */ }
  return undefined;
}
