import { describe, expect, it } from "vitest";
import { composeSystem } from "./agent-request";
import { HOST_SYSTEM } from "../host-tools/registry";
import type { Agent } from "./types";

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: "ag_x", name: "Ops", glyph: "gauge", color: "amber",
  persona: "Terse. Prefer shell over prose.", skills: [], allTools: true, ...over,
});

// The persona used to be a fake user turn pushed once, when history was empty —
// which froze turn zero's agent for the life of the thread. It is a per-request
// system prompt now, so switching agent mid-thread takes effect on the next turn.
describe("composeSystem", () => {
  it("always leads with HOST_SYSTEM so the cached prefix is shared", () => {
    expect(composeSystem(agent(), " MODE")).toMatch(new RegExp("^" + HOST_SYSTEM.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("carries the agent's name and persona", () => {
    const out = composeSystem(agent(), " MODE");
    expect(out).toContain("acting as Ops");
    expect(out).toContain("Prefer shell over prose.");
  });

  it("changes when the agent changes — that is the whole point", () => {
    const a = composeSystem(agent({ name: "Ops", persona: "Terse." }), " MODE");
    const b = composeSystem(agent({ name: "Researcher", persona: "Cite sources." }), " MODE");
    expect(a).not.toBe(b);
    expect(b).toContain("Researcher");
    expect(b).not.toContain("Terse.");
  });

  it("degrades cleanly with no agent or an empty persona", () => {
    const base = HOST_SYSTEM + " MODE";
    expect(composeSystem(undefined, " MODE")).toBe(base);
    expect(composeSystem(agent({ persona: "   " }), " MODE")).toBe(base);
  });


  it("adds bounded selected-project context without turning it into permission", () => {
    const out = composeSystem(agent(), " MODE", {
      id: "root/mso", name: "mso", path: "/home/rahman/projects/mso", branch: "main",
      clean: false, head: "abcdef123456", knowledge: true, recentMemoryTitles: ["Fix updater race", "Verify memory retention"],
    });
    expect(out).toContain("Selected MSO project: mso");
    expect(out).toContain("Working tree has changes");
    expect(out).toContain("Project knowledge is available");
    expect(out).toContain("not permission to mutate");
  });

  it("stays well inside the route's 4000-char system cap", () => {
    const out = composeSystem(agent({ persona: "x".repeat(5000) }), " MODE", { id: "x", name: "x".repeat(500), path: "/" + "y".repeat(1000), recentMemoryTitles: Array(20).fill("z".repeat(200)) });
    expect(out.length).toBeLessThan(4000);
  });
});
