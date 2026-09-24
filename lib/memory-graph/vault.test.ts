import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readVaultNotes } from "./vault";

const previous = process.env.OS_FS_READ_ROOTS;

afterEach(() => {
  if (previous === undefined) delete process.env.OS_FS_READ_ROOTS;
  else process.env.OS_FS_READ_ROOTS = previous;
});

describe("readVaultNotes", () => {
  it("reads markdown inside the read root and skips hidden tool directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mso-memory-graph-"));
    process.env.OS_FS_READ_ROOTS = root;
    await mkdir(path.join(root, "daily"), { recursive: true });
    await mkdir(path.join(root, ".obsidian"), { recursive: true });
    await writeFile(path.join(root, "daily", "Alpha.md"), "# Alpha\n\nLinked [[Beta]]\n");
    await writeFile(path.join(root, ".obsidian", "Secret.md"), "# Secret\n");
    const scan = await readVaultNotes(root);
    expect(scan.root).toBe(root);
    expect(scan.notes.map((note) => note.title)).toEqual(["Alpha"]);
    expect(scan.notes[0]).toMatchObject({ group: "daily", kind: "note" });
    expect(scan.notes[0]?.text).toContain("[[Beta]]");
  });

  it("refuses a root outside the readable roots", async () => {
    const allowed = await mkdtemp(path.join(os.tmpdir(), "mso-memory-allowed-"));
    const blocked = await mkdtemp(path.join(os.tmpdir(), "mso-memory-blocked-"));
    process.env.OS_FS_READ_ROOTS = allowed;
    vi.stubEnv("OS_FS_READ_ROOTS", allowed);
    const scan = await readVaultNotes(blocked);
    expect(scan.notes).toEqual([]);
    expect(scan.root).toBeNull();
    expect(scan.warning).toMatch(/outside|readable/i);
  });
});
