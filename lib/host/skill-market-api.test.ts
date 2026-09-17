import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { listSkillMarket, manageSkillMarket } from "./skill-market-api";
let base = "", root = "";
beforeEach(async () => { base = await fs.mkdtemp(path.join(os.tmpdir(), "mso-market-api-")); root = path.join(base, "skills"); vi.stubEnv("MSO_SKILL_INSTALL_ROOT", root); });
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(base, { recursive: true, force: true }); });
const row = async () => (await listSkillMarket()).skills.find(skill => skill.id === "ponytail")!;
async function install() { const before = await row(); await manageSkillMarket({ action: "install", id: before.id, revision: before.revision }); return row(); }
describe("VPS Skills Store lifecycle", () => {
  it("installs and removes real files in the canonical CLI root", async () => {
    expect((await row()).state).toBe("not-installed");
    const current = await install(); expect(current.state).toBe("installed");
    expect(await fs.readFile(path.join(root, "ponytail/SKILL.md"), "utf8")).toContain("name: ponytail");
    expect((await fs.stat(path.join(root, "ponytail/SKILL.md"))).mode & 0o077).toBe(0);
    await manageSkillMarket({ action: "remove", id: current.id, revision: current.revision });
    expect((await row()).state).toBe("not-installed");
    await expect(fs.stat(path.join(root, "ponytail"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects stale revisions", async () => {
    const before = await row(); await install();
    await expect(manageSkillMarket({ action: "remove", id: before.id, revision: before.revision })).rejects.toThrow("revision changed");
  });
  it("preserves edited skill content", async () => {
    await install(); const file = path.join(root, "ponytail/SKILL.md"); await fs.appendFile(file, "\nuser edits\n");
    const current = await row(); expect(current).toMatchObject({ state: "modified", canInstall: false, canRemove: false });
    await expect(manageSkillMarket({ action: "remove", id: current.id, revision: current.revision })).rejects.toThrow("Refusing");
    expect(await fs.readFile(file, "utf8")).toContain("user edits");
  });
  it("preserves additional user files and unmanaged directories", async () => {
    await install(); await fs.writeFile(path.join(root, "ponytail/notes.txt"), "keep me");
    const current = await row(); expect(current.state).toBe("conflict");
    await expect(manageSkillMarket({ action: "remove", id: current.id, revision: current.revision })).rejects.toThrow("Refusing");
    expect(await fs.readFile(path.join(root, "ponytail/notes.txt"), "utf8")).toBe("keep me");
    await fs.unlink(path.join(root, "ponytail/notes.txt")); await fs.unlink(path.join(root, "ponytail/.mso-market.json"));
    expect((await row()).canRemove).toBe(false);
  });
  it("rejects a symlinked install root before invoking the CLI", async () => {
    const outside = path.join(base, "outside"); await fs.mkdir(outside); await fs.symlink(outside, root);
    await expect(listSkillMarket()).rejects.toThrow(); expect(await fs.readdir(outside)).toEqual([]);
  });
  it("will not remove a symlinked target or marker", async () => {
    await listSkillMarket(); const outside = path.join(base, "outside"); await fs.mkdir(outside); await fs.symlink(outside, path.join(root, "ponytail"));
    expect((await row()).canRemove).toBe(false); await fs.unlink(path.join(root, "ponytail"));
    await install(); const marker = path.join(root, "ponytail/.mso-market.json"), copy = path.join(base, "marker.json");
    await fs.rename(marker, copy); await fs.symlink(copy, marker); expect((await row()).canRemove).toBe(false);
  });
  it("updates an unchanged, marker-owned old version without losing unrelated skills", async () => {
    await install(); const dir = path.join(root, "ponytail"), file = path.join(dir, "SKILL.md"), marker = path.join(dir, ".mso-market.json");
    const old = (await fs.readFile(file, "utf8")) + "\nold reviewed version\n"; await fs.writeFile(file, old);
    const provenance = JSON.parse(await fs.readFile(marker, "utf8")); provenance.sha256 = createHash("sha256").update(old).digest("hex");
    await fs.writeFile(marker, JSON.stringify(provenance));
    const current = await row(); expect(current.state).toBe("update-available");
    await manageSkillMarket({ action: "install", id: current.id, revision: current.revision });
    expect((await row()).state).toBe("installed"); expect(await fs.readFile(file, "utf8")).not.toContain("old reviewed version");
  });
  it("rejects unreviewed ids and traversal", async () => {
    await expect(manageSkillMarket({ action: "remove", id: "../other", revision: "a".repeat(64) })).rejects.toThrow("Inspect");
    await expect(manageSkillMarket({ action: "install", id: "unknown", revision: "a".repeat(64) })).rejects.toThrow("revision changed");
  });
});
