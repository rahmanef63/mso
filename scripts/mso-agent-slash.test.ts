import { describe, expect, it } from "vitest";
import { slashCompletionItems } from "./mso-agent-slash.mjs";

const skills = {
  skills: [
    { id: "global-design", name: "design", trust: "local", description: "global design helper" },
    { id: "root/a/design", name: "design", trust: "local", description: "project design helper", project: { id: "root/a", name: "alpha", path: "/srv/alpha" } },
    { id: "root/a/ship-check", name: "ship-check", trust: "local", description: "ship alpha", project: { id: "root/a", name: "alpha", path: "/srv/alpha" } },
    { id: "unsafe", name: "unsafe", trust: "untrusted", description: "do not inject" },
  ],
};

describe("MSO Agent slash completion catalog", () => {
  it("opens the command catalog from a single slash", () => {
    const rows = slashCompletionItems(skills, "/", "/home/rahman");
    expect(rows[0]).toMatchObject({ text: "/help", kind: "command" });
    expect(rows.map((row) => row.text)).toContain("/design");
    expect(rows.map((row) => row.text)).toContain("/quit");
    expect(rows.map((row) => row.text)).not.toContain("/unsafe");
  });

  it("filters live as the command token is typed", () => {
    expect(slashCompletionItems(skills, "/sess", "/home/rahman").map((row) => row.text)).toEqual(["/session", "/sessions"]);
    expect(slashCompletionItems(skills, "/skills anything", "/home/rahman")).toEqual([]);
  });

  it("recommends the current-project skill and labels its project", () => {
    const rows = slashCompletionItems(skills, "/ship", "/srv/alpha/src");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: "/ship-check", kind: "skill" });
    expect(rows[0].meta).toContain("alpha");
  });

  it("prefers a current-project skill over the same-name global skill", () => {
    const [row] = slashCompletionItems(skills, "/design", "/srv/alpha");
    expect(row.kind).toBe("skill");
    const project = "project" in row ? row.project as { id?: string } | null : null;
    expect(project?.id).toBe("root/a");
    expect(row.meta).toContain("project design helper");
  });

  it("exposes ready, queued, and invoked skill state to the slash palette", () => {
    const ready = slashCompletionItems(skills, "/design", "/home/rahman")[0];
    expect(ready).toMatchObject({ kind: "skill", state: "ready", skillId: "global-design" });

    const queued = slashCompletionItems(skills, "/design", "/home/rahman", {
      pendingSkill: { id: "global-design", name: "design" },
    })[0];
    expect(queued).toMatchObject({ state: "queued" });
    expect(queued.meta).toContain("queued");

    const invoked = slashCompletionItems(skills, "/design", "/home/rahman", {
      lastInvokedSkill: { id: "global-design", name: "design" },
    })[0];
    expect(invoked).toMatchObject({ state: "invoked" });
    expect(invoked.meta).toContain("invoked");
  });

});
