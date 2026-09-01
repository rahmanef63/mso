import { describe, expect, it } from "vitest";
import { currentSkillProject, resolveSlashSkill, slashSkillNames } from "./mso-agent-skills.mjs";

const globalSkill = { id: "design", name: "design", trust: "local", source: "operator" };
const projectA = { id: "root/a/design", name: "design", trust: "local", source: "project", project: { id: "root/a", name: "a", path: "/srv/projects/a" } };
const projectB = { id: "root/b/design", name: "design", trust: "local", source: "project", project: { id: "root/b", name: "b", path: "/srv/projects/b" } };
const projectOnly = { id: "root/a/ship-check", name: "ship-check", trust: "local", source: "project", project: { id: "root/a", name: "a", path: "/srv/projects/a" } };
const untrusted = { id: "random", name: "random", trust: "untrusted", source: "agents" };
const skills = { skills: [globalSkill, projectA, projectB, projectOnly, untrusted] };

describe("MSO Agent slash skill resolution", () => {
  it("prefers the current project's skill over a same-name global skill", () => {
    expect(currentSkillProject(skills, "/srv/projects/a/src")?.id).toBe("root/a");
    expect(resolveSlashSkill(skills, "design", "/srv/projects/a/src").skill?.id).toBe("root/a/design");
  });

  it("uses the global skill outside a project and never leaks into another project implicitly", () => {
    expect(resolveSlashSkill(skills, "design", "/home/rahman").skill?.id).toBe("design");
    const result = resolveSlashSkill(skills, "ship-check", "/home/rahman");
    expect(result.skill).toBeNull();
    expect(result.ambiguous.map((row: { id: string }) => row.id)).toEqual(["root/a/ship-check"]);
  });

  it("accepts an exact project catalog id as the explicit cross-project escape hatch", () => {
    expect(resolveSlashSkill(skills, "root/b/design", "/srv/projects/a").skill?.id).toBe("root/b/design");
  });

  it("offers only trusted skills that resolve in the current scope for tab completion", () => {
    expect(slashSkillNames(skills, "/home/rahman")).toContain("design");
    expect(slashSkillNames(skills, "/home/rahman")).not.toContain("ship-check");
    expect(slashSkillNames(skills, "/srv/projects/a")).toContain("ship-check");
    expect(slashSkillNames(skills, "/srv/projects/a")).not.toContain("random");
  });
});
