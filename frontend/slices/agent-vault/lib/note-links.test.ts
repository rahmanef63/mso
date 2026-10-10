import { describe, expect, it } from "vitest";
import type { AgentVaultNote } from "@/lib/contracts/agent-vault";
import { resolveNoteLink, safeExternalLink } from "./note-links";

const root = "Snapshots/aaaaaaaaaaaaaaaaaaaa";
const notes: AgentVaultNote[] = [
  { path: `${root}/overview/Beranda.md`, title: "Agent progress", kind: "overview", source: "generated" },
  { path: `${root}/agent/worker.md`, title: "Worker", kind: "agent", source: "wiki/agents/worker.md" },
];
describe("published vault note links", () => {
  it("resolves snapshot paths, relative Markdown and aliases without leaving the selected snapshot", () => {
    expect(resolveNoteLink(notes, notes[0].path, notes[1].path.replace(/\.md$/, ""), true)).toBe(notes[1]);
    expect(resolveNoteLink(notes, notes[0].path, "../agent/worker.md#Tasks")).toBe(notes[1]);
    expect(resolveNoteLink(notes, notes[0].path, "Worker#Tasks", true)).toBe(notes[1]);
    for (const target of ["../../../private.md", "/etc/passwd", "file:///etc/passwd", "javascript:alert(1)", "%ZZ", "Snapshots/bbbbbbbbbbbbbbbbbbbb/agent/worker.md"]) {
      expect(resolveNoteLink(notes, notes[0].path, target)).toBeUndefined();
    }
    const duplicate = { ...notes[1], path: `${root}/project/worker.md` };
    expect(resolveNoteLink([...notes, duplicate], notes[0].path, "Worker", true)).toBeUndefined();
  });
  it("keeps executable, credentialed and embedded URLs inert", () => {
    expect(safeExternalLink("https://example.org/reference")).toBe("https://example.org/reference");
    for (const target of ["javascript:alert(1)", "data:text/html,test", "file:///etc/passwd", "https://user:pass@example.org/", "//example.org", "obsidian://open"]) expect(safeExternalLink(target)).toBeUndefined();
  });
});
