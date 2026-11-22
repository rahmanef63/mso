import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { SETTINGS } from "./mso-agent-settings-entries.mjs";
import { applySettings } from "./mso-agent-cmd-settings.mjs";
import { filterSessionsByScope, sessionTable } from "./mso-agent-session-list.mjs";
import { tabLayout } from "./mso-agent-chrome.mjs";
import { mountScreenLoop } from "./mso-agent-screen-loop.mjs";

class FakeOutput extends EventEmitter {
  isTTY = true;
  columns = 80;
  rows = 24;
  chunks: string[] = [];
  write(str: string) {
    this.chunks.push(String(str));
    return true;
  }
}

describe("tabs.scope settings and session filtering", () => {
  const fixtureSessions = [
    { id: "s1", name: "auth-worker", title: "OAuth setup", cwd: "/srv/project-a", updatedAt: "2026-11-02T10:00:00Z" },
    { id: "s2", name: "billing-fix", title: "Stripe webhook", cwd: "/srv/project-b", updatedAt: "2026-11-02T09:00:00Z" },
    { id: "s3", name: "db-migrate", title: "Migration run", cwd: "/srv/project-a", updatedAt: "2026-11-02T08:00:00Z" },
    { id: "s4", name: "docs-review", title: "Read docs", cwd: "/tmp/docs", updatedAt: "2026-11-02T07:00:00Z" },
    { id: "s5", name: "legacy-run", title: "Old task", cwd: undefined, updatedAt: "2026-11-02T06:00:00Z" },
  ];

  // Test 1: global shows every session
  it("global scope shows every session regardless of directory", () => {
    const result = filterSessionsByScope(fixtureSessions, { scope: "global", cwd: "/srv/project-a", activeId: "s1" });
    expect(result.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
  });

  // Test 2: cwd shows only sessions in the current directory PLUS the active one
  it("cwd scope shows only current directory sessions plus the active session", () => {
    // s4 is located in /tmp/docs but is the active session. s1 and s3 match /srv/project-a.
    // Inactive sessions from other dirs (s2) or lacking cwd (s5) are omitted.
    const result = filterSessionsByScope(fixtureSessions, { scope: "cwd", cwd: "/srv/project-a", activeId: "s4" });
    expect(result.map((s) => s.id)).toEqual(["s1", "s3", "s4"]);
  });

  // Test 3: default reproduces today's list exactly, asserted against a fixture
  it("default scope setting is global and reproduces today's full session list exactly", () => {
    const setting = SETTINGS.find((s) => s.key === "scope");
    expect(setting).toBeDefined();
    // Default must be global because today's MSO list is global across directories
    expect(setting?.default).toBe("global");
    expect(setting?.values).toEqual(["cwd", "global"]);

    // Calling filterSessionsByScope with no scope option uses global default
    const defaultResult = filterSessionsByScope(fixtureSessions);
    expect(defaultResult).toEqual(fixtureSessions);
  });

  // Test 4: tab row and /tabs table show the same ids for the same input
  it("tab row and /tabs table show the exact same session ids for identical input", () => {
    const opts = { scope: "cwd", cwd: "/srv/project-a", activeId: "s4" };
    const scoped = filterSessionsByScope(fixtureSessions, opts);
    const expectedIds = scoped.map((s) => s.id);

    // Tab row segments produce identical session IDs
    const { segments } = tabLayout(scoped, "s4");
    const tabIds = segments.filter((seg: any) => seg.type === "tab").map((seg: any) => seg.id);
    expect(tabIds).toEqual(expectedIds);

    // Session table lines display all scoped sessions and none of the omitted ones
    const tableLines = sessionTable(fixtureSessions, { ...opts, width: 80 });
    expect(tableLines).toHaveLength(expectedIds.length + 1);
    for (const session of scoped) {
      // Match on name prefix since formatCell truncates longer names to column bounds
      const prefix = `@${session.name.slice(0, 8)}`;
      const found = tableLines.some((line) => line.includes(prefix));
      expect(found).toBe(true);
    }
    expect(tableLines.some((line) => line.includes("@billing-fix"))).toBe(false);
    expect(tableLines.some((line) => line.includes("@legacy-run"))).toBe(false);
  });

  // Test 5: session with no cwd field is handled per a stated rule, not dropped silently
  it("session with no cwd is retained in global scope, omitted in cwd when inactive, and retained when active", () => {
    const noCwd = { id: "legacy-x", name: "legacy", title: "No CWD" };
    const list = [noCwd, { id: "dir-1", name: "app", cwd: "/app" }];

    // Rule: in global scope, missing cwd is never dropped
    const globalResult = filterSessionsByScope(list, { scope: "global" });
    expect(globalResult.map((s) => s.id)).toEqual(["legacy-x", "dir-1"]);

    // Rule: in cwd scope, inactive session with missing cwd is excluded because directory is unknown
    const cwdInactive = filterSessionsByScope(list, { scope: "cwd", cwd: "/app", activeId: "dir-1" });
    expect(cwdInactive.map((s) => s.id)).toEqual(["dir-1"]);

    // Rule: in cwd scope, active session with missing cwd is retained so user never loses active tab
    const cwdActive = filterSessionsByScope(list, { scope: "cwd", cwd: "/app", activeId: "legacy-x" });
    expect(cwdActive.map((s) => s.id)).toEqual(["legacy-x", "dir-1"]);
  });

  // Settings and screen loop integration
  it("applies scope setting to session and feeds scoped list into screen loop", () => {
    const session: any = { agentSession: { id: "s1", cwd: "/srv/project-a" } };
    applySettings(session, { "tabs.scope": "cwd" });
    expect(session.tabsScope).toBe("cwd");

    const out = new FakeOutput();
    const loop = mountScreenLoop({
      session,
      enabled: true,
      output: out as never,
      getSessions: () => fixtureSessions,
      tabsScope: "cwd",
    });
    const geom = loop.geometry();
    expect(geom.panel.length).toBeGreaterThan(0);
    loop.dispose();
  });
});
