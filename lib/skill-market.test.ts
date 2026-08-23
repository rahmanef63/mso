import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.join(__dirname, "../scripts/skill-market.mjs");
const run = (root: string, ...args: string[]) =>
  execFileSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, MSO_SKILL_INSTALL_ROOT: root },
  });

describe("curated skill market", () => {
  it("lists the reviewed installable catalog", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mso-skill-market-")), "skills");
    const out = run(root, "available");
    expect(out).toContain("ponytail");
    expect(out).toContain("caveman");
    expect(out).toContain("rtk");
    expect(out).toContain("mso-safe-wrapper");
  });

  it("installs multiple selected skills non-interactively with provenance", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mso-skill-market-")), "skills");
    run(root, "install", "ponytail", "caveman", "rtk", "-y");
    for (const id of ["ponytail", "caveman", "rtk"]) {
      expect(fs.readFileSync(path.join(root, id, "SKILL.md"), "utf8")).toContain(`name: ${id}`);
      const marker = JSON.parse(fs.readFileSync(path.join(root, id, ".mso-market.json"), "utf8"));
      expect(marker.id).toBe(id);
      expect(marker.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(run(root, "available")).toContain("installed");
  });

  it("does not let -y clobber a locally modified skill without --force", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mso-skill-market-")), "skills");
    run(root, "install", "ponytail", "-y");
    const skill = path.join(root, "ponytail", "SKILL.md");
    fs.appendFileSync(skill, "\nlocal edit\n");
    expect(() => run(root, "install", "ponytail", "-y")).toThrow();
    expect(fs.readFileSync(skill, "utf8")).toContain("local edit");
    run(root, "install", "ponytail", "-y", "--force");
    expect(fs.readFileSync(skill, "utf8")).not.toContain("local edit");
  });

  it("removes only skills carrying MSO market provenance", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mso-skill-market-")), "skills");
    fs.mkdirSync(path.join(root, "ponytail"), { recursive: true });
    fs.writeFileSync(path.join(root, "ponytail", "SKILL.md"), "---\nname: ponytail\n---\nlocal\n");
    expect(() => run(root, "remove", "ponytail", "-y")).toThrow();
    expect(fs.existsSync(path.join(root, "ponytail", "SKILL.md"))).toBe(true);
  });
});
